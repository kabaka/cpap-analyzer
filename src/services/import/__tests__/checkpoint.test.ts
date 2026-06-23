import { describe, it, expect } from 'vitest';
import { checkpoint, ImportAbortedError, isImportAbortedError } from '@/services/import/types';

describe('checkpoint / ImportAbortedError', () => {
  it('resolves (yields) when no signal is provided', async () => {
    await expect(checkpoint()).resolves.toBeUndefined();
  });

  it('resolves when the signal is not aborted', async () => {
    const controller = new AbortController();
    await expect(checkpoint(controller.signal)).resolves.toBeUndefined();
  });

  it('throws ImportAbortedError immediately when already aborted (before yielding)', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(checkpoint(controller.signal)).rejects.toBeInstanceOf(ImportAbortedError);
  });

  it('throws ImportAbortedError when aborted during the yield', async () => {
    const controller = new AbortController();
    // Abort on the next macrotask, while checkpoint is awaiting its yield.
    setTimeout(() => controller.abort(), 0);
    await expect(checkpoint(controller.signal)).rejects.toBeInstanceOf(ImportAbortedError);
  });

  it('isImportAbortedError recognises the error by instance and by name', () => {
    expect(isImportAbortedError(new ImportAbortedError())).toBe(true);
    // Cross-realm-style object with the right name but not an instance.
    expect(isImportAbortedError({ name: 'ImportAbortedError' })).toBe(true);
    expect(isImportAbortedError(new Error('other'))).toBe(false);
    expect(isImportAbortedError(null)).toBe(false);
  });
});
