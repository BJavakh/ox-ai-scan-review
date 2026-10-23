import { describe, expect, it } from 'vitest';
import { findFixedVersion, maxVersion } from '../../src/domain/versions.js';
import { advisory, rangeAdvisory } from '../helpers/builders.js';

describe('findFixedVersion', () => {
  const lodash = rangeAdvisory('GHSA-p6mc-m468-83gw', 'lodash', '3.7.0', '4.17.19');

  it('returns the fixed event of the range containing the installed version', () => {
    expect(findFixedVersion(lodash, 'lodash', '4.17.15')).toBe('4.17.19');
    expect(findFixedVersion(lodash, 'lodash', '3.7.0')).toBe('4.17.19');
  });

  it('returns null outside the range or for another package', () => {
    expect(findFixedVersion(lodash, 'lodash', '4.17.19')).toBeNull();
    expect(findFixedVersion(lodash, 'lodash', '3.6.9')).toBeNull();
    expect(findFixedVersion(lodash, 'lodash-es', '4.17.15')).toBeNull();
  });

  it('picks the fix in the matching release line when there are several ranges', () => {
    const multi = advisory({
      id: 'X',
      affected: [
        {
          name: 'pkg',
          versions: [],
          ranges: [
            {
              type: 'SEMVER',
              // deliberately unsorted
              events: [
                { kind: 'fixed', version: '2.1.5' },
                { kind: 'introduced', version: '0' },
                { kind: 'introduced', version: '2.0.0' },
                { kind: 'fixed', version: '1.2.3' },
              ],
            },
          ],
        },
      ],
    });
    expect(findFixedVersion(multi, 'pkg', '1.0.0')).toBe('1.2.3');
    expect(findFixedVersion(multi, 'pkg', '2.0.1')).toBe('2.1.5');
    expect(findFixedVersion(multi, 'pkg', '1.5.0')).toBeNull();
  });

  it('returns null when the range ends with last_affected or is open-ended', () => {
    const lastAffected = advisory({
      id: 'X',
      affected: [
        {
          name: 'pkg',
          versions: [],
          ranges: [
            {
              type: 'SEMVER',
              events: [
                { kind: 'introduced', version: '0' },
                { kind: 'last_affected', version: '1.4.0' },
              ],
            },
          ],
        },
      ],
    });
    expect(findFixedVersion(lastAffected, 'pkg', '1.4.0')).toBeNull();
    expect(findFixedVersion(rangeAdvisory('Y', 'pkg', '0', null), 'pkg', '9.9.9')).toBeNull();
  });

  it('ignores GIT ranges and invalid versions', () => {
    const git = advisory({
      id: 'X',
      affected: [
        {
          name: 'pkg',
          versions: [],
          ranges: [
            {
              type: 'GIT',
              events: [
                { kind: 'introduced', version: '0' },
                { kind: 'fixed', version: 'abc123' },
              ],
            },
          ],
        },
      ],
    });
    expect(findFixedVersion(git, 'pkg', '1.0.0')).toBeNull();
    expect(findFixedVersion(lodash, 'lodash', 'not-a-version')).toBeNull();
  });
});

describe('maxVersion', () => {
  it('uses semver order, not string order', () => {
    expect(maxVersion(['4.17.9', '4.17.21', '4.17.19'])).toBe('4.17.21');
    expect(maxVersion(['1.0.0-beta.2', '1.0.0'])).toBe('1.0.0');
    expect(maxVersion([])).toBeNull();
  });
});
