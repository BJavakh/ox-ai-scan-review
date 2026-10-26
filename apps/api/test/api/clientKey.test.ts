import { describe, expect, it } from 'vitest';
import { clientKey } from '../../src/http/clientKey.js';

describe('clientKey', () => {
  it.each([
    ['203.0.113.7', '203.0.113.7'],
    ['::ffff:203.0.113.7', '203.0.113.7'],
    ['2001:db8:1:2:aaaa:bbbb:cccc:dddd', '2001:0db8:0001:0002::/64'],
    ['2001:db8:1:2::1', '2001:0db8:0001:0002::/64'],
    ['2001:DB8:1:2:ffff::9', '2001:0db8:0001:0002::/64'],
    ['::1', '0000:0000:0000:0000::/64'],
    ['fe80::1%en0', 'fe80:0000:0000:0000::/64'],
  ])('%s -> %s', (ip, key) => {
    expect(clientKey(ip)).toBe(key);
  });

  it('gives every address in one /64 the same key', () => {
    expect(clientKey('2001:db8:1:2::1')).toBe(clientKey('2001:db8:1:2:dead:beef:0:1'));
    expect(clientKey('2001:db8:1:2::1')).not.toBe(clientKey('2001:db8:1:3::1'));
  });
});
