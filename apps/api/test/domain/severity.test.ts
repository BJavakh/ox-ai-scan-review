import { describe, expect, it } from 'vitest';
import { deriveSeverity, severityFromCvss } from '../../src/domain/severity.js';
import { advisory } from '../helpers/builders.js';

const CRITICAL_VECTOR = 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H';

describe('deriveSeverity', () => {
  it('treats malicious packages as critical regardless of other data', () => {
    expect(deriveSeverity(advisory({ id: 'MAL-2025-1234', databaseSeverity: 'LOW' }))).toEqual({
      severity: 'CRITICAL',
      source: 'malicious',
      cvssScore: null,
    });
  });

  it('prefers the GHSA database severity over CVSS', () => {
    const result = deriveSeverity(
      advisory({
        id: 'GHSA-aaaa-bbbb-cccc',
        databaseSeverity: 'MODERATE',
        severityVectors: [{ type: 'CVSS_V3', score: CRITICAL_VECTOR }],
      }),
    );
    expect(result).toEqual({ severity: 'MODERATE', source: 'ghsa', cvssScore: 9.8 });
  });

  it('maps MEDIUM to MODERATE and ignores case', () => {
    expect(deriveSeverity(advisory({ id: 'X', databaseSeverity: 'medium' })).severity).toBe(
      'MODERATE',
    );
  });

  it('falls back to a computed CVSS v3 score', () => {
    expect(
      deriveSeverity(
        advisory({ id: 'X', severityVectors: [{ type: 'CVSS_V3', score: CRITICAL_VECTOR }] }),
      ),
    ).toEqual({ severity: 'CRITICAL', source: 'cvss_v3', cvssScore: 9.8 });
  });

  it('returns UNKNOWN for CVSS v4 only, unknown labels, or missing data', () => {
    const v4 = 'CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N';
    expect(
      deriveSeverity(advisory({ id: 'X', severityVectors: [{ type: 'CVSS_V4', score: v4 }] })),
    ).toEqual({ severity: 'UNKNOWN', source: 'unknown', cvssScore: null });
    expect(deriveSeverity(advisory({ id: 'X', databaseSeverity: 'SEVERE' })).severity).toBe(
      'UNKNOWN',
    );
    expect(deriveSeverity(advisory({ id: 'X', hydrated: false })).severity).toBe('UNKNOWN');
  });

  it('maps CVSS scores to bands', () => {
    expect(severityFromCvss(9)).toBe('CRITICAL');
    expect(severityFromCvss(8.9)).toBe('HIGH');
    expect(severityFromCvss(7)).toBe('HIGH');
    expect(severityFromCvss(4)).toBe('MODERATE');
    expect(severityFromCvss(0.1)).toBe('LOW');
    expect(severityFromCvss(0)).toBe('UNKNOWN');
  });
});
