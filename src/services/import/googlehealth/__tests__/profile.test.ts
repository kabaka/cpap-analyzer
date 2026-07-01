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
  PROFILE_TIMEZONE_SETTING_PREFIX,
} from '../profile';

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

describe('profileTimeZoneSettingKey', () => {
  it('namespaces the key per source under the shared prefix', () => {
    expect(profileTimeZoneSettingKey('fitbit')).toBe(`${PROFILE_TIMEZONE_SETTING_PREFIX}fitbit`);
    expect(profileTimeZoneSettingKey('fitbit')).toBe('integration.profileTimeZone.fitbit');
  });
});
