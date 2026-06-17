/**
 * GLSL ES 3.00 program for the zoomed-in per-sample polyline.
 *
 * Renders the instanced segments built by {@link
 * module:components/charts/webgl/lineGeometry} as screen-space-thick, round-joined,
 * anti-aliased lines that match the Canvas2D `stroke()` at {@link
 * DENSE_LINE_WIDTH} (1.2 px) with `lineJoin: 'round'`.
 *
 * Approach (instanced quad expansion + SDF feather):
 *   - Per instance: the segment endpoints `p_current` / `p_next` in data space.
 *   - Per vertex (the shared unit quad): `a_corner = (along, side)` where
 *     `along ∈ {0,1}` selects the endpoint and `side ∈ {-1,+1}` selects the
 *     offset direction.
 *   - Both endpoints are transformed to clip then to device px. The segment
 *     direction and its perpendicular are computed in **device px**, so the quad
 *     is expanded by `halfWidth = 0.5 * u_lineWidthPx` device px on each side —
 *     constant pixel width regardless of zoom. The quad is extended by
 *     `halfWidth` past each endpoint (a "cap margin") so the fragment SDF can draw
 *     a round cap/join, mirroring `lineJoin: 'round'`.
 *   - The fragment shader computes the distance from the fragment to the segment
 *     core in device px and feathers the last ~1 px (the AA), and rounds the ends
 *     by measuring distance to the nearest endpoint — yielding round joins/caps.
 *
 * Uniforms:
 *   - `u_clipScale`  (vec2): data→clip scale.
 *   - `u_clipOffset` (vec2): data→clip offset.
 *   - `u_viewport`   (vec2): drawing-buffer size in device px.
 *   - `u_lineWidthPx`(float): stroke width in device px (`DENSE_LINE_WIDTH * dpr`).
 *   - `u_color`      (vec4): resolved lane RGBA.
 *
 * @module components/charts/webgl/glsl/line
 */

export { DENSE_LINE_WIDTH } from '../envelopeGeometry';

export const LINE_VERTEX_SHADER = /* glsl */ `#version 300 es
precision highp float;

in vec2 a_corner;        // (along ∈ {0,1}, side ∈ {-1,+1}) — the unit quad
in vec4 a_segment;       // per-instance [xCur, yCur, xNext, yNext] (data space)

uniform vec2 u_clipScale;
uniform vec2 u_clipOffset;
uniform vec2 u_viewport;     // device px
uniform float u_lineWidthPx; // device px

out vec2 v_devicePos;        // this fragment's device-px position
out vec2 v_segA;             // segment endpoint A in device px
out vec2 v_segB;             // segment endpoint B in device px
out float v_halfWidth;       // half stroke width, device px

vec2 dataToDevice(vec2 d) {
  vec2 clip = d * u_clipScale + u_clipOffset;
  return (clip * 0.5 + 0.5) * u_viewport;
}

void main() {
  vec2 a = dataToDevice(a_segment.xy);
  vec2 b = dataToDevice(a_segment.zw);

  float halfWidth = 0.5 * u_lineWidthPx;
  float cap = halfWidth; // extend ends for round caps/joins

  vec2 dir = b - a;
  float len = length(dir);
  // Degenerate segment (both endpoints coincide in device space): fall back to a
  // fixed axis so the round cap still draws a dot of the right size.
  vec2 t = len > 1e-6 ? dir / len : vec2(1.0, 0.0);
  vec2 nrm = vec2(-t.y, t.x);

  // Position along the segment, extended by 'cap' past each end.
  vec2 base = mix(a - t * cap, b + t * cap, a_corner.x);
  vec2 pos = base + nrm * (a_corner.y * (halfWidth + 0.5)); // +0.5 px AA margin

  v_devicePos = pos;
  v_segA = a;
  v_segB = b;
  v_halfWidth = halfWidth;

  vec2 clip = (pos / u_viewport) * 2.0 - 1.0;
  gl_Position = vec4(clip, 0.0, 1.0);
}
`;

export const LINE_FRAGMENT_SHADER = /* glsl */ `#version 300 es
precision highp float;

in vec2 v_devicePos;
in vec2 v_segA;
in vec2 v_segB;
in float v_halfWidth;

uniform vec4 u_color;

out vec4 fragColor;

// Distance from point p to segment [a,b], in device px.
float distToSegment(vec2 p, vec2 a, vec2 b) {
  vec2 ab = b - a;
  float t = clamp(dot(p - a, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
  vec2 proj = a + t * ab;
  return length(p - proj);
}

void main() {
  float d = distToSegment(v_devicePos, v_segA, v_segB);
  // SDF feather: full coverage inside (halfWidth - 0.5), fading to 0 over ~1 px.
  // The round join/cap falls out for free because distToSegment clamps to the
  // endpoints, so the iso-distance contour is a stadium with semicircular ends.
  float aa = 1.0;
  float coverage = 1.0 - smoothstep(v_halfWidth - 0.5, v_halfWidth + aa - 0.5, d);
  if (coverage <= 0.0) discard;
  // The context is premultipliedAlpha:true and blending is (ONE, ONE_MINUS_SRC_ALPHA),
  // so the drawing buffer holds PREMULTIPLIED colour. Output premultiplied: scale RGB
  // by the same alpha that feathers the edge. If we left RGB at full brightness while
  // only alpha fell off, the compositor would (un)premultiply by the low edge alpha and
  // the feathered pixels would bloom toward white — the classic AA halo. Premultiplying
  // makes edges fade toward transparent black, revealing the dark chart cleanly.
  float a = u_color.a * coverage;
  fragColor = vec4(u_color.rgb * a, a);
}
`;

export const LINE_LOCATIONS = {
  attributes: {
    /** vec2 unit-quad corner (along, side) */
    corner: 'a_corner',
    /** vec4 per-instance segment [xCur, yCur, xNext, yNext] */
    segment: 'a_segment',
  },
  uniforms: {
    clipScale: 'u_clipScale',
    clipOffset: 'u_clipOffset',
    viewport: 'u_viewport',
    lineWidthPx: 'u_lineWidthPx',
    color: 'u_color',
  },
} as const;
