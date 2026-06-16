/**
 * WebGL2 renderer CORE for the Signal Viewer's dense waveform lanes.
 *
 * This is the GL-context-bound half of ADR 0019's hybrid renderer: it draws ONLY
 * the dense waveform lanes (the zoomed-out min/max envelope as triangle strips
 * and the zoomed-in per-sample line as instanced quads). Everything else — axes,
 * grid, labels, event markers, detection washes, the hypnogram ribbon,
 * sparse/step lanes, and the crosshair overlay — stays on Canvas2D, which is also
 * the permanent automatic fallback.
 *
 * The geometry it draws is produced by the **pure, unit-tested** helpers in this
 * module ({@link module:components/charts/webgl/envelopeGeometry}, {@link
 * module:components/charts/webgl/lineGeometry}, {@link
 * module:components/charts/webgl/waveformTransform}, {@link
 * module:components/charts/webgl/laneScissor}); the extrema-preservation contract
 * and gap semantics therefore live OUTSIDE this class. This file holds only the
 * parts that need a live GL context — shader compile/link, buffer upload, and
 * draw calls — which cannot be unit-tested in the headless sandbox (no WebGL in
 * jsdom) and are validated by the CI pixel-diff fidelity gate and in production.
 *
 * KEY INVARIANTS (ADR 0019):
 *   - **DPR preserved** at 2 (never reduced): the drawing buffer is `cssW*dpr ×
 *     cssH*dpr` device px.
 *   - **No per-frame upload**: {@link uploadLanes} pushes geometry into static
 *     buffers on data load / LOD-level change; {@link render} only sets uniforms +
 *     scissor and issues draws. Pan = change X offset; zoom = change X scale.
 *   - **Context-loss safe**: on `webglcontextlost` we stop drawing and notify the
 *     host (so it can show the Canvas2D fallback); on `webglcontextrestored` we
 *     recompile programs and re-upload the last lane set.
 *   - **Theme colours as uniforms**: callers pass resolved RGBA; no
 *     `getComputedStyle` here.
 *
 * @module components/charts/webgl/WebGLWaveformRenderer
 */

import {
  ENVELOPE_VERTEX_SHADER,
  ENVELOPE_FRAGMENT_SHADER,
  ENVELOPE_LOCATIONS,
} from './glsl/envelope';
import { LINE_VERTEX_SHADER, LINE_FRAGMENT_SHADER, LINE_LOCATIONS } from './glsl/line';
import {
  buildEnvelopeGeometry,
  PRIMITIVE_RESTART_INDEX,
  ENVELOPE_VERTEX_STRIDE,
  DENSE_LINE_WIDTH,
  type ColumnEnvelopeInput,
  type EnvelopeGeometryParams,
} from './envelopeGeometry';
import {
  buildLineGeometry,
  LINE_QUAD_UNIT,
  LINE_QUAD_VERTEX_COUNT,
  LINE_INSTANCE_STRIDE,
  type LineGeometryParams,
} from './lineGeometry';
import { computeLaneScissor, type LaneClipRectCss } from './laneScissor';
import {
  computeWaveformClipTransform,
  type ViewportX,
  type PhysicalRange,
  type LaneRect,
} from './waveformTransform';

/** Thrown when a WebGL2 context cannot be obtained; the caller falls back to Canvas2D. */
export class WebGLUnavailableError extends Error {
  constructor(message = 'WebGL2 is not available on this canvas') {
    super(message);
    this.name = 'WebGLUnavailableError';
  }
}

/** Resolved theme colour as RGBA in 0..1. */
export interface RGBA {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

/**
 * One lane's renderable waveform data, supplied at {@link uploadLanes} time. A
 * lane may carry an envelope (zoomed-out) OR a line polyline (zoomed-in); the
 * host picks which based on samples-per-pixel exactly as the Canvas2D path does.
 */
export interface WaveformLaneInput {
  /** Stable lane id (used to keep per-lane GPU resources across uploads). */
  readonly id: string;
  /** Physical Y range for this lane. */
  readonly phys: PhysicalRange;
  /** Per-column min/max envelope (zoomed-out path), or null. */
  readonly envelope: (ColumnEnvelopeInput & EnvelopeGeometryParams) | null;
  /** LTTB polyline + its sample→X mapping (zoomed-in path), or null. */
  readonly line: ({ readonly data: Float32Array } & LineGeometryParams) | null;
}

/** Per-lane, per-frame transform + colour + clip, supplied at {@link render} time. */
export interface LaneFrameState {
  /** Lane id matching a {@link WaveformLaneInput}. */
  readonly id: string;
  /** Lane plot rect (CSS px) — drives both the transform and the scissor. */
  readonly lane: LaneRect;
  /** Resolved lane colour. */
  readonly color: RGBA;
}

/** GPU resources for one uploaded lane. */
interface LaneBuffers {
  // Envelope strip
  envVbo: WebGLBuffer | null;
  envIbo: WebGLBuffer | null;
  envIndexCount: number;
  // Instanced line
  lineVbo: WebGLBuffer | null; // per-instance segment data
  lineInstanceCount: number;
  // Retained source so we can re-upload after context restore.
  source: WaveformLaneInput;
}

/** Compiled GL program + cached locations. */
interface ProgramBundle {
  program: WebGLProgram;
  attribs: Record<string, number>;
  uniforms: Record<string, WebGLUniformLocation | null>;
}

export class WebGLWaveformRenderer {
  private readonly canvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext;
  private envProgram: ProgramBundle | null = null;
  private lineProgram: ProgramBundle | null = null;
  /** Static unit-quad VBO shared by every line instance. */
  private lineQuadVbo: WebGLBuffer | null = null;
  private readonly lanes = new Map<string, LaneBuffers>();

  private cssWidth = 0;
  private cssHeight = 0;
  private dpr = 1;
  private contextLost = false;

  /** Host callbacks so the Signal Viewer can swap to Canvas2D during loss. */
  onContextLost: (() => void) | null = null;
  onContextRestored: (() => void) | null = null;

  private readonly handleContextLost = (e: Event): void => {
    // Prevent the default so the context becomes restorable.
    e.preventDefault();
    this.contextLost = true;
    this.onContextLost?.();
  };

  private readonly handleContextRestored = (): void => {
    this.contextLost = false;
    // Recompile programs and re-upload every retained lane's geometry.
    this.initPrograms();
    const retained = [...this.lanes.values()].map((l) => l.source);
    this.lanes.clear();
    this.uploadLanes(retained);
    this.onContextRestored?.();
  };

  /**
   * @param canvas A canvas element to own. Throws {@link WebGLUnavailableError}
   *   if a WebGL2 context cannot be created (caller falls back to Canvas2D).
   * @param options.premultipliedAlpha Whether the context composites with
   *   premultiplied alpha (default true, matching browser canvas compositing).
   */
  constructor(canvas: HTMLCanvasElement, options?: { premultipliedAlpha?: boolean }) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', {
      antialias: true,
      premultipliedAlpha: options?.premultipliedAlpha ?? true,
      preserveDrawingBuffer: false,
      // The waveform composites over the Canvas2D chrome beneath it.
      alpha: true,
      depth: false,
      stencil: false,
    });
    if (!gl) {
      throw new WebGLUnavailableError();
    }
    this.gl = gl;

    canvas.addEventListener('webglcontextlost', this.handleContextLost, false);
    canvas.addEventListener('webglcontextrestored', this.handleContextRestored, false);

    this.initPrograms();
    this.initStaticBuffers();
  }

  // ── Public API ─────────────────────────────────────────────────

  /**
   * Resize the drawing buffer to `cssW × cssH` CSS px at `dpr` device-pixel ratio.
   * The backing buffer is `cssW*dpr × cssH*dpr` device px — DPR is preserved, not
   * reduced (ADR 0019 hard constraint). Call from the host's ResizeObserver.
   */
  resize(cssW: number, cssH: number, dpr: number): void {
    this.cssWidth = cssW;
    this.cssHeight = cssH;
    this.dpr = dpr;
    this.canvas.width = Math.round(cssW * dpr);
    this.canvas.height = Math.round(cssH * dpr);
    this.canvas.style.width = `${cssW}px`;
    this.canvas.style.height = `${cssH}px`;
  }

  /**
   * Upload lane geometry into STATIC GPU buffers. Called on data load and on
   * LOD-level change (a new pyramid level / envelope vs line switch) — NOT per
   * frame. Builds geometry with the pure helpers, then uploads. Lanes absent from
   * `lanes` are disposed; lanes present are replaced.
   */
  uploadLanes(lanes: readonly WaveformLaneInput[]): void {
    if (this.contextLost) {
      // Retain the request implicitly by re-keying; geometry re-uploads on restore.
    }
    const gl = this.gl;
    const keep = new Set(lanes.map((l) => l.id));

    // Dispose lanes no longer present.
    for (const [id, buf] of this.lanes) {
      if (!keep.has(id)) {
        this.disposeLaneBuffers(buf);
        this.lanes.delete(id);
      }
    }

    for (const lane of lanes) {
      let buf = this.lanes.get(lane.id);
      if (!buf) {
        buf = {
          envVbo: null,
          envIbo: null,
          envIndexCount: 0,
          lineVbo: null,
          lineInstanceCount: 0,
          source: lane,
        };
        this.lanes.set(lane.id, buf);
      } else {
        buf.source = lane;
      }

      // Envelope strip.
      if (lane.envelope) {
        const geo = buildEnvelopeGeometry(lane.envelope, lane.envelope);
        buf.envVbo ??= gl.createBuffer();
        buf.envIbo ??= gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buf.envVbo);
        gl.bufferData(gl.ARRAY_BUFFER, geo.vertices, gl.STATIC_DRAW);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buf.envIbo);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, geo.indices, gl.STATIC_DRAW);
        buf.envIndexCount = geo.indices.length;
      } else {
        buf.envIndexCount = 0;
      }

      // Instanced line.
      if (lane.line) {
        const geo = buildLineGeometry(lane.line.data, lane.line);
        buf.lineVbo ??= gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buf.lineVbo);
        gl.bufferData(gl.ARRAY_BUFFER, geo.instances, gl.STATIC_DRAW);
        buf.lineInstanceCount = geo.instanceCount;
      } else {
        buf.lineInstanceCount = 0;
      }
    }
  }

  /**
   * Render one frame. Per-frame work is ONLY: clear, then for each lane set the
   * transform/colour uniforms, set `gl.scissor` to the lane's clip rect, and draw.
   * No buffer upload happens here — pan/zoom are encoded entirely in the transform
   * uniform derived from `viewport`.
   *
   * @param viewport     Horizontal data-space viewport (pan/zoom).
   * @param laneStates   Per-lane transform inputs + resolved colour, in draw order.
   */
  render(viewport: ViewportX, laneStates: readonly LaneFrameState[]): void {
    if (this.contextLost) return;
    const gl = this.gl;
    const bufW = this.canvas.width;
    const bufH = this.canvas.height;
    if (bufW === 0 || bufH === 0) return;

    gl.viewport(0, 0, bufW, bufH);
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    // Premultiplied-alpha blending (matches a premultipliedAlpha:true context).
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    // Clear transparent so the Canvas2D chrome beneath shows through.
    gl.disable(gl.SCISSOR_TEST);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.enable(gl.SCISSOR_TEST);

    for (const st of laneStates) {
      const buf = this.lanes.get(st.id);
      if (!buf) continue;

      const transform = computeWaveformClipTransform(
        viewport,
        // Physical range is part of the uploaded lane source.
        buf.source.phys,
        st.lane,
        this.cssWidth,
        this.cssHeight,
      );

      const clipRect: LaneClipRectCss = {
        plotLeft: st.lane.plotLeft,
        stripTop: st.lane.stripTop,
        plotWidth: st.lane.plotWidth,
        stripHeight: st.lane.stripHeight,
      };
      const scissor = computeLaneScissor(clipRect, this.dpr, bufH);
      gl.scissor(scissor.x, scissor.y, scissor.width, scissor.height);

      if (buf.envIndexCount > 0) {
        this.drawEnvelope(buf, transform, st.color, bufW, bufH);
      }
      if (buf.lineInstanceCount > 0) {
        this.drawLine(buf, transform, st.color, bufW, bufH);
      }
    }

    gl.disable(gl.SCISSOR_TEST);
  }

  /** Whether the context is currently lost (host should be on the Canvas2D fallback). */
  isContextLost(): boolean {
    return this.contextLost;
  }

  /** Release all GPU resources and detach listeners. */
  dispose(): void {
    const gl = this.gl;
    this.canvas.removeEventListener('webglcontextlost', this.handleContextLost);
    this.canvas.removeEventListener('webglcontextrestored', this.handleContextRestored);
    for (const buf of this.lanes.values()) this.disposeLaneBuffers(buf);
    this.lanes.clear();
    if (this.lineQuadVbo) gl.deleteBuffer(this.lineQuadVbo);
    this.lineQuadVbo = null;
    if (this.envProgram) gl.deleteProgram(this.envProgram.program);
    if (this.lineProgram) gl.deleteProgram(this.lineProgram.program);
    this.envProgram = null;
    this.lineProgram = null;
  }

  // ── Draw helpers ───────────────────────────────────────────────

  private drawEnvelope(
    buf: LaneBuffers,
    t: ReturnType<typeof computeWaveformClipTransform>,
    color: RGBA,
    bufW: number,
    bufH: number,
  ): void {
    const gl = this.gl;
    const prog = this.envProgram;
    if (!prog || !buf.envVbo || !buf.envIbo) return;

    gl.useProgram(prog.program);
    gl.uniform2f(prog.uniforms[ENVELOPE_LOCATIONS.uniforms.clipScale] ?? null, t.scaleX, t.scaleY);
    gl.uniform2f(
      prog.uniforms[ENVELOPE_LOCATIONS.uniforms.clipOffset] ?? null,
      t.offsetX,
      t.offsetY,
    );
    gl.uniform2f(prog.uniforms[ENVELOPE_LOCATIONS.uniforms.viewport] ?? null, bufW, bufH);
    gl.uniform4f(
      prog.uniforms[ENVELOPE_LOCATIONS.uniforms.color] ?? null,
      color.r,
      color.g,
      color.b,
      color.a,
    );

    gl.bindBuffer(gl.ARRAY_BUFFER, buf.envVbo);
    const aData = prog.attribs[ENVELOPE_LOCATIONS.attributes.data] ?? -1;
    if (aData >= 0) {
      gl.enableVertexAttribArray(aData);
      gl.vertexAttribPointer(aData, ENVELOPE_VERTEX_STRIDE, gl.FLOAT, false, 0, 0);
    }

    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buf.envIbo);
    // WebGL2 enables primitive restart PERMANENTLY for the fixed maximum index of
    // the index type — 0xffffffff for UNSIGNED_INT — which is exactly the sentinel
    // envelopeGeometry emits at gap boundaries (PRIMITIVE_RESTART_INDEX). There is
    // no enable/disable toggle (unlike desktop GL); it is always active.
    void PRIMITIVE_RESTART_INDEX;
    gl.drawElements(gl.TRIANGLE_STRIP, buf.envIndexCount, gl.UNSIGNED_INT, 0);
  }

  private drawLine(
    buf: LaneBuffers,
    t: ReturnType<typeof computeWaveformClipTransform>,
    color: RGBA,
    bufW: number,
    bufH: number,
  ): void {
    const gl = this.gl;
    const prog = this.lineProgram;
    if (!prog || !buf.lineVbo || !this.lineQuadVbo) return;

    gl.useProgram(prog.program);
    gl.uniform2f(prog.uniforms[LINE_LOCATIONS.uniforms.clipScale] ?? null, t.scaleX, t.scaleY);
    gl.uniform2f(prog.uniforms[LINE_LOCATIONS.uniforms.clipOffset] ?? null, t.offsetX, t.offsetY);
    gl.uniform2f(prog.uniforms[LINE_LOCATIONS.uniforms.viewport] ?? null, bufW, bufH);
    gl.uniform1f(
      prog.uniforms[LINE_LOCATIONS.uniforms.lineWidthPx] ?? null,
      DENSE_LINE_WIDTH * this.dpr,
    );
    gl.uniform4f(
      prog.uniforms[LINE_LOCATIONS.uniforms.color] ?? null,
      color.r,
      color.g,
      color.b,
      color.a,
    );

    // Per-vertex unit quad (not instanced).
    const aCorner = prog.attribs[LINE_LOCATIONS.attributes.corner] ?? -1;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.lineQuadVbo);
    if (aCorner >= 0) {
      gl.enableVertexAttribArray(aCorner);
      gl.vertexAttribPointer(aCorner, 2, gl.FLOAT, false, 0, 0);
      gl.vertexAttribDivisor(aCorner, 0);
    }

    // Per-instance segment data.
    const aSeg = prog.attribs[LINE_LOCATIONS.attributes.segment] ?? -1;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf.lineVbo);
    if (aSeg >= 0) {
      gl.enableVertexAttribArray(aSeg);
      gl.vertexAttribPointer(aSeg, LINE_INSTANCE_STRIDE, gl.FLOAT, false, 0, 0);
      gl.vertexAttribDivisor(aSeg, 1);
    }

    gl.drawArraysInstanced(gl.TRIANGLES, 0, LINE_QUAD_VERTEX_COUNT, buf.lineInstanceCount);

    if (aSeg >= 0) gl.vertexAttribDivisor(aSeg, 0); // reset for safety
  }

  // ── Setup ──────────────────────────────────────────────────────

  private initStaticBuffers(): void {
    const gl = this.gl;
    this.lineQuadVbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.lineQuadVbo);
    gl.bufferData(gl.ARRAY_BUFFER, LINE_QUAD_UNIT, gl.STATIC_DRAW);
  }

  private initPrograms(): void {
    this.envProgram = this.buildProgram(
      ENVELOPE_VERTEX_SHADER,
      ENVELOPE_FRAGMENT_SHADER,
      Object.values(ENVELOPE_LOCATIONS.attributes),
      Object.values(ENVELOPE_LOCATIONS.uniforms),
    );
    this.lineProgram = this.buildProgram(
      LINE_VERTEX_SHADER,
      LINE_FRAGMENT_SHADER,
      Object.values(LINE_LOCATIONS.attributes),
      Object.values(LINE_LOCATIONS.uniforms),
    );
  }

  private buildProgram(
    vsSource: string,
    fsSource: string,
    attribNames: readonly string[],
    uniformNames: readonly string[],
  ): ProgramBundle {
    const gl = this.gl;
    const vs = this.compileShader(gl.VERTEX_SHADER, vsSource);
    const fs = this.compileShader(gl.FRAGMENT_SHADER, fsSource);
    const program = gl.createProgram();
    if (!program) throw new WebGLUnavailableError('Failed to create WebGL program');
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    // Shaders can be detached/deleted once linked.
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS) && !gl.isContextLost()) {
      const log = gl.getProgramInfoLog(program);
      gl.deleteProgram(program);
      throw new WebGLUnavailableError(`Program link failed: ${log ?? 'unknown'}`);
    }

    const attribs: Record<string, number> = {};
    for (const name of attribNames) attribs[name] = gl.getAttribLocation(program, name);
    const uniforms: Record<string, WebGLUniformLocation | null> = {};
    for (const name of uniformNames) uniforms[name] = gl.getUniformLocation(program, name);

    return { program, attribs, uniforms };
  }

  private compileShader(type: number, source: string): WebGLShader {
    const gl = this.gl;
    const shader = gl.createShader(type);
    if (!shader) throw new WebGLUnavailableError('Failed to create shader');
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS) && !gl.isContextLost()) {
      const log = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw new WebGLUnavailableError(`Shader compile failed: ${log ?? 'unknown'}`);
    }
    return shader;
  }

  private disposeLaneBuffers(buf: LaneBuffers): void {
    const gl = this.gl;
    if (buf.envVbo) gl.deleteBuffer(buf.envVbo);
    if (buf.envIbo) gl.deleteBuffer(buf.envIbo);
    if (buf.lineVbo) gl.deleteBuffer(buf.lineVbo);
    buf.envVbo = null;
    buf.envIbo = null;
    buf.lineVbo = null;
  }
}
