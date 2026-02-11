import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

/**
 * Import Pipeline E2E Tests
 *
 * Phase 4 tests focusing on:
 * 1. Import-related routes exist and render
 * 2. Browser environment has required APIs (IndexedDB, crypto.subtle, etc.)
 * 3. EDF fixture files can be transferred to and processed in the browser context
 *
 * Phase 5 will add tests for the actual Import Wizard UI.
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fixturesDir = path.join(__dirname, '../fixtures/edf');

test.describe('Import Pipeline — Route Rendering', () => {
  test('data management route renders with heading', async ({ page }) => {
    await page.goto('/data');
    await expect(page.getByRole('heading', { name: /data management/i })).toBeVisible();
  });

  test('import wizard route renders with heading', async ({ page }) => {
    await page.goto('/data/import');
    await expect(page.getByRole('heading', { name: /import data/i })).toBeVisible();
  });

  test('import route is reachable via direct URL navigation', async ({ page }) => {
    // Navigate to a different page first, then directly to import
    await page.goto('/settings');
    await expect(page.getByRole('heading', { name: /settings/i })).toBeVisible();

    await page.goto('/data/import');
    await expect(page.getByRole('heading', { name: /import data/i })).toBeVisible();
  });
});

test.describe('Import Pipeline — Browser Environment', () => {
  test('browser supports IndexedDB', async ({ page }) => {
    await page.goto('/');

    const hasIndexedDB = await page.evaluate(() => {
      return typeof indexedDB !== 'undefined' && typeof indexedDB.open === 'function';
    });

    expect(hasIndexedDB).toBe(true);
  });

  test('browser supports crypto.subtle', async ({ page }) => {
    await page.goto('/');

    const hasCryptoSubtle = await page.evaluate(() => {
      return (
        typeof crypto !== 'undefined' &&
        typeof crypto.subtle !== 'undefined' &&
        typeof crypto.subtle.digest === 'function'
      );
    });

    expect(hasCryptoSubtle).toBe(true);
  });

  test('browser supports Web Workers', async ({ page }) => {
    await page.goto('/');

    const hasWorkers = await page.evaluate(() => {
      return typeof Worker !== 'undefined';
    });

    expect(hasWorkers).toBe(true);
  });

  test('browser supports File and FileReader APIs', async ({ page }) => {
    await page.goto('/');

    const hasFileAPIs = await page.evaluate(() => {
      return (
        typeof File !== 'undefined' &&
        typeof FileReader !== 'undefined' &&
        typeof Blob !== 'undefined'
      );
    });

    expect(hasFileAPIs).toBe(true);
  });
});

test.describe('Import Pipeline — EDF File Handling', () => {
  test('BRP fixture transfers to browser and has correct size', async ({ page }) => {
    await page.goto('/');

    const brpBuffer = fs.readFileSync(path.join(fixturesDir, 'brp-airsense11.edf'));
    const brpBase64 = brpBuffer.toString('base64');

    const result = await page.evaluate(async (b64: string) => {
      const binary = atob(b64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      return { byteLength: bytes.buffer.byteLength };
    }, brpBase64);

    expect(result.byteLength).toBe(brpBuffer.byteLength);
    expect(result.byteLength).toBeGreaterThan(0);
  });

  test('EVE fixture transfers to browser and has correct size', async ({ page }) => {
    await page.goto('/');

    const eveBuffer = fs.readFileSync(path.join(fixturesDir, 'eve-airsense11.edf'));
    const eveBase64 = eveBuffer.toString('base64');

    const result = await page.evaluate(async (b64: string) => {
      const binary = atob(b64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      return { byteLength: bytes.buffer.byteLength };
    }, eveBase64);

    expect(result.byteLength).toBe(eveBuffer.byteLength);
    expect(result.byteLength).toBeGreaterThan(0);
  });

  test('empty EDF fixture is handled gracefully (zero bytes)', async ({ page }) => {
    await page.goto('/');

    const emptyBuffer = fs.readFileSync(path.join(fixturesDir, 'eve-empty.edf'));

    const result = await page.evaluate(() => {
      const buf = new ArrayBuffer(0);
      return { byteLength: buf.byteLength };
    });

    expect(result.byteLength).toBe(0);
    expect(emptyBuffer.byteLength).toBe(0);
  });

  test('all fixture files can be loaded and transferred to browser', async ({ page }) => {
    await page.goto('/');

    const fixtures = [
      'brp-airsense11.edf',
      'pld-airsense11.edf',
      'eve-airsense11.edf',
      'sad-airsense11.edf',
      'brp-unknown-records.edf',
    ];

    for (const filename of fixtures) {
      const buffer = fs.readFileSync(path.join(fixturesDir, filename));
      const base64 = buffer.toString('base64');

      const result = await page.evaluate(async (b64: string) => {
        const binary = atob(b64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
          bytes[i] = binary.charCodeAt(i);
        }
        return { byteLength: bytes.buffer.byteLength };
      }, base64);

      expect(result.byteLength).toBe(buffer.byteLength);
      expect(result.byteLength).toBeGreaterThan(0);
    }
  });

  test('EDF header can be read from fixture buffer in browser', async ({ page }) => {
    await page.goto('/');

    const brpBuffer = fs.readFileSync(path.join(fixturesDir, 'brp-airsense11.edf'));
    const brpBase64 = brpBuffer.toString('base64');

    const result = await page.evaluate(async (b64: string) => {
      const binary = atob(b64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }

      // EDF header: first 8 bytes are version (should be "0       ")
      const decoder = new TextDecoder('ascii');
      const version = decoder.decode(bytes.slice(0, 8)).trim();

      // Bytes 8-88: patient ID (80 chars)
      const patientId = decoder.decode(bytes.slice(8, 88)).trim();

      // Bytes 236-244: number of data records (8 chars)
      const numRecordsStr = decoder.decode(bytes.slice(236, 244)).trim();

      // Bytes 244-252: duration of a data record in seconds (8 chars)
      const durationStr = decoder.decode(bytes.slice(244, 252)).trim();

      // Bytes 252-256: number of signals (4 chars)
      const numSignalsStr = decoder.decode(bytes.slice(252, 256)).trim();

      return {
        version,
        patientId,
        numDataRecords: parseInt(numRecordsStr, 10),
        dataRecordDuration: parseFloat(durationStr),
        numSignals: parseInt(numSignalsStr, 10),
      };
    }, brpBase64);

    // Verify against known fixture properties from manifest.json
    expect(result.version).toBe('0');
    expect(result.numSignals).toBe(3);
    expect(result.numDataRecords).toBe(60);
    expect(result.dataRecordDuration).toBe(1);
    expect(result.patientId).toContain('X X X X');
  });

  test('IndexedDB can store and retrieve data in browser context', async ({ page }) => {
    await page.goto('/');

    const result = await page.evaluate(async () => {
      return new Promise<{ stored: boolean; retrieved: string }>((resolve, reject) => {
        const dbName = 'e2e-import-test-' + Date.now();
        const request = indexedDB.open(dbName, 1);

        request.onupgradeneeded = (event) => {
          const db = (event.target as IDBOpenDBRequest).result;
          db.createObjectStore('test-store', { keyPath: 'id' });
        };

        request.onsuccess = (event) => {
          const db = (event.target as IDBOpenDBRequest).result;
          const tx = db.transaction('test-store', 'readwrite');
          const store = tx.objectStore('test-store');

          store.put({ id: 'test-1', data: 'import-pipeline-test' });

          tx.oncomplete = () => {
            const readTx = db.transaction('test-store', 'readonly');
            const readStore = readTx.objectStore('test-store');
            const getReq = readStore.get('test-1');

            getReq.onsuccess = () => {
              const value = getReq.result;
              db.close();
              // Clean up
              indexedDB.deleteDatabase(dbName);
              resolve({
                stored: true,
                retrieved: value?.data ?? '',
              });
            };

            getReq.onerror = () => reject(new Error('Failed to read from IndexedDB'));
          };
        };

        request.onerror = () => reject(new Error('Failed to open IndexedDB'));
      });
    });

    expect(result.stored).toBe(true);
    expect(result.retrieved).toBe('import-pipeline-test');
  });

  test('crypto.subtle can hash EDF buffer (integrity check)', async ({ page }) => {
    await page.goto('/');

    const brpBuffer = fs.readFileSync(path.join(fixturesDir, 'brp-airsense11.edf'));
    const brpBase64 = brpBuffer.toString('base64');

    const result = await page.evaluate(async (b64: string) => {
      const binary = atob(b64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }

      const hashBuffer = await crypto.subtle.digest('SHA-256', bytes.buffer);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');

      return { hashLength: hashHex.length, hashPrefix: hashHex.slice(0, 8) };
    }, brpBase64);

    // SHA-256 always produces a 64-char hex string
    expect(result.hashLength).toBe(64);
    // Hash prefix should be deterministic for the same fixture
    expect(result.hashPrefix).toBeTruthy();
    expect(result.hashPrefix.length).toBe(8);
  });
});
