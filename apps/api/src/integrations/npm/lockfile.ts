import { z } from 'zod';
import { ScanFailure } from '../../domain/errors.js';
import type { DeclaredDependency, InstalledPackage } from '../../domain/otherRisks.js';
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
  // Metadata for the "other risks" checks. Unknown, then narrowed, so an odd value in one of
  // these fields never drops the entry from the vulnerability scan.
  resolved: z.unknown().optional(),
  hasInstallScript: z.unknown().optional(),
  license: z.unknown().optional(),
  engines: z.unknown().optional(),
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
  ].filter(isValidPackageName);
}

const MAX_FACT_STRING = 300;
const factString = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 ? value.slice(0, MAX_FACT_STRING) : null;

/** Declared specifiers of a root or workspace entry, as written in its package.json. */
export function declaredDependencies(entry: {
  dependencies?: unknown;
  optionalDependencies?: unknown;
  devDependencies?: unknown;
}): DeclaredDependency[] {
  const declared: DeclaredDependency[] = [];
  const add = (field: unknown, dev: boolean) => {
    for (const [name, spec] of objectEntries(field)) {
      if (typeof spec === 'string' && isValidPackageName(name)) {
        declared.push({ name, spec: spec.slice(0, MAX_FACT_STRING), dev });
      }
    }
  };
  add(entry.dependencies, false);
  add(entry.optionalDependencies, false);
  add(entry.devDependencies, true);
  return declared;
}

/** `engines.node` of a package entry, if it is a string. */
export function nodeEngine(engines: unknown): string | null {
  if (typeof engines !== 'object' || engines === null) return null;
  return factString((engines as Record<string, unknown>).node);
}

function sourceDependencyNames(entry: LockEntry): string[] {
  return [
    ...childNames(entry),
    ...stringRecordKeys(entry.devDependencies).filter(isValidPackageName),
  ];
}

/** Upper bound on graph-walk steps: linear in a valid lockfile, so this only stops hostile input. */
const MAX_GRAPH_STEPS = 2_000_000;

/**
 * Which direct dependencies pull in each installed path. One multi-source
 * breadth-first walk; each path keeps at most MAX_INTRODUCED_BY names and is
 * only re-visited when its set grows, so the work is linear in the graph size
 * (a per-root walk was quadratic and could block the event loop).
 */
function computeIntroducers(
  entries: ReadonlyMap<string, LockEntry>,
  directPaths: ReadonlyMap<string, string>,
): Map<string, Set<string>> {
  const roots = new Map<string, Set<string>>();
  const queue: string[] = [];
  let steps = 0;

  const add = (path: string, name: string): void => {
    const set = roots.get(path) ?? new Set<string>();
    if (set.has(name) || set.size >= MAX_INTRODUCED_BY) return;
    set.add(name);
    roots.set(path, set);
    queue.push(path);
  };

  for (const [path, name] of directPaths) add(path, name);
  for (let head = 0; head < queue.length; head++) {
    const path = queue[head] as string;
    const entry = entries.get(path);
    const names = roots.get(path);
    if (!entry || !names) continue;
    for (const child of childNames(entry)) {
      steps += 1;
      if (steps > MAX_GRAPH_STEPS)
        throw new ScanFailure('TOO_MANY_PACKAGES', 'dependency graph too large');
      const resolved = resolveChild(entries, path, child);
      if (resolved === null) continue;
      for (const name of names) add(resolved, name);
    }
  }
  return roots;
}

export function parseLockfile(raw: unknown, lockfileVersion: number): ResolvedDependencies {
  const rawEntries = objectEntries((raw as { packages?: unknown }).packages);
  if (rawEntries.length > MAX_LOCK_ENTRIES) throw new ScanFailure('TOO_MANY_PACKAGES');

  const entries = new Map<string, LockEntry>();
  /** The root ("") and npm workspace folders: the places dependencies are declared. */
  const sources = new Map<string, LockEntry>();
  for (const [path, value] of rawEntries) {
    const parsed = entrySchema.safeParse(value);
    if (!parsed.success) continue;
    if (path.startsWith(NODE_MODULES) || path.includes(`/${NODE_MODULES}`)) {
      // Only paths whose package segment is a valid npm name enter the graph.
      if (isValidPackageName(nameFromPath(path))) entries.set(path, parsed.data);
    } else if (path === '' || parsed.data.link !== true) {
      sources.set(path, parsed.data);
    }
  }

  // A direct dependency is whatever a source's declared name resolves to, top-level or nested.
  const directPaths = new Map<string, string>();
  for (const [sourcePath, source] of sources) {
    for (const name of sourceDependencyNames(source)) {
      const resolved = resolveChild(entries, sourcePath, name);
      if (resolved !== null && !directPaths.has(resolved)) directPaths.set(resolved, name);
    }
  }
  const introducers = computeIntroducers(entries, directPaths);

  const byKey = new Map<string, Dependency>();
  const installed: InstalledPackage[] = [];
  let skipped = 0;
  for (const [path, entry] of entries) {
    if (entry.link === true) continue;
    const name = entry.name ?? nameFromPath(path);
    const version = entry.version;
    // Recorded before the version check: git installs without a registry version matter here.
    installed.push({
      name: isValidPackageName(name) ? name : nameFromPath(path),
      version: version !== undefined && isValidVersion(version) ? version : null,
      dev: entry.dev === true,
      hasInstallScript: entry.hasInstallScript === true,
      resolved: factString(entry.resolved),
      license: factString(entry.license),
    });
    if (version === undefined || !isValidPackageName(name) || !isValidVersion(version)) {
      skipped += 1;
      continue;
    }
    const direct = directPaths.has(path);
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
  const root = sources.get('');

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
    facts: {
      lockfile: true,
      declared: [...sources.values()].flatMap(declaredDependencies),
      nodeEngine: nodeEngine(root?.engines),
      installed,
    },
  };
}
