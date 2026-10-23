import { ScanFailure } from '../../domain/errors.js';
import { safeJsonParse } from '../../lib/http.js';
import type { DependencyResolver, ResolvedDependencies } from '../DependencyResolver.js';
import { parseLockfile } from './lockfile.js';
import { parsePackageJson } from './packageJson.js';

const LOCKFILE = 'package-lock.json';
const PACKAGE_JSON = 'package.json';

function parseObject(text: string): Record<string, unknown> {
  const parsed = safeJsonParse(text);
  if (
    !parsed.ok ||
    typeof parsed.value !== 'object' ||
    parsed.value === null ||
    Array.isArray(parsed.value)
  ) {
    throw new ScanFailure('MANIFEST_INVALID');
  }
  return parsed.value as Record<string, unknown>;
}

export class NpmDependencyResolver implements DependencyResolver {
  readonly ecosystem = 'npm' as const;

  manifestsToFetch(rootFiles: readonly string[]): string[] {
    return [LOCKFILE, PACKAGE_JSON].filter((name) => rootFiles.includes(name));
  }

  resolve(files: ReadonlyMap<string, string>): ResolvedDependencies {
    const lockText = files.get(LOCKFILE);
    const pkgText = files.get(PACKAGE_JSON);
    const notes: string[] = [];

    if (lockText !== undefined) {
      const lock = parseObject(lockText);
      const version = lock.lockfileVersion;
      if ((version === 2 || version === 3) && typeof lock.packages === 'object') {
        return parseLockfile(lock, version);
      }
      notes.push(
        `package-lock.json uses lockfileVersion ${typeof version === 'number' ? String(version) : 'unknown'}, which is not supported (v2 and v3 are).`,
      );
    }

    if (pkgText === undefined) {
      throw lockText === undefined
        ? new ScanFailure('NO_SUPPORTED_MANIFEST')
        : new ScanFailure('MANIFEST_INVALID');
    }
    return parsePackageJson(parseObject(pkgText), notes);
  }
}
