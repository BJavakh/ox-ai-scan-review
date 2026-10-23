import { describe, expect, it } from 'vitest';
import { cvss3BaseScore, roundUp } from '../../src/domain/cvss.js';

describe('cvss3BaseScore', () => {
  it.each([
    ['CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H', 9.8],
    ['CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:H', 10],
    ['CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:U/C:N/I:N/A:H', 5.9],
    ['CVSS:3.1/AV:L/AC:L/PR:L/UI:N/S:U/C:H/I:H/A:H', 7.8],
    ['CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:C/C:L/I:L/A:N', 6.1],
    ['CVSS:3.1/AV:N/AC:L/PR:H/UI:N/S:U/C:H/I:H/A:H', 7.2],
    ['CVSS:3.0/AV:N/AC:L/PR:L/UI:N/S:C/C:H/I:N/A:N', 7.7],
    ['CVSS:3.1/AV:P/AC:H/PR:H/UI:R/S:U/C:L/I:N/A:N', 1.6],
    ['CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:N', 0],
    ['CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H/E:P/RL:O', 9.8],
  ])('%s = %d', (vector, expected) => {
    expect(cvss3BaseScore(vector)).toBe(expected);
  });

  it.each([
    '',
    'not a vector',
    'CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N',
    'CVSS:2.0/AV:N/AC:L/Au:N/C:P/I:P/A:P',
    'CVSS:3.1/AV:X/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H',
    'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H',
  ])('returns null for %s', (vector) => {
    expect(cvss3BaseScore(vector)).toBeNull();
  });

  it('rounds up to one decimal without float drift', () => {
    expect(roundUp(4.0)).toBe(4);
    expect(roundUp(4.02)).toBe(4.1);
    expect(roundUp(4.00001)).toBe(4.1);
    // Per the spec, noise below 1e-5 is absorbed rather than rounded up.
    expect(roundUp(4.000001)).toBe(4);
  });
});
