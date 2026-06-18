/**
 * Unit tests for the Google Health (Fitbit) directory scanner.
 *
 * The scanner walks a user-selected `FileSystemDirectoryHandle` to discover
 * which data types are present, without reading file contents. These tests use
 * lightweight in-memory mocks of the File System Access API surface the scanner
 * actually touches — `values()` (async iterator), `getDirectoryHandle(name)`,
 * and `FileSystemFileHandle.getFile()` returning an object with a `size`.
 *
 * The primary case here is a regression guard: `sleep-*.json` files must yield
 * BOTH the `sleep_session` and `sleep_stages` data types, because the scanner
 * is the sole producer of the discovered-data-type list. If `sleep_stages` is
 * not registered as a source, Fitbit sleep-stage hypnograms are silently
 * skipped during import and the Sleep Stages lane never renders.
 *
 * @module services/import/googlehealth/__tests__/scanner.test
 */

import { describe, it, expect } from 'vitest';
import { scanGoogleHealthExport } from '../scanner';
import type { GoogleHealthDataTypeInfo } from '@/types/fitbit';

// ---------------------------------------------------------------------------
// Minimal File System Access API mocks
// ---------------------------------------------------------------------------

/**
 * A directory tree expressed as plain data. Keys are entry names; values are
 * either a nested {@link MockTree} (a subdirectory) or a number (a file with
 * that byte size).
 */
interface MockTree {
  readonly [name: string]: MockTree | number;
}

/** Mock of the subset of `FileSystemFileHandle` the scanner calls. */
interface MockFileHandle {
  readonly kind: 'file';
  readonly name: string;
  getFile(): Promise<{ size: number }>;
}

/** Mock of the subset of `FileSystemDirectoryHandle` the scanner calls. */
interface MockDirectoryHandle {
  readonly kind: 'directory';
  readonly name: string;
  values(): AsyncIterableIterator<MockFileHandle | MockDirectoryHandle>;
  getDirectoryHandle(name: string): Promise<MockDirectoryHandle>;
  getFileHandle(name: string): Promise<MockFileHandle>;
}

function isTree(value: MockTree | number): value is MockTree {
  return typeof value === 'object';
}

/** Build a mock directory handle from a plain {@link MockTree} description. */
function makeDirHandle(name: string, tree: MockTree): MockDirectoryHandle {
  const childHandles = new Map<string, MockFileHandle | MockDirectoryHandle>();

  for (const [childName, value] of Object.entries(tree)) {
    if (isTree(value)) {
      childHandles.set(childName, makeDirHandle(childName, value));
    } else {
      const size = value;
      childHandles.set(childName, {
        kind: 'file',
        name: childName,
        getFile: () => Promise.resolve({ size }),
      });
    }
  }

  return {
    kind: 'directory',
    name,
    async *values() {
      for (const handle of childHandles.values()) {
        yield handle;
      }
    },
    getDirectoryHandle(childName: string): Promise<MockDirectoryHandle> {
      const handle = childHandles.get(childName);
      if (handle && handle.kind === 'directory') {
        return Promise.resolve(handle);
      }
      return Promise.reject(new Error(`NotFoundError: ${childName}`));
    },
    getFileHandle(childName: string): Promise<MockFileHandle> {
      const handle = childHandles.get(childName);
      if (handle && handle.kind === 'file') {
        return Promise.resolve(handle);
      }
      return Promise.reject(new Error(`NotFoundError: ${childName}`));
    },
  };
}

/**
 * The scanner is typed against the real `FileSystemDirectoryHandle`, which has
 * a far larger surface than the scanner exercises. The mock implements exactly
 * the methods the scanner calls; this cast asserts structural compatibility for
 * the purposes of the test without pulling in `any`.
 */
function asDirHandle(handle: MockDirectoryHandle): FileSystemDirectoryHandle {
  return handle as unknown as FileSystemDirectoryHandle;
}

function findType(
  dataTypes: readonly GoogleHealthDataTypeInfo[],
  dataType: string,
): GoogleHealthDataTypeInfo | undefined {
  return dataTypes.find((dt) => dt.dataType === dataType);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('scanGoogleHealthExport', () => {
  it('discovers BOTH sleep_session and sleep_stages from a Global Export Data sleep-*.json (regression guard)', async () => {
    // Verified against a real Google Takeout / Fitbit export: sleep logs are
    // dated `sleep-YYYY-MM-DD.json` files under `Global Export Data/` (the same
    // directory as intraday heart rate), NOT under `Sleep/`. Each file carries
    // both the night's session summary and the stage hypnogram.
    const root = makeDirHandle('Google Health', {
      'Global Export Data': {
        'sleep-2026-05-12.json': 2048,
      },
      'Sleep Score': {
        'sleep_score.csv': 512,
      },
    });

    const result = await scanGoogleHealthExport(asDirHandle(root));

    const session = findType(result.dataTypes, 'sleep_session');
    const stages = findType(result.dataTypes, 'sleep_stages');

    // Both must be discovered. Before the fix, sleep was looked for only in
    // `Sleep/` (which holds no session JSONs), so neither was offered.
    expect(session).toBeDefined();
    expect(stages).toBeDefined();

    // Both resolve to the same source file under Global Export Data.
    expect(session!.files).toContain('Global Export Data/sleep-2026-05-12.json');
    expect(stages!.files).toContain('Global Export Data/sleep-2026-05-12.json');

    // Each is a tier-1 (core sleep) type with one matching file.
    expect(session!.tier).toBe(1);
    expect(stages!.tier).toBe(1);
    expect(session!.recordCount).toBe(1);
    expect(stages!.recordCount).toBe(1);

    // Date range is estimated from the dashed filename for both.
    expect(stages!.dateRange).toEqual({ start: '2026-05-12', end: '2026-05-12' });
  });

  it('does NOT mistake the Sleep/ directory (Sleep Profile only) for sleep logs', async () => {
    // The original bug: the scanner looked for `sleep-*.json` under `Sleep/`,
    // but real exports put only `Sleep Profile.csv` there. A `Sleep/` directory
    // with no dated session JSON must yield no sleep_session / sleep_stages.
    const root = makeDirHandle('Google Health', {
      Sleep: {
        'Sleep Profile.csv': 512,
        'Sleep Profile README.txt': 128,
      },
      'Sleep Score': {
        'sleep_score.csv': 512,
      },
    });

    const result = await scanGoogleHealthExport(asDirHandle(root));

    expect(findType(result.dataTypes, 'sleep_session')).toBeUndefined();
    expect(findType(result.dataTypes, 'sleep_stages')).toBeUndefined();
  });

  it('returns an empty result when the directory is not a Google Health root', async () => {
    // Only one known subdir — below the MIN_KNOWN_SUBDIRS threshold of 2.
    const root = makeDirHandle('Not An Export', {
      'Sleep Score': {
        'sleep_score.csv': 512,
      },
    });

    const result = await scanGoogleHealthExport(asDirHandle(root));

    expect(result.dataTypes).toEqual([]);
    expect(result.totalFileCount).toBe(0);
  });

  it('counts each shared sleep source file once per data type in the total file count', async () => {
    // The sleep file matches two sources (session + stages); mirroring the
    // accepted snoring double-count, it contributes once per data type.
    const root = makeDirHandle('Google Health', {
      'Global Export Data': {
        'sleep-2026-05-12.json': 2048,
      },
      'Sleep Score': {
        'sleep_score.csv': 512,
      },
    });

    const result = await scanGoogleHealthExport(asDirHandle(root));

    // sleep_session (1) + sleep_stages (1) + sleep_score (1) = 3.
    expect(result.totalFileCount).toBe(3);
  });
});
