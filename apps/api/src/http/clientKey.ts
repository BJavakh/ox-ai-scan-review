import { isIPv6 } from 'node:net';

/**
 * Key for per-client limits. IPv6 clients typically control a whole /64, so
 * limiting by full address would give one user 2^64 budgets; IPv4-mapped
 * addresses are reduced to the IPv4 address.
 */
export function clientKey(ip: string): string {
  const address = ip.split('%')[0] ?? ip;
  if (!isIPv6(address)) return address;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  if (mapped?.[1] !== undefined) return mapped[1];

  const [head = '', tail = ''] = address.split('::');
  const headGroups = head === '' ? [] : head.split(':');
  const tailGroups = tail === '' ? [] : tail.split(':');
  const groups = address.includes('::')
    ? [
        ...headGroups,
        ...Array<string>(8 - headGroups.length - tailGroups.length).fill('0'),
        ...tailGroups,
      ]
    : address.split(':');
  return `${groups
    .slice(0, 4)
    .map((g) => g.toLowerCase().padStart(4, '0'))
    .join(':')}::/64`;
}
