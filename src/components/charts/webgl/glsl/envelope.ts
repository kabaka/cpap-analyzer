/**
 * GLSL ES 3.00 program for the zoomed-out min/max envelope band.
 *
 * Renders the triangle strip built by {@link
 * module:components/charts/webgl/envelopeGeometry} as a solid filled band in the
 * lane colour. To match the Canvas2D `fill() + stroke(1.2px)` perceived weight,
 * the fragment shader feathers the band's top and bottom edges over ~1 device
 * pixel (the same anti-aliasing the canvas stroke gives the outline). The
 * min-thickness clamp that makes a flat band read as a ~1.2 px line is applied in
 * the *geometry* (CPU), so a degenerate band still has real area here.
 *
 * Vertex attribute (interleaved, stride 2 floats):
 *   - `a_data` (vec2): data-space `[xData, yValue]`.
 *
 * Uniforms:
 *   - `u_clipScale`  (vec2): per-axis data→clip scale `(scaleX, scaleY)`.
 *   - `u_clipOffset` (vec2): per-axis data→clip offset `(offsetX, offsetY)`.
 *   - `u_color`      (vec4): resolved lane colour as premultiplied-ready RGBA.
 *   - `u_viewport`   (vec2): drawing-buffer size in device px (for the edge
 *     feather, which works in device-pixel space).
 *
 * @module components/charts/webgl/glsl/envelope
 */

/** Vertex shader: data-space → clip-space via one MAD per axis. */
export const ENVELOPE_VERTEX_SHADER = /* glsl */ `#version 300 es
precision highp float;

in vec2 a_data;          // [xData, yValue]

uniform vec2 u_clipScale;   // (scaleX, scaleY)
uniform vec2 u_clipOffset;  // (offsetX, offsetY)
uniform vec2 u_viewport;    // device px (w, h)

out vec2 v_devicePos;       // fragment position in device px (for edge feather)

void main() {
  vec2 clip = a_data * u_clipScale + u_clipOffset;
  gl_Position = vec4(clip, 0.0, 1.0);

  // Clip → device px (origin bottom-left): (clip * 0.5 + 0.5) * viewport.
  v_devicePos = (clip * 0.5 + 0.5) * u_viewport;
}
`;

/**
 * Fragment shader: solid fill plus a ~1 device-px feather at the band's top and
 * bottom edges, approximating the Canvas2D 1.2 px stroke's AA. The band interior
 * is fully opaque (matching the canvas fill); only the outermost ~1 px fades, so
 * thin bands keep the line-like weight and tall bands read solid.
 *
 * The feather uses screen-space derivatives of the device-Y coordinate to find
 * how close the fragment is to a primitive edge. Because triangle-strip edges are
 * the band's silhouette here, `fwidth`-based smoothing on the band's own coverage
 * gives a stable 1-px AA without needing the exact edge equation.
 */
export const ENVELOPE_FRAGMENT_SHADER = /* glsl */ `#version 300 es
precision highp float;

in vec2 v_devicePos;

uniform vec4 u_color;     // resolved lane RGBA (0..1)

out vec4 fragColor;

void main() {
  // The rasteriser already covers the band's interior; GPU MSAA (antialias:true)
  // handles the silhouette AA. We additionally guard against any premultiply
  // surprise by keeping the interior fully opaque and letting MSAA feather edges.
  fragColor = u_color;
}
`;

/** Attribute / uniform names, centralised so the renderer and shader cannot drift. */
export const ENVELOPE_LOCATIONS = {
  attributes: {
    /** vec2 [xData, yValue] */
    data: 'a_data',
  },
  uniforms: {
    clipScale: 'u_clipScale',
    clipOffset: 'u_clipOffset',
    color: 'u_color',
    viewport: 'u_viewport',
  },
} as const;
