/**
 * Compact windowed Structural Similarity (SSIM) for the WebGL fidelity gate.
 *
 * Dependency-free (no `pixelmatch`/`pngjs`/`image-ssim`) so the gate adds zero
 * runtime or dev dependencies. Operates on a grayscale view of a rectangular
 * region and returns the MEAN SSIM over 8×8 windows (mean-SSIM, the standard
 * single-number summary from Wang et al. 2004, "Image Quality Assessment: From
 * Error Visibility to Structural Similarity").
 *
 * SSIM measures structural agreement (luminance, contrast, structure) rather
 * than raw per-pixel error, so it is the right metric to certify "the WebGL
 * waveform has the same SHAPE as the Canvas2D reference" while tolerating the
 * sub-pixel anti-aliasing differences inherent to two different rasterizers.
 *
 * @module tests/e2e/_support/ssim
 */

/** A grayscale image: row-major `data[y * width + x]` in 0..255. */
export interface GrayImage {
  readonly data: Float64Array;
  readonly width: number;
  readonly height: number;
}

/** SSIM stabilising constants for an 8-bit dynamic range (L = 255). */
const C1 = (0.01 * 255) ** 2;
const C2 = (0.03 * 255) ** 2;
const WINDOW = 8;

/**
 * Convert an RGBA byte buffer (length `width*height*4`) to a grayscale image
 * using the Rec. 601 luma weights. Alpha is ignored (the regions compared are
 * opaque after compositing onto a known background).
 */
export function rgbaToGray(
  rgba: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
): GrayImage {
  const data = new Float64Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const r = rgba[i * 4] ?? 0;
    const g = rgba[i * 4 + 1] ?? 0;
    const b = rgba[i * 4 + 2] ?? 0;
    data[i] = 0.299 * r + 0.587 * g + 0.114 * b;
  }
  return { data, width, height };
}

/**
 * Mean windowed SSIM between two equal-size grayscale images. Non-overlapping
 * 8×8 windows (a partial trailing window is skipped); returns the average SSIM
 * across all full windows, in [-1, 1] (1 = identical structure).
 */
export function meanSsim(a: GrayImage, b: GrayImage): number {
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error(`SSIM size mismatch: ${a.width}x${a.height} vs ${b.width}x${b.height}`);
  }
  const { width, height } = a;
  let total = 0;
  let windows = 0;

  for (let wy = 0; wy + WINDOW <= height; wy += WINDOW) {
    for (let wx = 0; wx + WINDOW <= width; wx += WINDOW) {
      total += windowSsim(a, b, wx, wy);
      windows++;
    }
  }

  if (windows === 0) {
    // Region smaller than one window: fall back to a single global comparison.
    return globalSsim(a, b);
  }
  return total / windows;
}

/** SSIM over a single WINDOW×WINDOW block whose top-left is (ox, oy). */
function windowSsim(a: GrayImage, b: GrayImage, ox: number, oy: number): number {
  const n = WINDOW * WINDOW;
  let sumA = 0;
  let sumB = 0;
  for (let y = 0; y < WINDOW; y++) {
    const row = (oy + y) * a.width + ox;
    for (let x = 0; x < WINDOW; x++) {
      sumA += a.data[row + x] ?? 0;
      sumB += b.data[row + x] ?? 0;
    }
  }
  const muA = sumA / n;
  const muB = sumB / n;

  let varA = 0;
  let varB = 0;
  let cov = 0;
  for (let y = 0; y < WINDOW; y++) {
    const row = (oy + y) * a.width + ox;
    for (let x = 0; x < WINDOW; x++) {
      const da = (a.data[row + x] ?? 0) - muA;
      const db = (b.data[row + x] ?? 0) - muB;
      varA += da * da;
      varB += db * db;
      cov += da * db;
    }
  }
  varA /= n - 1;
  varB /= n - 1;
  cov /= n - 1;

  const num = (2 * muA * muB + C1) * (2 * cov + C2);
  const den = (muA * muA + muB * muB + C1) * (varA + varB + C2);
  return den === 0 ? 1 : num / den;
}

/** Global single-window SSIM (used when the region is smaller than 8×8). */
function globalSsim(a: GrayImage, b: GrayImage): number {
  const n = a.data.length;
  if (n === 0) return 1;
  let sumA = 0;
  let sumB = 0;
  for (let i = 0; i < n; i++) {
    sumA += a.data[i] ?? 0;
    sumB += b.data[i] ?? 0;
  }
  const muA = sumA / n;
  const muB = sumB / n;
  let varA = 0;
  let varB = 0;
  let cov = 0;
  for (let i = 0; i < n; i++) {
    const da = (a.data[i] ?? 0) - muA;
    const db = (b.data[i] ?? 0) - muB;
    varA += da * da;
    varB += db * db;
    cov += da * db;
  }
  varA /= Math.max(1, n - 1);
  varB /= Math.max(1, n - 1);
  cov /= Math.max(1, n - 1);
  const num = (2 * muA * muB + C1) * (2 * cov + C2);
  const den = (muA * muA + muB * muB + C1) * (varA + varB + C2);
  return den === 0 ? 1 : num / den;
}
