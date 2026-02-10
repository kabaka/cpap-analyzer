# Browser Support

**Version**: 1.0  
**Last Updated**: February 10, 2026  
**Status**: Canonical Reference  
**Audience**: Patients, Users, Development Team

## Overview

CPAP Analyzer is a modern web application that requires up-to-date browser features to handle large medical datasets efficiently and privately. This document specifies which browsers are supported and why certain features are required.

---

## Minimum Requirements

The following table lists the minimum browser versions required to run CPAP Analyzer:

| Browser | Minimum Version | Release Date |
|---------|----------------|--------------|
| **Chrome** | 102 | May 2022 |
| **Microsoft Edge** | 102 | June 2022 |
| **Firefox** | 111 | March 2023 |
| **Safari** | 15.2 | December 2021 |
| **iOS Safari** | 15.2 | December 2021 |
| **Chrome for Android** | 102 | May 2022 |
| **Samsung Internet** | 19.0 | April 2022 |

### Not Supported

The following browsers are **not supported** and will not work with CPAP Analyzer:

- ❌ Internet Explorer (any version)
- ❌ Opera Mini (any version)
- ❌ Old Android Browser (pre-Chromium)
- ❌ UC Browser
- ❌ Browsers without JavaScript enabled

---

## Required Browser Features

CPAP Analyzer requires the following modern browser features. Each is essential for the app's performance, privacy, or functionality.

### **OPFS (Origin Private File System)**

**What it is**: A browser API that provides high-performance file storage for web applications.

**Why we need it**: CPAP therapy data includes high-frequency signal data (25–50 Hz sampling rate). A single night of data can be 10–50 MB. Years of data can exceed 5 GB. OPFS allows us to store this data efficiently and access it quickly for analysis.

**Browser support**:
- ✅ Chrome 102+ (stable)
- ✅ Edge 102+ (stable)
- ⚠️ Firefox 111+ (requires `dom.fs.enabled` flag in `about:config`)
- ⚠️ Safari 15.2+ (partial support, slower performance)

**What happens if unavailable**: The app falls back to IndexedDB storage, which is slower but functional for smaller datasets.

---

### **IndexedDB**

**What it is**: A browser database for storing structured data.

**Why we need it**: Used for session metadata, user preferences, and as a fallback when OPFS is unavailable.

**Browser support**:
- ✅ All modern browsers (Chrome 24+, Firefox 16+, Safari 10+, Edge 12+)

**What happens if unavailable**: The app cannot run. IndexedDB is a hard requirement.

---

### **Web Workers**

**What it is**: A browser feature that allows JavaScript to run in background threads, keeping the UI responsive.

**Why we need it**: Signal processing (filtering, resampling, statistical analysis) is computationally intensive. Without Web Workers, the browser UI would freeze during analysis.

**Browser support**:
- ✅ All modern browsers (Chrome 4+, Firefox 3.5+, Safari 4+, Edge 12+)

**What happens if unavailable**: The app falls back to main-thread processing, which will cause the UI to freeze during analysis. Large datasets may become unusable.

---

### **ES2020+ Features**

**What it is**: Modern JavaScript language features including:
- Optional chaining (`obj?.prop`)
- Nullish coalescing (`value ?? default`)
- BigInt (for precise timestamps)
- `Promise.allSettled` (for batch operations)

**Why we need it**: These features make the code more robust and prevent common bugs. TypeScript compiles to ES2020 target.

**Browser support**:
- ✅ Chrome 80+, Firefox 74+, Safari 13.1+, Edge 80+

**What happens if unavailable**: The app will not load. A browser upgrade message will be shown.

---

### **Canvas 2D / OffscreenCanvas**

**What it is**: APIs for rendering graphics and visualizations.

**Why we need it**: CPAP Analyzer renders time-series charts with thousands of data points. Canvas provides the performance needed for smooth, interactive visualizations.

**Browser support**:
- ✅ Canvas 2D: All modern browsers
- ✅ OffscreenCanvas: Chrome 69+, Firefox 105+, Edge 79+
- ⚠️ OffscreenCanvas Safari: Not yet supported (falls back to Canvas 2D)

**What happens if unavailable**: Charts will fall back to Canvas 2D (no performance impact for most users). Without any Canvas support, the app cannot run.

---

### **Native ESM (ES Modules)**

**What it is**: Modern JavaScript module system using `import` and `export`.

**Why we need it**: Vite (our build tool) generates ESM bundles for optimal loading performance and tree-shaking.

**Browser support**:
- ✅ Chrome 61+, Firefox 60+, Safari 11+, Edge 16+

**What happens if unavailable**: The app will not load.

---

## Browser Compatibility Table

Full feature matrix:

| Browser | Min Version | OPFS | IndexedDB | Workers | ES2020 | OffscreenCanvas | Notes |
|---------|-------------|------|-----------|---------|--------|-----------------|-------|
| **Chrome** | 102 | ✅ | ✅ | ✅ | ✅ | ✅ | Recommended |
| **Edge (Chromium)** | 102 | ✅ | ✅ | ✅ | ✅ | ✅ | Recommended |
| **Firefox** | 111 | ⚠️ | ✅ | ✅ | ✅ | ✅ | Requires flag* |
| **Safari** | 15.2 | ⚠️ | ✅ | ✅ | ✅ | ❌ | Slower OPFS |
| **iOS Safari** | 15.2 | ⚠️ | ✅ | ✅ | ✅ | ❌ | Memory limits |
| **Chrome Android** | 102 | ✅ | ✅ | ✅ | ✅ | ✅ | Good |
| **Samsung Internet** | 19.0 | ✅ | ✅ | ✅ | ✅ | ✅ | Good |

**Legend**:
- ✅ Fully supported
- ⚠️ Partial support or requires configuration
- ❌ Not supported (fallback available)

**Notes**:
- \*Firefox OPFS: Must enable `dom.fs.enabled` in `about:config` (expected to be default in future release)
- Safari OPFS: Experimental support, may be slower than Chrome/Firefox

---

## Fallback Behavior

CPAP Analyzer is designed to fail gracefully when advanced features are unavailable. For full technical details, see [Frontend Architecture — Section 17](design/frontend-architecture.md#17-browser-compatibility--fallback-strategy).

### **OPFS Unavailable**

- **Fallback**: IndexedDB storage
- **Impact**: Slower read/write performance for large datasets
- **User experience**: Functional but may lag with years of data
- **Recommendation**: Use Chrome or Edge for best performance

### **Web Workers Unavailable**

- **Fallback**: Main-thread processing
- **Impact**: UI will freeze during signal processing
- **User experience**: Analysis still works, but browser may be unresponsive for 5–30 seconds during computation
- **Recommendation**: Upgrade to a modern browser

### **OffscreenCanvas Unavailable**

- **Fallback**: Canvas 2D rendering
- **Impact**: None for most users
- **User experience**: Identical to OffscreenCanvas
- **Recommendation**: No action needed

### **ES2020 Unsupported**

- **Fallback**: None
- **Impact**: App will not load
- **User experience**: Error page with upgrade instructions
- **Recommendation**: Upgrade browser to supported version

---

## How to Check Your Browser

### Option 1: Open CPAP Analyzer

The easiest way to check compatibility is to open the app. If your browser is unsupported, you'll see a clear warning message with specific upgrade recommendations.

### Option 2: Check Manually

1. **Find your browser version**:
   - Chrome/Edge: Visit `chrome://version` or `edge://version`
   - Firefox: Visit `about:support`
   - Safari: Safari menu → About Safari

2. **Check against the minimum requirements table** above.

3. **Verify critical features**:
   - Visit [caniuse.com](https://caniuse.com) and search for:
     - "Origin Private File System"
     - "IndexedDB"
     - "Web Workers"
     - "Optional chaining"

### Option 3: Use Detection Tools

- [whatismybrowser.com](https://www.whatismybrowser.com) — Shows your browser version and whether it's up to date
- [caniuse.com](https://caniuse.com) — Check specific feature support

---

## Recommended Browsers

### For Best Experience

**Desktop**:
1. **Chrome 102+** (recommended) — Best performance, all features supported
2. **Microsoft Edge 102+** — Equivalent to Chrome, good Windows integration
3. **Firefox 111+** — Good performance, requires OPFS flag

**Mobile**:
1. **iOS Safari 15.2+** on iPhone/iPad — Native iOS browser, good performance
2. **Chrome 102+ for Android** — Best Android experience

### Performance Considerations

- **Desktop browsers are faster** than mobile browsers due to more available memory
- **Large datasets (years of data)** work best on desktop with Chrome/Edge
- **Mobile devices** may struggle with datasets larger than 1–2 GB due to memory constraints

---

## Known Issues

### Browser-Specific Issues

**Safari / iOS Safari**:
- OPFS support is experimental and slower than Chrome/Firefox
- File import may require explicit user interaction due to iOS security restrictions
- Memory limits on iOS devices may prevent loading very large datasets (5+ GB)

**Firefox**:
- OPFS requires enabling `dom.fs.enabled` flag in `about:config`
- This flag is expected to become default in a future Firefox release

**Mobile Browsers (All)**:
- Memory constraints limit maximum dataset size
- Chart interactions may be less responsive than desktop due to touch event handling
- File System Access API not available on iOS (uses fallback file picker)

### Performance Guidance

- **Chromium-based browsers (Chrome, Edge, Opera)**: Fastest performance, recommended for large datasets
- **Firefox**: Good performance after enabling OPFS flag
- **Safari**: Functional but slower for datasets over 1 GB
- **Mobile**: Best for small to medium datasets (under 1 GB)

---

## Testing

CPAP Analyzer is tested across multiple browsers to ensure compatibility:

### Automated Testing

- **Playwright E2E tests** run on:
  - Chromium (Chrome/Edge equivalent)
  - Firefox
  - WebKit (Safari equivalent)

- **Unit tests** run in Node.js environment (Vitest)

### Manual Testing

- **Safari** on macOS — Tested manually for each release
- **iOS Safari** on iPhone/iPad — Tested manually for mobile experience
- **Chrome for Android** — Tested manually for Android experience

### User-Agent Detection

The app checks for known problematic browser configurations:
- Internet Explorer (blocked with upgrade message)
- Very old browsers (ES2020 feature detection)
- Opera Mini (blocked due to limited JavaScript support)

---

## Updating This Document

This document should be updated when:

1. **New browser version** changes feature support (e.g., Firefox enables OPFS by default)
2. **New feature** is added to CPAP Analyzer that requires additional browser capabilities
3. **Browser-specific bug** is discovered or fixed
4. **Minimum version** is raised due to security or performance requirements

**Update Process**:
1. Update this document first
2. Update [Frontend Architecture — Section 17](design/frontend-architecture.md#17-browser-compatibility--fallback-strategy) if architectural changes are needed
3. Update browser detection code in `src/utils/feature-detection.ts` if needed
4. Run tests: `npm run test` and `npm run test:e2e`
5. Commit with message: `docs: update browser support matrix`

---

## References

- [Can I Use](https://caniuse.com) — Browser feature support tables
- [MDN Browser Compatibility Data](https://github.com/mdn/browser-compat-data) — Authoritative feature support data
- [Frontend Architecture](design/frontend-architecture.md) — Technical implementation details (Section 17)
- [Vision Document](vision.md) — Project goals and constraints
