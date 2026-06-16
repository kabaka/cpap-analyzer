/**
 * WebGL2 hybrid waveform renderer (ADR 0019) — public surface.
 *
 * Stage 1: the renderer CORE as a self-contained module. The pure, unit-tested
 * geometry/transform helpers are the in-sandbox correctness proof; the
 * GL-context-bound {@link WebGLWaveformRenderer} is validated by the CI
 * pixel-diff fidelity gate and in production. NOT yet integrated into
 * SignalViewer (that is Stage 2).
 *
 * @module components/charts/webgl
 */

export {
  computeWaveformClipTransform,
  laneInnerYExtent,
  dataXToCssX,
  valueToCssY,
  cssXToClipX,
  cssYToClipY,
  applyClipX,
  applyClipY,
  LANE_TOP_INSET,
  LANE_BOTTOM_INSET,
  type WaveformClipTransform,
  type ViewportX,
  type PhysicalRange,
  type LaneRect,
} from './waveformTransform';

export {
  buildEnvelopeGeometry,
  DENSE_LINE_WIDTH,
  PRIMITIVE_RESTART_INDEX,
  ENVELOPE_VERTEX_STRIDE,
  type ColumnEnvelopeInput,
  type EnvelopeGeometryParams,
  type EnvelopeGeometry,
} from './envelopeGeometry';

export {
  buildLineGeometry,
  LINE_QUAD_UNIT,
  LINE_QUAD_VERTEX_COUNT,
  LINE_INSTANCE_STRIDE,
  type LineGeometryParams,
  type LineGeometry,
} from './lineGeometry';

export { computeLaneScissor, type ScissorRect, type LaneClipRectCss } from './laneScissor';

export {
  WebGLWaveformRenderer,
  WebGLUnavailableError,
  type RGBA,
  type WaveformLaneInput,
  type LaneFrameState,
} from './WebGLWaveformRenderer';
