/**
 * Tests for Profile.csv IANA-timezone parsing.
 *
 * @module services/import/googlehealth/__tests__/profile.test
 */

import { describe, it, expect } from 'vitest';
import {
  parseProfileTimeZone,
  isPlausibleIanaTimeZone,
  profileTimeZoneSettingKey,
  findProfileCsvFile,
  PROFILE_TIMEZONE_SETTING_PREFIX,
} from '../profile';

// ---------------------------------------------------------------------------
// Minimal in-memory FileSystemDirectoryHandle mocks for findProfileCsvFile.
// ---------------------------------------------------------------------------

type Entry = FileHandleMock | DirHandleMock;

class FileHandleMock {
  readonly kind = 'file' as const;
  constructor(
    readonly name: string,
    private readonly content = 'x',
    private readonly unreadable = false,
  ) {}
  async getFile(): Promise<File> {
    if (this.unreadable) throw new Error('unreadable');
    const file = new File([this.content], this.name, { type: 'text/csv' });
    // jsdom's File lacks .text(); polyfill it (mirrors the makeFile test helper).
    (file as { text: () => Promise<string> }).text = () => Promise.resolve(this.content);
    return file;
  }
}

class DirHandleMock {
  readonly kind = 'directory' as const;
  constructor(
    readonly name: string,
    private readonly entries: Entry[] = [],
    private readonly unreadable = false,
  ) {}
  async *values(): AsyncGenerator<Entry> {
    if (this.unreadable) throw new Error('unreadable directory');
    for (const e of this.entries) yield e;
  }
}

/** Cast the mock to the DOM handle type findProfileCsvFile expects. */
const asRoot = (d: DirHandleMock): FileSystemDirectoryHandle =>
  d as unknown as FileSystemDirectoryHandle;

describe('isPlausibleIanaTimeZone', () => {
  it('accepts resolvable IANA zone ids', () => {
    expect(isPlausibleIanaTimeZone('America/Los_Angeles')).toBe(true);
    expect(isPlausibleIanaTimeZone('Europe/Berlin')).toBe(true);
    expect(isPlausibleIanaTimeZone('UTC')).toBe(true);
    expect(isPlausibleIanaTimeZone('  Asia/Kolkata  ')).toBe(true);
  });

  it('rejects empty and unresolvable zones', () => {
    expect(isPlausibleIanaTimeZone('')).toBe(false);
    expect(isPlausibleIanaTimeZone('   ')).toBe(false);
    expect(isPlausibleIanaTimeZone('Not/AZone')).toBe(false);
    expect(isPlausibleIanaTimeZone('America/Nowhere')).toBe(false);
  });
});

describe('parseProfileTimeZone', () => {
  it('extracts the timezone column from a real 2-row Profile.csv', () => {
    const csv = 'full_name,timezone,country\r\n' + 'Jane Doe,America/Los_Angeles,United States\r\n';
    expect(parseProfileTimeZone(csv)).toBe('America/Los_Angeles');
  });

  it('is case-insensitive on the column name and trims the value', () => {
    const csv = 'Full_Name,TimeZone\n' + 'Jane, Europe/Berlin \n';
    expect(parseProfileTimeZone(csv)).toBe('Europe/Berlin');
  });

  it('returns null when the timezone column is absent', () => {
    const csv = 'full_name,country\nJane,United States\n';
    expect(parseProfileTimeZone(csv)).toBeNull();
  });

  it('returns null when the timezone value is empty', () => {
    const csv = 'full_name,timezone\nJane,\n';
    expect(parseProfileTimeZone(csv)).toBeNull();
  });

  it('returns null when the timezone value is not a resolvable IANA id', () => {
    const csv = 'full_name,timezone\nJane,Not/AZone\n';
    expect(parseProfileTimeZone(csv)).toBeNull();
  });

  it('returns null when there is no value row', () => {
    expect(parseProfileTimeZone('full_name,timezone\n')).toBeNull();
  });
});

describe('findProfileCsvFile', () => {
  it('finds a root-level Profile.csv (case-insensitive)', async () => {
    const root = new DirHandleMock('root', [
      new FileHandleMock('heart_rate-2026-05-30.json'),
      new FileHandleMock('PROFILE.CSV', 'full_name,timezone\nJane,UTC\n'),
    ]);
    const file = await findProfileCsvFile(asRoot(root));
    expect(file).not.toBeNull();
    expect(await file!.text()).toContain('timezone');
  });

  it('excludes "Sleep Profile.csv"', async () => {
    const root = new DirHandleMock('root', [
      new FileHandleMock('Sleep Profile.csv'),
      new FileHandleMock('Minute SpO2 - 2026-05-30.csv'),
    ]);
    expect(await findProfileCsvFile(asRoot(root))).toBeNull();
  });

  it('finds a nested Profile.csv (e.g. under a Fitbit/ folder)', async () => {
    const root = new DirHandleMock('Takeout', [
      new DirHandleMock('Fitbit', [
        new DirHandleMock('Global Export Data', [new FileHandleMock('steps-2026.json')]),
        new FileHandleMock('Profile.csv', 'timezone\nEurope/Berlin\n'),
      ]),
    ]);
    const file = await findProfileCsvFile(asRoot(root));
    expect(file).not.toBeNull();
    expect(await file!.text()).toContain('Europe/Berlin');
  });

  it('prefers a root-level file over a nested one (breadth-first)', async () => {
    const root = new DirHandleMock('root', [
      new DirHandleMock('sub', [new FileHandleMock('Profile.csv', 'nested')]),
      new FileHandleMock('Profile.csv', 'root-level'),
    ]);
    const file = await findProfileCsvFile(asRoot(root));
    expect(await file!.text()).toBe('root-level');
  });

  it('skips an unreadable directory and keeps scanning siblings', async () => {
    const root = new DirHandleMock('root', [
      new DirHandleMock('locked', [], true),
      new DirHandleMock('ok', [new FileHandleMock('Profile.csv', 'found')]),
    ]);
    const file = await findProfileCsvFile(asRoot(root));
    expect(await file!.text()).toBe('found');
  });

  it('returns null when no Profile.csv exists', async () => {
    const root = new DirHandleMock('root', [new FileHandleMock('other.csv')]);
    expect(await findProfileCsvFile(asRoot(root))).toBeNull();
  });

  it('does not descend past maxDepth', async () => {
    const deep = new DirHandleMock('d3', [new FileHandleMock('Profile.csv', 'tooDeep')]);
    const root = new DirHandleMock('root', [
      new DirHandleMock('d1', [new DirHandleMock('d2', [deep])]),
    ]);
    // Profile.csv sits at depth 3; with maxDepth 2 it must not be found.
    expect(await findProfileCsvFile(asRoot(root), 2)).toBeNull();
    // …and IS found when the bound allows depth 3.
    expect(await findProfileCsvFile(asRoot(root), 3)).not.toBeNull();
  });
});

describe('profileTimeZoneSettingKey', () => {
  it('namespaces the key per source under the shared prefix', () => {
    expect(profileTimeZoneSettingKey('fitbit')).toBe(`${PROFILE_TIMEZONE_SETTING_PREFIX}fitbit`);
    expect(profileTimeZoneSettingKey('fitbit')).toBe('integration.profileTimeZone.fitbit');
  });
});
