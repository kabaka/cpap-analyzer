/**
 * Regression guard for the WebGL waveform white-fringe bug.
 *
 * The WebGL2 context is created with `premultipliedAlpha: true` and the renderer
 * blends with `gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)`. With that setup the
 * drawing buffer holds PREMULTIPLIED colour, so the fragment shaders MUST output
 * premultiplied colour (`rgb * a, a`). If a shader instead leaves RGB at full
 * brightness while only the alpha feathers (`vec4(u_color.rgb, ... * coverage)`),
 * the compositor un-premultiplies the low edge-alpha and AA edges bloom toward
 * white — the visible fringe the user reported. These string-level assertions are
 * pure (no GPU) and fail fast if either shader drifts back to straight-alpha
 * output. The actual rendered fidelity is validated by the CI pixel-diff gate.
 */

import { describe, expect, it } from 'vitest';

import { ENVELOPE_FRAGMENT_SHADER } from '../envelope';
import { LINE_FRAGMENT_SHADER } from '../line';

/** Strip GLSL line/block comments so we assert on real code, not prose. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

describe('WebGL waveform fragment shaders (premultiplied alpha)', () => {
  it('line shader premultiplies RGB by the same alpha that feathers the edge', () => {
    const code = stripComments(LINE_FRAGMENT_SHADER);
    // Edge factor is computed as a coverage term...
    expect(code).toMatch(/coverage\s*=/);
    // ...folded into the output alpha...
    expect(code).toMatch(/float\s+a\s*=\s*u_color\.a\s*\*\s*coverage/);
    // ...and RGB is premultiplied by that same alpha.
    expect(code).toMatch(/fragColor\s*=\s*vec4\(\s*u_color\.rgb\s*\*\s*a\s*,\s*a\s*\)/);
    // Guard against the bug: straight-alpha output (full-brightness RGB).
    expect(code).not.toMatch(/fragColor\s*=\s*vec4\(\s*u_color\.rgb\s*,/);
  });

  it('envelope shader outputs premultiplied colour (rgb*a, a)', () => {
    const code = stripComments(ENVELOPE_FRAGMENT_SHADER);
    expect(code).toMatch(
      /fragColor\s*=\s*vec4\(\s*u_color\.rgb\s*\*\s*u_color\.a\s*,\s*u_color\.a\s*\)/,
    );
    // Guard against the previous straight passthrough `fragColor = u_color;`.
    expect(code).not.toMatch(/fragColor\s*=\s*u_color\s*;/);
  });
});
