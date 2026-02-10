# Unit Testing Strategy — CPAP Analyzer

**Version**: 1.0  
**Last Updated**: February 10, 2026  
**Status**: Architecture Decision Record  
**Audience**: Unit Tester, QA, all implementation agents

## Executive Summary

This document defines the comprehensive unit testing strategy for CPAP Analyzer. Unit testing is a first-class concern, integrated into the development workflow through pre-commit hooks and CI/CD pipelines. Tests must be fast, reliable, and focused on behavior rather than implementation details.

### Core Testing Principles

1. **Test Behavior, Not Implementation**: Tests should verify public contracts, not internal implementation details.
2. **Fast Execution**: Full test suite must run in under 10 seconds to enable rapid iteration.
3. **Isolation**: Each test must be independent; no shared mutable state between tests.
4. **Determinism**: Tests must produce identical results on every run with the same inputs.
5. **Readability**: Test names and structure should serve as living documentation.
6. **Mock External Dependencies**: IndexedDB, OPFS, Web Workers, and Web APIs must be mocked.

### Testing Framework

- **Framework**: Vitest (fast, ESM-native, Vite-compatible)
- **Runner**: Vitest CLI with watch mode for development
- **Coverage**: V8 coverage provider (fast, accurate)
- **Assertions**: Expect API (Jest-compatible)
- **Mocking**: Vitest's built-in `vi.mock()` and `vi.fn()`

---

## 1. Testing Framework Configuration

### 1.1 Vitest Configuration

**File**: `vitest.config.ts`

```typescript
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  
  test: {
    // Environment
    environment: 'jsdom', // DOM environment for React component tests
    
    // Globals
    globals: true, // Enable global test APIs (describe, it, expect)
    
    // Setup
    setupFiles: ['./src/test/setup.ts'],
    
    // Coverage
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov', 'json'],
      exclude: [
        '**/node_modules/**',
        '**/dist/**',
        '**/*.test.ts',
        '**/*.test.tsx',
        '**/test/**',
        '**/__tests__/**',
        '**/coverage/**',
        '**/*.config.ts',
        '**/*.d.ts',
        '**/types/**',
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 75,
        statements: 80,
      },
      all: true,
      clean: true,
    },
    
    // Performance
    pool: 'threads',
    poolOptions: {
      threads: {
        singleThread: false,
        minThreads: 1,
        maxThreads: 4,
      },
    },
    
    // Isolation
    isolate: true,
    
    // Timeouts
    testTimeout: 5000,
    hookTimeout: 10000,
    
    // Watch mode
    watch: false, // Disabled by default (use --watch flag)
    
    // File patterns
    include: ['**/*.test.ts', '**/*.test.tsx'],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/e2e/**',
      '**/.{idea,git,cache,output,temp}/**',
    ],
    
    // Reporters
    reporters: ['default'],
    
    // Silent mode for CI
    silent: false,
    
    // Fail on console warnings/errors
    onConsoleLog: (log, type) => {
      if (type === 'stderr') return false; // Allow stderr for debugging
      return true;
    },
  },
  
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@test': path.resolve(__dirname, './src/test'),
    },
  },
});
```

### 1.2 Test Setup File

**File**: `src/test/setup.ts`

```typescript
import { afterEach, beforeAll, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

// Cleanup after each test
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.clearAllTimers();
});

// Setup global mocks
beforeAll(() => {
  // Mock IndexedDB
  global.indexedDB = {
    open: vi.fn(),
    deleteDatabase: vi.fn(),
    databases: vi.fn(),
  } as any;
  
  // Mock OPFS (File System Access API)
  global.navigator.storage = {
    getDirectory: vi.fn(),
    estimate: vi.fn(),
  } as any;
  
  // Mock Web Workers
  global.Worker = vi.fn().mockImplementation(() => ({
    postMessage: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    terminate: vi.fn(),
  }));
  
  // Mock Comlink (for Worker communication)
  vi.mock('comlink', () => ({
    wrap: vi.fn(),
    expose: vi.fn(),
    transfer: vi.fn(),
  }));
  
  // Mock crypto.randomUUID for deterministic IDs in tests
  global.crypto.randomUUID = vi.fn(() => 'test-uuid-' + Math.random());
  
  // Mock performance.now for deterministic timing
  let mockTime = 0;
  global.performance.now = vi.fn(() => mockTime++);
  
  // Suppress console warnings in tests (can be overridden per-test)
  global.console.warn = vi.fn();
  global.console.error = vi.fn();
});

// Custom matchers
expect.extend({
  toBeWithinRange(received: number, floor: number, ceiling: number) {
    const pass = received >= floor && received <= ceiling;
    return {
      pass,
      message: () =>
        pass
          ? `expected ${received} not to be within range ${floor} - ${ceiling}`
          : `expected ${received} to be within range ${floor} - ${ceiling}`,
    };
  },
  
  toBeCloseToDuration(received: number, expected: number, toleranceMs: number = 100) {
    const pass = Math.abs(received - expected) <= toleranceMs;
    return {
      pass,
      message: () =>
        pass
          ? `expected ${received}ms not to be close to ${expected}ms (tolerance: ${toleranceMs}ms)`
          : `expected ${received}ms to be close to ${expected}ms (tolerance: ${toleranceMs}ms)`,
    };
  },
});
```

---

## 2. Test Organization

### 2.1 Directory Structure

```
src/
├── components/
│   ├── Button/
│   │   ├── Button.tsx
│   │   ├── Button.test.tsx          # Co-located unit tests
│   │   └── Button.module.css
│   └── SessionCard/
│       ├── SessionCard.tsx
│       ├── SessionCard.test.tsx
│       └── SessionCard.module.css
├── stores/
│   ├── useAppStore.ts
│   └── useAppStore.test.ts          # Co-located tests
├── lib/
│   ├── storage/
│   │   ├── indexeddb.ts
│   │   ├── indexeddb.test.ts
│   │   ├── opfs.ts
│   │   └── opfs.test.ts
│   ├── analysis/
│   │   ├── statistics.ts
│   │   ├── statistics.test.ts
│   │   ├── clustering.ts
│   │   └── clustering.test.ts
│   └── parsers/
│       ├── edf.ts
│       ├── edf.test.ts
│       ├── resmed.ts
│       └── resmed.test.ts
├── plugins/
│   ├── machines/
│   │   └── resmed/
│   │       ├── index.ts
│   │       ├── index.test.ts
│   │       └── __tests__/              # Integration tests
│   │           └── import.integration.test.ts
│   └── analysis/
│       └── trend/
│           ├── index.ts
│           └── index.test.ts
├── workers/
│   ├── analysis.worker.ts
│   ├── analysis.worker.test.ts
│   ├── import.worker.ts
│   └── import.worker.test.ts
└── test/
    ├── setup.ts                        # Global test setup
    ├── fixtures/                       # Test data fixtures
    │   ├── sessions.ts
    │   ├── edf-files.ts
    │   └── analysis-results.ts
    ├── mocks/                          # Mock implementations
    │   ├── indexeddb.ts
    │   ├── opfs.ts
    │   ├── workers.ts
    │   └── comlink.ts
    ├── factories/                      # Test data factories
    │   ├── session.factory.ts
    │   ├── aggregate.factory.ts
    │   └── event.factory.ts
    └── helpers/                        # Test utilities
        ├── async.ts
        ├── dom.ts
        └── render.tsx
```

### 2.2 File Naming Conventions

| Type | Pattern | Example |
|------|---------|---------|
| **Unit tests** | `<module>.test.ts` | `statistics.test.ts` |
| **Component tests** | `<Component>.test.tsx` | `Button.test.tsx` |
| **Integration tests** | `<feature>.integration.test.ts` | `import.integration.test.ts` |
| **Contract tests** | `<plugin>.contract.test.ts` | `machine-plugin.contract.test.ts` |

### 2.3 Test Suite Organization

```typescript
// Example: src/lib/analysis/statistics.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { calculateMean, calculateMedian, calculatePercentile } from './statistics';

describe('statistics', () => {
  describe('calculateMean', () => {
    it('should calculate mean of positive numbers', () => {
      // Arrange
      const values = [1, 2, 3, 4, 5];
      
      // Act
      const result = calculateMean(values);
      
      // Assert
      expect(result).toBe(3);
    });
    
    it('should handle empty array', () => {
      expect(() => calculateMean([])).toThrow('Cannot calculate mean of empty array');
    });
    
    it('should handle negative numbers', () => {
      expect(calculateMean([-1, -2, -3])).toBe(-2);
    });
    
    it('should handle floating point precision', () => {
      expect(calculateMean([0.1, 0.2, 0.3])).toBeCloseTo(0.2);
    });
  });
  
  describe('calculateMedian', () => {
    it('should calculate median of odd-length array', () => {
      expect(calculateMedian([1, 3, 5])).toBe(3);
    });
    
    it('should calculate median of even-length array', () => {
      expect(calculateMedian([1, 2, 3, 4])).toBe(2.5);
    });
    
    it('should not mutate input array', () => {
      const values = [3, 1, 2];
      calculateMedian(values);
      expect(values).toEqual([3, 1, 2]);
    });
  });
  
  describe('calculatePercentile', () => {
    it('should calculate 95th percentile', () => {
      const values = Array.from({ length: 100 }, (_, i) => i + 1);
      expect(calculatePercentile(values, 95)).toBe(95);
    });
    
    it('should validate percentile range', () => {
      expect(() => calculatePercentile([1, 2, 3], 101)).toThrow(
        'Percentile must be between 0 and 100'
      );
    });
  });
});
```

---

## 3. Testing Patterns

### 3.1 Component Testing

**Testing Library**: `@testing-library/react` with Vitest

**Pattern**: Focus on user interactions and rendered output, not implementation details.

```typescript
// Example: src/components/SessionCard/SessionCard.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SessionCard } from './SessionCard';
import { createMockSession } from '@test/factories/session.factory';

describe('SessionCard', () => {
  it('should render session date and metrics', () => {
    const session = createMockSession({
      date: '2026-02-10',
      ahi: 5.2,
      usageHours: 7.5,
    });
    
    render(<SessionCard session={session} />);
    
    expect(screen.getByText('Feb 10, 2026')).toBeInTheDocument();
    expect(screen.getByText('AHI: 5.2')).toBeInTheDocument();
    expect(screen.getByText('7.5 hours')).toBeInTheDocument();
  });
  
  it('should call onSelect when clicked', () => {
    const session = createMockSession();
    const handleSelect = vi.fn();
    
    render(<SessionCard session={session} onSelect={handleSelect} />);
    
    fireEvent.click(screen.getByRole('button'));
    
    expect(handleSelect).toHaveBeenCalledWith(session.id);
  });
  
  it('should apply selected style when selected', () => {
    const session = createMockSession();
    
    const { rerender } = render(<SessionCard session={session} selected={false} />);
    expect(screen.getByRole('button')).not.toHaveClass('selected');
    
    rerender(<SessionCard session={session} selected={true} />);
    expect(screen.getByRole('button')).toHaveClass('selected');
  });
  
  it('should display compliance status indicator', () => {
    const session = createMockSession({ usageHours: 3.0 });
    render(<SessionCard session={session} />);
    
    const indicator = screen.getByTestId('compliance-indicator');
    expect(indicator).toHaveAttribute('data-status', 'non-compliant');
  });
});
```

### 3.2 Service/Utility Testing

**Pattern**: Pure functions are the easiest to test. Focus on edge cases and boundary conditions.

```typescript
// Example: src/lib/parsers/edf.test.ts
import { describe, it, expect } from 'vitest';
import { parseEDFHeader, convertSignalToPhysical } from './edf';
import { createMockEDFBuffer } from '@test/fixtures/edf-files';

describe('EDF Parser', () => {
  describe('parseEDFHeader', () => {
    it('should parse valid EDF header', () => {
      const buffer = createMockEDFBuffer({
        version: '0       ',
        startDate: '10.02.26',
        startTime: '22.30.00',
        numberOfSignals: 5,
      });
      
      const header = parseEDFHeader(buffer);
      
      expect(header.version).toBe('0');
      expect(header.startDate).toBe('2026-02-10');
      expect(header.startTime).toBe('22:30:00');
      expect(header.numberOfSignals).toBe(5);
    });
    
    it('should validate header size', () => {
      const tooSmall = new ArrayBuffer(100);
      expect(() => parseEDFHeader(tooSmall)).toThrow('Invalid EDF header size');
    });
    
    it('should parse signal labels', () => {
      const buffer = createMockEDFBuffer({
        signals: [
          { label: 'Flow            ', physicalMin: -200, physicalMax: 200 },
          { label: 'MaskPressure    ', physicalMin: 0, physicalMax: 30 },
        ],
      });
      
      const header = parseEDFHeader(buffer);
      
      expect(header.signals).toHaveLength(2);
      expect(header.signals[0].label).toBe('Flow');
      expect(header.signals[1].label).toBe('MaskPressure');
    });
  });
  
  describe('convertSignalToPhysical', () => {
    it('should convert digital values to physical units', () => {
      const config = {
        digitalMin: -32768,
        digitalMax: 32767,
        physicalMin: -200,
        physicalMax: 200,
      };
      
      // Test zero point
      expect(convertSignalToPhysical(0, config)).toBeCloseTo(0, 2);
      
      // Test positive max
      expect(convertSignalToPhysical(32767, config)).toBeCloseTo(200, 2);
      
      // Test negative max
      expect(convertSignalToPhysical(-32768, config)).toBeCloseTo(-200, 2);
      
      // Test midpoint
      expect(convertSignalToPhysical(16384, config)).toBeCloseTo(100, 2);
    });
    
    it('should handle edge case of zero range', () => {
      const config = {
        digitalMin: 0,
        digitalMax: 0,
        physicalMin: 10,
        physicalMax: 10,
      };
      
      expect(convertSignalToPhysical(0, config)).toBe(10);
    });
  });
});
```

### 3.3 Worker Testing

**Pattern**: Mock Worker postMessage and message events. Test both main thread and worker logic separately.

```typescript
// Example: src/workers/analysis.worker.test.ts
import { describe, it, expect, vi } from 'vitest';
import { exposeAnalysisWorker } from './analysis.worker';

// Mock Comlink
vi.mock('comlink', () => ({
  expose: (obj: any) => obj, // Return the object for testing
}));

describe('Analysis Worker', () => {
  it('should expose worker API', () => {
    const workerAPI = exposeAnalysisWorker();
    
    expect(workerAPI).toHaveProperty('computeRollingAverage');
    expect(workerAPI).toHaveProperty('detectClusters');
    expect(workerAPI).toHaveProperty('analyzeTimeSeries');
  });
  
  describe('computeRollingAverage', () => {
    it('should compute 7-day rolling average', async () => {
      const workerAPI = exposeAnalysisWorker();
      const data = Array.from({ length: 30 }, (_, i) => ({
        date: `2026-01-${String(i + 1).padStart(2, '0')}`,
        value: i + 1,
      }));
      
      const result = await workerAPI.computeRollingAverage(data, 7);
      
      expect(result).toHaveLength(30);
      expect(result[6].value).toBeCloseTo(4, 1); // Mean of 1-7
      expect(result[7].value).toBeCloseTo(5, 1); // Mean of 2-8
    });
    
    it('should handle insufficient data', async () => {
      const workerAPI = exposeAnalysisWorker();
      const data = [
        { date: '2026-01-01', value: 1 },
        { date: '2026-01-02', value: 2 },
      ];
      
      await expect(workerAPI.computeRollingAverage(data, 7)).rejects.toThrow(
        'Insufficient data for 7-day rolling average'
      );
    });
  });
});
```

### 3.4 Plugin Testing

**Pattern**: Test both plugin interface conformance (contract tests) and plugin functionality (unit tests).

```typescript
// Example: src/plugins/machines/resmed/index.test.ts
import { describe, it, expect } from 'vitest';
import { resmédPlugin } from './index';
import { MachinePlugin } from '@/plugins/types';

describe('ResMed Machine Plugin', () => {
  it('should implement MachinePlugin interface', () => {
    expect(resmédPlugin).toMatchObject({
      metadata: expect.objectContaining({
        id: expect.any(String),
        name: expect.any(String),
        version: expect.any(String),
        manufacturer: 'ResMed',
      }),
      supportedModels: expect.any(Array),
      canParse: expect.any(Function),
      parseSession: expect.any(Function),
    });
  });
  
  it('should identify supported machine models', () => {
    expect(resmédPlugin.supportedModels).toContain('AirSense 10 AutoSet');
    expect(resmédPlugin.supportedModels).toContain('AirSense 11 AutoSet');
    expect(resmédPlugin.supportedModels).toContain('AirCurve 10 VAuto');
  });
  
  describe('canParse', () => {
    it('should detect ResMed EDF files', async () => {
      const mockedFile = new File([], 'BRP.edf', { type: 'application/octet-stream' });
      expect(await resmédPlugin.canParse(mockedFile)).toBe(true);
    });
    
    it('should reject non-EDF files', async () => {
      const textFile = new File(['text'], 'data.txt', { type: 'text/plain' });
      expect(await resmédPlugin.canParse(textFile)).toBe(false);
    });
  });
  
  describe('parseSession', () => {
    it('should parse single-night session', async () => {
      const files = [createMockEDFFile('BRP.edf')];
      const result = await resmédPlugin.parseSession(files);
      
      expect(result).toMatchObject({
        machineId: expect.any(String),
        machineModel: expect.any(String),
        date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        channels: expect.arrayContaining([
          expect.objectContaining({ name: 'Flow' }),
          expect.objectContaining({ name: 'MaskPressure' }),
        ]),
      });
    });
  });
});
```

### 3.5 Storage Layer Mocking

**IndexedDB Mock Pattern**:

```typescript
// src/test/mocks/indexeddb.ts
import { vi } from 'vitest';

export class MockIDBDatabase {
  private stores = new Map<string, MockIDBObjectStore>();
  
  transaction(storeNames: string[], mode: 'readonly' | 'readwrite') {
    return new MockIDBTransaction(this, storeNames, mode);
  }
  
  objectStoreNames() {
    return Array.from(this.stores.keys());
  }
  
  createObjectStore(name: string, options?: IDBObjectStoreParameters) {
    const store = new MockIDBObjectStore(name, options);
    this.stores.set(name, store);
    return store;
  }
  
  getStore(name: string) {
    return this.stores.get(name);
  }
}

export class MockIDBObjectStore {
  private data = new Map<string, any>();
  private indices = new Map<string, MockIDBIndex>();
  
  constructor(
    public name: string,
    private options?: IDBObjectStoreParameters
  ) {}
  
  add(value: any, key?: IDBValidKey) {
    const useKey = key ?? this.extractKey(value);
    this.data.set(String(useKey), value);
    return Promise.resolve(useKey);
  }
  
  get(key: IDBValidKey) {
    return Promise.resolve(this.data.get(String(key)));
  }
  
  getAll(query?: IDBValidKey | IDBKeyRange) {
    return Promise.resolve(Array.from(this.data.values()));
  }
  
  put(value: any, key?: IDBValidKey) {
    const useKey = key ?? this.extractKey(value);
    this.data.set(String(useKey), value);
    return Promise.resolve(useKey);
  }
  
  delete(key: IDBValidKey) {
    this.data.delete(String(key));
    return Promise.resolve();
  }
  
  clear() {
    this.data.clear();
    return Promise.resolve();
  }
  
  createIndex(name: string, keyPath: string | string[], options?: IDBIndexParameters) {
    const index = new MockIDBIndex(name, keyPath, this.data);
    this.indices.set(name, index);
    return index;
  }
  
  index(name: string) {
    const idx = this.indices.get(name);
    if (!idx) throw new Error(`Index ${name} not found`);
    return idx;
  }
  
  private extractKey(value: any): IDBValidKey {
    if (this.options?.keyPath) {
      return value[this.options.keyPath as string];
    }
    throw new Error('No key path defined');
  }
}

export class MockIDBIndex {
  constructor(
    public name: string,
    private keyPath: string | string[],
    private data: Map<string, any>
  ) {}
  
  get(key: IDBValidKey) {
    const found = Array.from(this.data.values()).find(item =>
      this.getKeyValue(item) === key
    );
    return Promise.resolve(found);
  }
  
  getAll(query?: IDBValidKey | IDBKeyRange) {
    return Promise.resolve(Array.from(this.data.values()));
  }
  
  private getKeyValue(item: any): any {
    if (typeof this.keyPath === 'string') {
      return item[this.keyPath];
    }
    return this.keyPath.map(path => item[path]);
  }
}

export function mockIndexedDB() {
  const databases = new Map<string, MockIDBDatabase>();
  
  global.indexedDB = {
    open: vi.fn((name: string, version?: number) => {
      let db = databases.get(name);
      if (!db) {
        db = new MockIDBDatabase();
        databases.set(name, db);
      }
      
      return {
        result: db,
        addEventListener: vi.fn((event, handler) => {
          if (event === 'success') handler({ target: { result: db } });
        }),
      };
    }),
    
    deleteDatabase: vi.fn((name: string) => {
      databases.delete(name);
      return Promise.resolve();
    }),
    
    databases: vi.fn(() => {
      return Promise.resolve(
        Array.from(databases.keys()).map(name => ({ name, version: 1 }))
      );
    }),
  } as any;
  
  return databases;
}
```

**OPFS Mock Pattern**:

```typescript
// src/test/mocks/opfs.ts
import { vi } from 'vitest';

export class MockFileSystemFileHandle {
  private content: ArrayBuffer = new ArrayBuffer(0);
  
  constructor(public name: string) {}
  
  async createWritable() {
    return new MockFileSystemWritableFileStream(this);
  }
  
  async getFile() {
    return new File([this.content], this.name);
  }
  
  setContent(content: ArrayBuffer) {
    this.content = content;
  }
}

export class MockFileSystemWritableFileStream {
  constructor(private handle: MockFileSystemFileHandle) {}
  
  async write(data: ArrayBuffer | Blob) {
    if (data instanceof ArrayBuffer) {
      this.handle.setContent(data);
    } else {
      const buffer = await data.arrayBuffer();
      this.handle.setContent(buffer);
    }
  }
  
  async close() {
    // No-op
  }
}

export class MockFileSystemDirectoryHandle {
  private entries = new Map<string, MockFileSystemFileHandle | MockFileSystemDirectoryHandle>();
  
  constructor(public name: string) {}
  
  async getFileHandle(name: string, options?: { create?: boolean }) {
    let handle = this.entries.get(name) as MockFileSystemFileHandle;
    if (!handle && options?.create) {
      handle = new MockFileSystemFileHandle(name);
      this.entries.set(name, handle);
    }
    if (!handle) throw new Error(`File ${name} not found`);
    return handle;
  }
  
  async getDirectoryHandle(name: string, options?: { create?: boolean }) {
    let handle = this.entries.get(name) as MockFileSystemDirectoryHandle;
    if (!handle && options?.create) {
      handle = new MockFileSystemDirectoryHandle(name);
      this.entries.set(name, handle);
    }
    if (!handle) throw new Error(`Directory ${name} not found`);
    return handle;
  }
  
  async removeEntry(name: string, options?: { recursive?: boolean }) {
    this.entries.delete(name);
  }
  
  async *values() {
    for (const entry of this.entries.values()) {
      yield entry;
    }
  }
}

export function mockOPFS() {
  const root = new MockFileSystemDirectoryHandle('root');
  
  global.navigator.storage = {
    getDirectory: vi.fn(() => Promise.resolve(root)),
    estimate: vi.fn(() => Promise.resolve({ usage: 0, quota: 1000000000 })),
  } as any;
  
  return root;
}
```

---

## 4. Coverage Goals

### 4.1 Target Coverage by Component Type

| Component Type | Line Coverage | Branch Coverage | Function Coverage | Rationale |
|---------------|---------------|-----------------|-------------------|-----------|
| **Critical Path** | 100% | 100% | 100% | EDF parsing, storage layer, statistical algorithms |
| **Business Logic** | 90%+ | 85%+ | 90%+ | Analysis pipeline, plugin system, data transformations |
| **UI Components** | 80%+ | 75%+ | 80%+ | React components, state management |
| **Utilities** | 85%+ | 80%+ | 85%+ | Date formatting, validation, helpers |
| **Mocks/Test Code** | Exempt | Exempt | Exempt | Test infrastructure not counted |

### 4.2 Critical Paths Requiring 100% Coverage

1. **EDF Parser** (`src/lib/parsers/edf.ts`)
   - Header parsing
   - Signal conversion
   - Annotation parsing
   - File validation

2. **Storage Layer** (`src/lib/storage/`)
   - IndexedDB transactions
   - OPFS file operations
   - Schema migrations
   - Error handling

3. **Statistical Algorithms** (`src/lib/analysis/statistics.ts`)
   - Mean, median, percentiles
   - Standard deviation, variance
   - Correlation, regression
   - Edge cases (empty data, NaN, infinity)

4. **AHI Calculation** (`src/lib/analysis/ahi.ts`)
   - Event classification
   - Duration calculations
   - Clinical metric computation

5. **Session Boundary Detection** (`src/lib/parsers/session-detection.ts`)
   - Multi-night handling
   - Timestamp continuity
   - Session splitting

### 4.3 Coverage Reporting

**Pre-commit**: No coverage report (for speed).

**CI**: Full coverage report with:
- Text summary in console
- HTML report uploaded as artifact
- LCOV for integration with code quality tools
- JSON for programmatic access

**Thresholds**: CI fails if coverage drops below:
- Lines: 80%
- Functions: 80%
- Branches: 75%
- Statements: 80%

---

## 5. Test Types

### 5.1 Unit Tests

**Definition**: Tests that verify a single unit of functionality in isolation.

**Characteristics**:
- Fast (< 10ms per test)
- No external dependencies (all mocked)
- Deterministic results
- Focused on a single function, class, or component

**Example Subjects**:
- Pure functions (statistics, date formatting, validation)
- React components (rendering, props, events)
- Class methods (storage adapters, parsers, builders)

### 5.2 Integration Tests

**Definition**: Tests that verify interactions between multiple units.

**Characteristics**:
- Slower than unit tests (10ms - 500ms per test)
- May involve multiple modules
- Mock only external I/O (IndexedDB, OPFS, network)
- Test realistic workflows

**Example Subjects**:
- Import workflow: File selection → Parsing → Storage → UI update
- Analysis pipeline: Query → Computation → Cache → Display
- Plugin integration: Plugin registration → Discovery → Execution

**Location**: `__tests__/` directories within feature modules.

```typescript
// Example: src/lib/import/__tests__/import-workflow.integration.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { mockIndexedDB } from '@test/mocks/indexeddb';
import { mockOPFS } from '@test/mocks/opfs';
import { importSession } from '../import';
import { getSession } from '@/lib/storage/sessions';
import { createMockEDFFile } from '@test/fixtures/edf-files';

describe('Import Workflow Integration', () => {
  beforeEach(() => {
    mockIndexedDB();
    mockOPFS();
  });
  
  it('should import session from EDF files to storage', async () => {
    const files = [
      createMockEDFFile('BRP.edf'),
      createMockEDFFile('EVE.edf'),
    ];
    
    // Execute import
    const sessionId = await importSession(files);
    
    // Verify storage
    const session = await getSession(sessionId);
    expect(session).toBeDefined();
    expect(session.channels).toContainEqual(
      expect.objectContaining({ name: 'Flow' })
    );
    
    // Verify signals written to OPFS
    const signalFile = await getSignalFile(sessionId, 'Flow');
    expect(signalFile).toBeDefined();
  });
});
```

### 5.3 Contract Tests

**Definition**: Tests that verify plugin interfaces are correctly implemented.

**Characteristics**:
- Test interface conformance, not functionality
- Applicable to all plugins in a category
- Ensure plugins are interchangeable

**Example**:

```typescript
// src/plugins/machines/__tests__/machine-plugin.contract.test.ts
import { describe, it, expect } from 'vitest';
import { resmédPlugin } from '../resmed';
import { MachinePlugin } from '@/plugins/types';

function testMachinePluginContract(plugin: MachinePlugin, pluginName: string) {
  describe(`${pluginName} Contract`, () => {
    it('should have required metadata', () => {
      expect(plugin.metadata).toBeDefined();
      expect(plugin.metadata.id).toBeTruthy();
      expect(plugin.metadata.name).toBeTruthy();
      expect(plugin.metadata.version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(plugin.metadata.manufacturer).toBeTruthy();
    });
    
    it('should declare supported models', () => {
      expect(plugin.supportedModels).toBeInstanceOf(Array);
      expect(plugin.supportedModels.length).toBeGreaterThan(0);
    });
    
    it('should implement canParse method', () => {
      expect(plugin.canParse).toBeInstanceOf(Function);
    });
    
    it('should implement parseSession method', () => {
      expect(plugin.parseSession).toBeInstanceOf(Function);
    });
    
    it('should return valid session object from parseSession', async () => {
      const mockFile = createMockEDFFile('test.edf');
      const session = await plugin.parseSession([mockFile]);
      
      expect(session).toMatchObject({
        machineId: expect.any(String),
        machineModel: expect.any(String),
        date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        startTime: expect.any(String),
        endTime: expect.any(String),
        channels: expect.any(Array),
      });
    });
  });
}

describe('Machine Plugin Contracts', () => {
  testMachinePluginContract(resmédPlugin, 'ResMed Plugin');
  // Add more plugins as they're implemented
});
```

---

## 6. Testing Utilities

### 6.1 Test Fixtures

**Purpose**: Provide realistic, reusable test data.

**Location**: `src/test/fixtures/`

**Example**:

```typescript
// src/test/fixtures/sessions.ts
import { Session } from '@/lib/storage/types';

export const MOCK_SESSIONS: Record<string, Partial<Session>> = {
  normal: {
    id: 'session-1',
    machineId: 'RESMED-12345',
    machineModel: 'AirSense 10 AutoSet',
    date: '2026-02-10',
    startTime: '2026-02-10T22:30:00Z',
    endTime: '2026-02-11T06:00:00Z',
    durationMinutes: 450,
    usageMinutes: 450,
    channels: [
      {
        name: 'Flow',
        sampleRate: 25,
        unit: 'L/min',
        physicalMin: -200,
        physicalMax: 200,
        digitalMin: -32768,
        digitalMax: 32767,
      },
    ],
  },
  
  highAHI: {
    id: 'session-2',
    date: '2026-02-09',
    ahi: 35.5,
    eventCount: 178,
  },
  
  shortUsage: {
    id: 'session-3',
    date: '2026-02-08',
    durationMinutes: 180,
    usageMinutes: 180,
  },
};
```

### 6.2 Test Data Factories

**Purpose**: Generate test data programmatically with sensible defaults.

**Location**: `src/test/factories/`

**Example**:

```typescript
// src/test/factories/session.factory.ts
import { Session } from '@/lib/storage/types';
import { addDays, formatISO } from 'date-fns';

let sessionIdCounter = 0;

export function createMockSession(overrides?: Partial<Session>): Session {
  const id = `test-session-${sessionIdCounter++}`;
  const date = new Date('2026-02-10');
  
  return {
    id,
    machineId: 'RESMED-TEST-001',
    machineModel: 'AirSense 10 AutoSet',
    firmwareVersion: '3.0.2',
    date: formatISO(date, { representation: 'date' }),
    startTime: formatISO(date.setHours(22, 30, 0, 0)),
    endTime: formatISO(addDays(date, 1).setHours(6, 0, 0, 0)),
    durationMinutes: 450,
    usageMinutes: 450,
    importedAt: formatISO(new Date()),
    sourceHash: 'mock-hash-' + id,
    channels: [
      {
        name: 'Flow',
        sampleRate: 25,
        unit: 'L/min',
        physicalMin: -200,
        physicalMax: 200,
        digitalMin: -32768,
        digitalMax: 32767,
      },
      {
        name: 'MaskPressure',
        sampleRate: 25,
        unit: 'cmH2O',
        physicalMin: 0,
        physicalMax: 30,
        digitalMin: 0,
        digitalMax: 32767,
      },
    ],
    signalChunkIds: [`chunk-${id}-0`],
    hasOximetry: false,
    deleted: false,
    ...overrides,
  };
}

export function createMockSessions(count: number, overrides?: Partial<Session>): Session[] {
  return Array.from({ length: count }, (_, i) => createMockSession({
    ...overrides,
    date: formatISO(addDays(new Date('2026-02-10'), -i), { representation: 'date' }),
  }));
}
```

### 6.3 Custom Matchers

**Purpose**: Domain-specific assertions for clearer test intent.

**Location**: Defined in `src/test/setup.ts`

**Examples**:

```typescript
// Already shown in setup.ts
expect.extend({
  toBeWithinRange(received: number, floor: number, ceiling: number) { ... },
  toBeCloseToDuration(received: number, expected: number, toleranceMs: number) { ... },
});

// Additional custom matchers
expect.extend({
  toBeValidSession(received: any) {
    const pass = 
      typeof received === 'object' &&
      typeof received.id === 'string' &&
      typeof received.date === 'string' &&
      /^\d{4}-\d{2}-\d{2}$/.test(received.date) &&
      Array.isArray(received.channels);
    
    return {
      pass,
      message: () => pass
        ? `expected ${JSON.stringify(received)} not to be a valid session`
        : `expected ${JSON.stringify(received)} to be a valid session`,
    };
  },
  
  toBeValidAHI(received: number) {
    const pass = typeof received === 'number' && received >= 0 && received <= 300;
    return {
      pass,
      message: () => pass
        ? `expected ${received} not to be a valid AHI (must be 0-300)`
        : `expected ${received} to be a valid AHI (must be 0-300)`,
    };
  },
  
  toHaveApproximately(received: any[], expectedLength: number, tolerance: number = 0) {
    const pass = Math.abs(received.length - expectedLength) <= tolerance;
    return {
      pass,
      message: () => pass
        ? `expected array length ${received.length} not to be approximately ${expectedLength}`
        : `expected array length ${received.length} to be approximately ${expectedLength} (±${tolerance})`,
    };
  },
});
```

### 6.4 Test Helpers

**Purpose**: Common test utilities for async operations, DOM manipulation, etc.

**Location**: `src/test/helpers/`

**Example**:

```typescript
// src/test/helpers/async.ts
export function waitFor(callback: () => boolean, timeout: number = 1000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const interval = setInterval(() => {
      if (callback()) {
        clearInterval(interval);
        resolve();
      } else if (Date.now() - start > timeout) {
        clearInterval(interval);
        reject(new Error('waitFor timeout'));
      }
    }, 10);
  });
}

export async function flushPromises() {
  return new Promise(resolve => setImmediate(resolve));
}

export function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: any) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
```

```typescript
// src/test/helpers/render.tsx
import { render as rtlRender, RenderOptions } from '@testing-library/react';
import { ReactElement } from 'react';
import { BrowserRouter } from 'react-router-dom';

export function render(
  ui: ReactElement,
  { route = '/', ...options }: RenderOptions & { route?: string } = {}
) {
  window.history.pushState({}, 'Test page', route);
  
  return rtlRender(ui, {
    wrapper: ({ children }) => <BrowserRouter>{children}</BrowserRouter>,
    ...options,
  });
}
```

---

## 7. Performance Testing in Unit Tests

### 7.1 Benchmark Tests

**Purpose**: Ensure critical algorithms meet performance targets.

**Pattern**: Use Vitest's `bench` API (optional, not run in pre-commit).

```typescript
// src/lib/analysis/statistics.bench.ts
import { bench, describe } from 'vitest';
import { calculateMean, calculateMedian, calculatePercentile } from './statistics';

describe('statistics performance', () => {
  const data1k = Array.from({ length: 1000 }, () => Math.random() * 100);
  const data10k = Array.from({ length: 10000 }, () => Math.random() * 100);
  const data100k = Array.from({ length: 100000 }, () => Math.random() * 100);
  
  bench('calculateMean with 1k elements', () => {
    calculateMean(data1k);
  });
  
  bench('calculateMean with 10k elements', () => {
    calculateMean(data10k);
  });
  
  bench('calculateMean with 100k elements', () => {
    calculateMean(data100k);
  });
  
  bench('calculateMedian with 1k elements', () => {
    calculateMedian(data1k);
  });
  
  bench('calculatePercentile (95th) with 10k elements', () => {
    calculatePercentile(data10k, 95);
  });
});
```

**Running Benchmarks**:
```bash
npx vitest bench        # Run all benchmarks
npx vitest bench --run  # Single run (no watch)
```

### 7.2 Memory Leak Detection

**Pattern**: Monitor heap usage before and after operations.

```typescript
// src/lib/storage/__tests__/memory-leak.test.ts
import { describe, it, expect } from 'vitest';
import { importLargeSessions } from '../import';

describe('memory leak detection', () => {
  it('should not leak memory during large imports', async () => {
    // Force GC if available (requires --expose-gc flag)
    if (global.gc) global.gc();
    
    const before = process.memoryUsage().heapUsed;
    
    // Perform memory-intensive operation
    for (let i = 0; i < 10; i++) {
      await importLargeSessions();
    }
    
    // Force GC again
    if (global.gc) global.gc();
    
    const after = process.memoryUsage().heapUsed;
    const growth = after - before;
    
    // Allow some growth but not unbounded
    expect(growth).toBeLessThan(50 * 1024 * 1024); // 50 MB max growth
  });
});
```

### 7.3 Large Dataset Testing

**Pattern**: Test with realistic data volumes but faster methods.

```typescript
// src/lib/analysis/rolling-average.test.ts
import { describe, it, expect } from 'vitest';
import { computeRollingAverage } from './rolling-average';
import { createMockNightlyAggregates } from '@test/factories/aggregate.factory';

describe('rolling average with large datasets', () => {
  it('should compute 30-day rolling average for 5 years of data', () => {
    const data = createMockNightlyAggregates(365 * 5); // 1,825 nights
    
    const start = performance.now();
    const result = computeRollingAverage(data, 30);
    const duration = performance.now() - start;
    
    expect(result).toHaveLength(data.length);
    expect(duration).toBeLessThan(200); // Must complete in < 200ms
  });
  
  it('should handle gaps in data', () => {
    const data = createMockNightlyAggregates(100);
    // Remove every 10th element to simulate gaps
    const dataWithGaps = data.filter((_, i) => i % 10 !== 0);
    
    const result = computeRollingAverage(dataWithGaps, 7);
    
    expect(result).toHaveLength(dataWithGaps.length);
    // Verify no NaN results
    expect(result.every(r => !isNaN(r.value))).toBe(true);
  });
});
```

---

## 8. Pre-commit Integration

### 8.1 Pre-commit Test Execution

**Hook**: `.husky/pre-commit` (shown earlier)

**Test Command**:
```bash
npx vitest run --reporter=dot
```

**Requirements**:
- Must complete in < 10 seconds (ideally < 5 seconds)
- All tests must pass
- No coverage report (for speed)
- Silent mode (minimal output)

### 8.2 Fast Test Subset Strategy

For extremely large test suites (not current issue but future-proofing):

**Option 1**: Run only affected tests (requires git integration)
```bash
npx vitest related --reporter=dot
```

**Option 2**: Run critical path tests only
```bash
npx vitest run --reporter=dot src/lib/parsers/ src/lib/storage/ src/lib/analysis/ahi.test.ts
```

**Full Test Suite**: Reserved for CI

### 8.3 CI Test Execution

**GitHub Actions Workflow**: `.github/workflows/test.yml`

```yaml
name: Test

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    
    steps:
      - uses: actions/checkout@v3
      
      - uses: actions/setup-node@v3
        with:
          node-version: '20'
          cache: 'npm'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Run tests with coverage
        run: npx vitest run --coverage
      
      - name: Upload coverage to Codecov
        uses: codecov/codecov-action@v3
        with:
          files: ./coverage/lcov.info
          fail_ci_if_error: true
      
      - name: Upload coverage artifacts
        uses: actions/upload-artifact@v3
        with:
          name: coverage-report
          path: coverage/
```

**Coverage Enforcement**: CI fails if coverage thresholds not met.

---

## 9. Continuous Improvement

### 9.1 Test Quality Metrics

Monitor and track:

| Metric | Target | How to Measure |
|--------|--------|----------------|
| **Test execution time** | < 5s (pre-commit), < 30s (CI) | `vitest run` output |
| **Test flakiness** | 0% | Track intermittent failures |
| **Coverage** | 80%+ lines | Coverage report |
| **Test-to-code ratio** | 1:1 to 2:1 | LOC comparison |
| **Mutation test score** | 70%+ | Stryker (optional) |

### 9.2 Flaky Test Prevention

**Strategies**:
1. **Avoid timing dependencies**: No `setTimeout` in tests unless testing timing.
2. **Mock random values**: Use deterministic seeds or mocks for `Math.random()`, `crypto.randomUUID()`.
3. **Mock time**: Use `vi.useFakeTimers()` for date/time-dependent tests.
4. **Proper cleanup**: Always clean up in `afterEach`.
5. **No test interdependence**: Each test should work in isolation and any order.

**Example: Deterministic timing**:
```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('scheduled task', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  
  afterEach(() => {
    vi.useRealTimers();
  });
  
  it('should execute task after delay', () => {
    const task = vi.fn();
    scheduleTask(task, 1000);
    
    expect(task).not.toHaveBeenCalled();
    
    vi.advanceTimersByTime(1000);
    
    expect(task).toHaveBeenCalledOnce();
  });
});
```

### 9.3 Test Maintenance Strategies

**When to Refactor Tests**:
1. Test becomes hard to understand (too many mocks, complex setup)
2. Test is brittle (breaks with unrelated changes)
3. Test is slow (> 100ms for unit test)
4. Duplicate test logic across multiple files

**Refactoring Techniques**:
1. Extract common setup into factories or helpers
2. Use parameterized tests for similar test cases
3. Replace complex mocks with simpler test doubles
4. Split large test files into focused suites

**Example: Parameterized Tests**:
```typescript
describe.each([
  { input: [1, 2, 3], expected: 2 },
  { input: [10, 20, 30], expected: 20 },
  { input: [-5, 0, 5], expected: 0 },
])('calculateMedian($input)', ({ input, expected }) => {
  it(`should return ${expected}`, () => {
    expect(calculateMedian(input)).toBe(expected);
  });
});
```

### 9.4 Test Documentation

**When to Document Tests**:
- Complex test setup that's not immediately obvious
- Testing subtle edge cases or bug fixes
- Numerical precision or tolerance decisions
- Business logic validation requiring domain knowledge

**Documentation Style**: Use comments above test blocks.

```typescript
describe('AHI calculation', () => {
  // Per AASM guidelines, AHI includes apneas + hypopneas, but not RERAs.
  // RERAs are reported separately as RDI (Respiratory Disturbance Index).
  it('should exclude RERAs from AHI calculation', () => {
    const events = [
      { type: 'ObstructiveApnea', duration: 15 },
      { type: 'Hypopnea', duration: 12 },
      { type: 'RERA', duration: 8 },
    ];
    const usageHours = 8;
    
    const ahi = calculateAHI(events, usageHours);
    
    // Should count 2 events (apnea + hypopnea), not 3
    expect(ahi).toBe(2 / 8); // 0.25 events per hour
  });
  
  // Edge case: If usage is less than 2 hours, AHI may not be clinically
  // meaningful but should still compute mathematically correct result.
  it('should compute AHI for short usage sessions', () => {
    const events = [{ type: 'ObstructiveApnea', duration: 15 }];
    const usageHours = 0.5; // 30 minutes
    
    const ahi = calculateAHI(events, usageHours);
    
    expect(ahi).toBe(2); // 1 event / 0.5 hours = 2 per hour
  });
});
```

---

## 10. Appendix

### 10.1 Recommended Testing Libraries

| Library | Purpose | Install |
|---------|---------|---------|
| `vitest` | Test framework | `npm i -D vitest` |
| `@testing-library/react` | React component testing | `npm i -D @testing-library/react` |
| `@testing-library/jest-dom` | DOM matchers | `npm i -D @testing-library/jest-dom` |
| `@testing-library/user-event` | User interaction simulation | `npm i -D @testing-library/user-event` |
| `@vitest/coverage-v8` | Coverage provider | `npm i -D @vitest/coverage-v8` |
| `jsdom` | DOM environment | `npm i -D jsdom` |

### 10.2 TypeScript Test Types

**File**: `src/test/types.d.ts`

```typescript
import 'vitest';

interface CustomMatchers<R = unknown> {
  toBeWithinRange(floor: number, ceiling: number): R;
  toBeCloseToDuration(expected: number, toleranceMs?: number): R;
  toBeValidSession(): R;
  toBeValidAHI(): R;
  toHaveApproximately(expectedLength: number, tolerance?: number): R;
}

declare module 'vitest' {
  interface Assertion<T = any> extends CustomMatchers<T> {}
  interface AsymmetricMatchersContaining extends CustomMatchers {}
}
```

### 10.3 Common Testing Anti-Patterns to Avoid

| Anti-Pattern | Why It's Bad | Better Approach |
|-------------|--------------|-----------------|
| **Testing implementation details** | Tests break on refactoring | Test behavior/contracts |
| **Shared mutable state** | Tests affect each other | Isolate with beforeEach |
| **Testing the framework** | Wastes time, low value | Test your code, not React |
| **Excessive mocking** | Tests become meaningless | Mock only I/O boundaries |
| **Brittle selectors** | Breaks on DOM changes | Use `getByRole`, `getByLabelText` |
| **Large test files** | Hard to navigate | Split by feature/component |
| **Copy-paste tests** | Hard to maintain | Extract to parameterized tests |
| **Magic numbers** | Hard to understand | Use named constants |

### 10.4 Quick Reference Commands

```bash
# Run all tests
npx vitest run

# Watch mode
npx vitest

# Single file
npx vitest run path/to/file.test.ts

# Pattern matching
npx vitest run -t "should calculate mean"

# Coverage
npx vitest run --coverage

# UI mode (interactive)
npx vitest --ui

# Benchmarks
npx vitest bench

# Type checking only
npx vitest typecheck

# Update snapshots
npx vitest run -u
```

---

## Conclusion

This testing strategy prioritizes **speed**, **reliability**, and **maintainability** for a client-side application handling large-scale medical time-series data. By focusing on behavioral contracts rather than implementation, using fast parallel execution, and mocking all external dependencies, we ensure tests remain fast enough for pre-commit hooks while providing high confidence in code correctness.

**Key Takeaways**:
1. Tests must be fast (< 5s full suite) for tight feedback loops
2. Mock all I/O (IndexedDB, OPFS, Workers) for determinism
3. Test behavior, not implementation details
4. Aim for 80%+ coverage with 100% on critical paths
5. Use factories and fixtures for realistic test data
6. Document complex tests and edge cases
7. Monitor test performance and address flakiness immediately

This foundation will scale as the application grows while maintaining developer velocity.
