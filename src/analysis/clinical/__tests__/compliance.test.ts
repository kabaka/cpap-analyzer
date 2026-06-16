import { describe, it, expect } from 'vitest';
import { CMS_COMPLIANCE_HOURS, RECOMMENDED_USAGE_HOURS } from '../compliance';

describe('compliance hour constants', () => {
  it('pins the CMS compliance threshold to 4 hours', () => {
    expect(CMS_COMPLIANCE_HOURS).toBe(4);
  });

  it('pins the recommended usage target to 6 hours', () => {
    expect(RECOMMENDED_USAGE_HOURS).toBe(6);
  });

  it('keeps the recommended target above the CMS minimum', () => {
    expect(RECOMMENDED_USAGE_HOURS).toBeGreaterThan(CMS_COMPLIANCE_HOURS);
  });
});
