import { z } from 'zod';
import { ScanFailure } from '../../domain/errors.js';
import { type Dependency, dependencyKey } from '../../domain/types.js';
import type { ResolvedDependencies } from '../DependencyResolver.js';
import { isValidPackageName, isValidVersion, objectEntries, stringRecordKeys } from './npmNames.js';

export const MAX_PACKAGES = 10_000;
const MAX_LOCK_ENTRIES = 50_000;
const MAX_INTRODUCED_BY = 3;

const entrySchema = z.object({
  name: z.string().optional(),
  version: z.string().optional(),
  dev: z.boolean().optional(),
  link: z.boolean().optional(),
  dependencies: z.unknown().optional(),
  optionalDependencies: z.unknown().optional(),
  peerDependencies: z.unknown().optional(),
  devDependencies: z.unknown().optional(),
});
type LockEntry = z.infer<typeof entrySchema>;

const NODE_MODULES = 'node_modules/';

/** "node_modules/a/node_modules/@s/b" -> "@s/b" */
function nameFromPath(path: string): string {
  const index = path.lastIndexOf(NODE_MODULES);
  return path.slice(index + NODE_MODULES.length);
}

/** "node_modules/a/node_modules/b" -> "node_modules/a"; "node_modules/a" -> "" */
function parentPath(path: string): string {
  const index = path.lastIndexOf(`/${NODE_MODULES}`);
  return index === -1 ? '' : path.slice(0, index);
}

/** Node's resolution: look in our own node_modules, then walk up. */
function resolveChild(
  entries: ReadonlyMap<string, LockEntry>,
  from: string,
  name: string,
): string | null {
  for (let base = from; ; base = parentPath(base)) {
    const candidate = base === '' ? `${NODE_MODULES}${name}` : `${base}/${NODE_MODULES}${name}`;
    if (entries.has(candidate)) return candidate;
    if (base === '') return null;
  }
}

function childNames(entry: LockEntry): string[] {
  return [
    ...stringRecordKeys(entry.dependencies),
    ...stringRecordKeys(entry.optionalDependencies),
    ...stringRecordKeys(entry.peerDependencies),
  ];
}

/** For every installed path, which direct dependencies reach it. */
function computeIntroducers(
  entries: ReadonlyMap<string, LockEntry>,
  directNames: readonly string[],
): Map<string, Set<string>> {
  const roots = new Map<string, Set<string>>();
  for (const direct of directNames) {
    const start = `${NODE_MODULES}${direct}`;
    if (!entries.has(start)) continue;
    const queue = [start];
    const visited = new Set(queue);
    while (queue.length > 0) {
      const path = queue.shift() as string;
      const set = roots.get(path) ?? new Set<string>();
      set.add(direct);
      roots.set(path, set);
      const entry = entries.get(path);
      if (!entry) continue;
      for (const child of childNames(entry)) {
        const resolved = resolveChild(entries, path, child);
        if (resolved !== null && !visited.has(resolved)) {
          visited.add(resolved);
          queue.push(resolved);
        }
      }
    }
  }
  return roots;
}

export function parseLockfile(raw: unknown, lockfileVersion: number): ResolvedDependencies {
  const rawEntries = objectEntries((raw as { packages?: unknown }).packages);
  if (rawEntries.length > MAX_LOCK_ENTRIES) throw new ScanFailure('TOO_MANY_PACKAGES');

  const entries = new Map<string, LockEntry>();
  let root: LockEntry = {};
  for (const [path, value] of rawEntries) {
    const parsed = entrySchema.safeParse(value);
    if (!parsed.success) continue;
    if (path === '') root = parsed.data;
    else if (path.startsWith(NODE_MODULES) || path.includes(`/${NODE_MODULES}`))
      entries.set(path, parsed.data);
  }

  const prodDirect = [
    ...stringRecordKeys(root.dependencies),
    ...stringRecordKeys(root.optionalDependencies),
    ...stringRecordKeys(root.peerDependencies),
  ];
  const directNames = [...new Set([...prodDirect, ...stringRecordKeys(root.devDependencies)])];
  const directSet = new Set(directNames);
  const introducers = computeIntroducers(entries, directNames);

  const byKey = new Map<string, Dependency>();
  let skipped = 0;
  for (const [path, entry] of entries) {
    if (entry.link === true) continue;
    const name = entry.name ?? nameFromPath(path);
    const version = entry.version;
    if (version === undefined || !isValidPackageName(name) || !isValidVersion(version)) {
      skipped += 1;
      continue;
    }
    const isTopLevel = path === `${NODE_MODULES}${nameFromPath(path)}`;
    const direct = isTopLevel && directSet.has(nameFromPath(path));
    const dev = entry.dev === true;
    const via = [...(introducers.get(path) ?? [])];

    const key = dependencyKey(name, version);
    const existing = byKey.get(key);
    if (existing) {
      existing.direct ||= direct;
      existing.dev &&= dev;
      existing.introducedBy = [...new Set([...existing.introducedBy, ...via])];
    } else {
      byKey.set(key, { name, version, direct, dev, introducedBy: via });
    }
    if (byKey.size > MAX_PACKAGES) throw new ScanFailure('TOO_MANY_PACKAGES');
  }

  const dependencies = [...byKey.values()].map((dep) => ({
    ...dep,
    introducedBy: dep.direct ? [] : dep.introducedBy.sort().slice(0, MAX_INTRODUCED_BY),
  }));
  const directCount = dependencies.filter((d) => d.direct).length;

  return {
    dependencies,
    coverage: {
      manifest: 'package-lock.json',
      lockfileVersion,
      accuracy: 'exact',
      packagesChecked: dependencies.length,
      directDependencies: directCount,
      transitiveDependencies: dependencies.length - directCount,
      skippedPackages: skipped,
    },
    notes:
      skipped > 0
        ? [
            `${String(skipped)} lockfile entries without a registry version (for example git or local packages) were not checked.`,
          ]
        : [],
  };
}
