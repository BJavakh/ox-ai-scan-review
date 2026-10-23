import semver from 'semver';

const NAME_PATTERN = /^(?:@[a-z0-9-*~][a-z0-9-*._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/i;
const FORBIDDEN = new Set(['__proto__', 'constructor', 'prototype', 'node_modules', 'favicon.ico']);

/** npm package name rules (legacy uppercase names allowed), max 214 chars. */
export function isValidPackageName(name: string): boolean {
  return name.length <= 214 && NAME_PATTERN.test(name) && !FORBIDDEN.has(name.toLowerCase());
}

export function isValidVersion(version: string): boolean {
  return version.length <= 256 && semver.valid(version) !== null;
}

/** Own enumerable string entries of a plain JSON object; anything else yields []. */
export function objectEntries(value: unknown): [string, unknown][] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return [];
  return Object.entries(value);
}

export function stringRecordKeys(value: unknown): string[] {
  return objectEntries(value)
    .filter(([, v]) => typeof v === 'string')
    .map(([k]) => k);
}
