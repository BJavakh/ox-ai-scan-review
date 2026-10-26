import semver from 'semver';
import {
  MAX_OTHER_RISK_PACKAGES,
  type OtherRisk,
  type OtherRiskKind,
  type OtherRiskLevel,
} from '@ox-scan/shared';

/** A dependency as declared in package.json (or the lockfile's copy of it). */
export interface DeclaredDependency {
  name: string;
  /** The specifier as written: a range, a tag, or a git/URL/file source. */
  spec: string;
  dev: boolean;
}

/** One installed package from the lockfile. */
export interface InstalledPackage {
  name: string;
  /** Null when the lockfile entry has no usable version (for example some git installs). */
  version: string | null;
  dev: boolean;
  hasInstallScript: boolean;
  /** Where npm downloaded it from, as recorded in the lockfile. */
  resolved: string | null;
  /** SPDX expression from the lockfile, when present. */
  license: string | null;
}

/** What the manifests say beyond the dependency graph. Collected while parsing, no I/O. */
export interface ManifestFacts {
  lockfile: boolean;
  declared: DeclaredDependency[];
  /** `engines.node` of the root package, if declared. */
  nodeEngine: string | null;
  /** Empty without a lockfile: those checks then do not run (the report says so). */
  installed: InstalledPackage[];
}

/**
 * Node release lines still receiving security fixes, as of 2026-10-26 (Node 20 reached end of
 * life on 2026-04-30). Update when a line reaches end of life:
 * https://github.com/nodejs/release#release-schedule
 */
export const SUPPORTED_NODE_RANGE = '>=22';

/** Below this many distinct installed versions of one package, duplication is normal. */
export const DUPLICATE_VERSION_THRESHOLD = 3;

const LEVEL_ORDER: Record<OtherRiskLevel, number> = { high: 0, medium: 1, low: 2 };

const isUrlOrGitSpec = (spec: string) =>
  /^(git(\+[a-z]+)?:|git@|github:|gitlab:|bitbucket:|gist:|https?:)/i.test(spec) ||
  // "user/repo" or "user/repo#ref" is shorthand for a GitHub repository.
  /^[\w.-]+\/[\w.-]+(#.*)?$/.test(spec);

/** Local `file:` packages are the developer's own code, so only git sources count here. */
const isGitResolved = (resolved: string) =>
  /^(git(\+[a-z]+)?:|git@)/i.test(resolved) || resolved.includes('codeload.github.com');

/** True when some way of satisfying the range has no upper bound (`*`, `>=1`, `x`). */
function isUnbounded(spec: string): boolean {
  const trimmed = spec.trim();
  // Dist-tags such as "latest" or "next" follow whatever is published next.
  if (/^[a-z][a-z0-9-]*$/i.test(trimmed) && semver.validRange(trimmed) === null) return true;
  const range = semver.validRange(trimmed) === null ? null : new semver.Range(trimmed);
  if (range === null) return false;
  return range.set.some(
    (comparators) =>
      !comparators.some(
        (c) => c.operator === '<' || c.operator === '<=' || (c.operator === '' && c.value !== ''),
      ),
  );
}

/** Strong copyleft (GPL, AGPL, SSPL), unless the expression offers an alternative with OR. */
function isStrongCopyleft(license: string): boolean {
  if (/\bOR\b/i.test(license)) return false;
  return /(^|[^L])\b(A?GPL)(-|\b)|\bSSPL\b/i.test(license);
}

const label = (p: { name: string; version: string | null }) =>
  p.version === null ? p.name : `${p.name}@${p.version}`;

/** Production packages first, then by name, unique, capped. */
function examples(items: { label: string; dev: boolean }[]): {
  packages: string[];
  totalPackages: number;
} {
  const unique = [...new Map(items.map((i) => [i.label, i])).values()].sort(
    (a, b) => Number(a.dev) - Number(b.dev) || a.label.localeCompare(b.label),
  );
  return {
    packages: unique.slice(0, MAX_OTHER_RISK_PACKAGES).map((i) => i.label),
    totalPackages: unique.length,
  };
}

function risk(
  kind: OtherRiskKind,
  level: OtherRiskLevel,
  text: { title: string; why: string; fix: string; command?: string },
  items: { label: string; dev: boolean }[],
): OtherRisk {
  return {
    kind,
    level,
    title: text.title,
    why: text.why,
    fix: text.fix,
    command: text.command ?? null,
    ...examples(items),
  };
}

const n = (count: number, one: string, many = `${one}s`) =>
  `${String(count)} ${count === 1 ? one : many}`;

/**
 * Supply-chain and hygiene risks visible in the manifests. Pure and deterministic, like the
 * vulnerability ranking; nothing here comes from the LLM. Ordered high to medium to low.
 */
export function findOtherRisks(facts: ManifestFacts): OtherRisk[] {
  const risks: OtherRisk[] = [];
  const installed = facts.installed;

  const insecure = installed.filter((p) => p.resolved?.startsWith('http://') === true);
  if (insecure.length > 0) {
    const items = insecure.map((p) => ({ label: label(p), dev: p.dev }));
    risks.push(
      risk(
        'insecure-download',
        'high',
        {
          title: `${n(insecure.length, 'package')} downloaded over plain HTTP`,
          why: 'The lockfile tells npm to fetch these over unencrypted HTTP, so anyone on the network path can swap the code that gets installed.',
          fix: 'Point npm at an HTTPS registry and regenerate the affected lockfile entries.',
          command: 'npm config set registry https://registry.npmjs.org/ && npm install',
        },
        items,
      ),
    );
  }

  const declaredSources = facts.declared.filter((d) => isUrlOrGitSpec(d.spec));
  const installedSources = installed.filter(
    (p) => p.resolved !== null && isGitResolved(p.resolved),
  );
  const sourceItems = [
    ...declaredSources.map((d) => ({ label: `${d.name} (${d.spec})`, dev: d.dev })),
    ...installedSources
      .filter((p) => !declaredSources.some((d) => d.name === p.name))
      .map((p) => ({ label: `${label(p)} (${p.resolved ?? ''})`, dev: p.dev })),
  ];
  if (sourceItems.length > 0) {
    risks.push(
      risk(
        'non-registry-source',
        sourceItems.some((i) => !i.dev) ? 'high' : 'medium',
        {
          title: `${n(sourceItems.length, 'dependency', 'dependencies')} installed from git or a URL`,
          why: 'Code from a git branch or URL can change without a new version number, bypasses the registry, and is not covered by the vulnerability database, so this scan cannot check it.',
          fix: 'Depend on a published registry version instead, or publish the fork to your own registry under a fixed version.',
        },
        sourceItems,
      ),
    );
  }

  const scripted = installed.filter((p) => p.hasInstallScript);
  if (scripted.length > 0) {
    const items = scripted.map((p) => ({ label: label(p), dev: p.dev }));
    risks.push(
      risk(
        'install-scripts',
        'medium',
        {
          title: `${n(scripted.length, 'package')} run scripts when installed`,
          why: 'Install scripts run with your permissions on every developer machine and CI runner. They are the most common way malicious packages attack, and they run before any code review.',
          fix: 'Install with scripts disabled in CI and allow only the packages that need them (usually native builds). Check that each listed package is expected to have one.',
          command: 'npm ci --ignore-scripts',
        },
        items,
      ),
    );
  }

  if (!facts.lockfile) {
    risks.push(
      risk(
        'no-lockfile',
        'medium',
        {
          title: 'No package-lock.json in the repository',
          why: 'Without a lockfile every install can pick different versions, so builds are not reproducible, a compromised release can slip in, and this scan can only estimate what is installed.',
          fix: 'Generate the lockfile, commit it, and install with npm ci in CI.',
          command: 'npm install --package-lock-only && git add package-lock.json',
        },
        [],
      ),
    );
  }

  const unpinned = facts.declared.filter((d) => !isUrlOrGitSpec(d.spec) && isUnbounded(d.spec));
  if (unpinned.length > 0) {
    const items = unpinned.map((d) => ({ label: `${d.name} (${d.spec || '""'})`, dev: d.dev }));
    risks.push(
      risk(
        'unpinned-range',
        unpinned.some((d) => !d.dev) ? 'medium' : 'low',
        {
          title: `${n(unpinned.length, 'dependency', 'dependencies')} with no upper version limit`,
          why: 'A range such as "*", "latest" or ">=1.0.0" accepts any future release, including a new major version or a compromised publish, whenever the lockfile is regenerated.',
          fix: 'Use a caret range (^1.2.3) or an exact version, and let the lockfile pin the rest.',
        },
        items,
      ),
    );
  }

  const engine = facts.nodeEngine?.trim() ?? '';
  if (
    engine !== '' &&
    semver.validRange(engine) !== null &&
    !semver.intersects(engine, SUPPORTED_NODE_RANGE)
  ) {
    risks.push(
      risk(
        'unsupported-node',
        'medium',
        {
          title: `engines.node "${engine}" allows only end-of-life Node versions`,
          why: 'Node versions past end of life get no security fixes, so the runtime itself accumulates unpatched vulnerabilities that no dependency upgrade can fix.',
          fix: 'Test on a supported LTS line (Node 22 or 24) and update engines.node.',
          command: 'npm pkg set engines.node=">=22"',
        },
        [],
      ),
    );
  }

  const copyleft = installed.filter(
    (p) => !p.dev && p.license !== null && isStrongCopyleft(p.license),
  );
  if (copyleft.length > 0) {
    const items = copyleft.map((p) => ({ label: `${label(p)} (${p.license ?? ''})`, dev: false }));
    risks.push(
      risk(
        'copyleft-license',
        'medium',
        {
          title: `${n(copyleft.length, 'production package')} under a strong copyleft licence`,
          why: 'GPL-family licences can require you to publish your own source code when you distribute the software; AGPL and SSPL can apply even when you only run it as a network service. This is a legal risk, not a vulnerability.',
          fix: 'Have the licences reviewed, or replace these packages with permissively licensed alternatives.',
        },
        items,
      ),
    );
  }

  const versionsByName = new Map<string, { versions: Set<string>; dev: boolean }>();
  for (const p of installed) {
    if (p.version === null) continue;
    const entry = versionsByName.get(p.name) ?? { versions: new Set<string>(), dev: true };
    entry.versions.add(p.version);
    entry.dev &&= p.dev;
    versionsByName.set(p.name, entry);
  }
  const duplicated = [...versionsByName].filter(
    ([, v]) => v.versions.size >= DUPLICATE_VERSION_THRESHOLD,
  );
  if (duplicated.length > 0) {
    risks.push(
      risk(
        'duplicate-versions',
        'low',
        {
          title: `${n(duplicated.length, 'package')} installed in ${String(DUPLICATE_VERSION_THRESHOLD)} or more versions`,
          why: 'Every extra copy is more code to audit and patch: a fix in one version does not reach the others, and install size grows.',
          fix: 'Deduplicate, then update the direct dependencies that still pin old versions.',
          command: 'npm dedupe',
        },
        duplicated.map(([name, v]) => ({
          label: `${name} (${String(v.versions.size)} versions)`,
          dev: v.dev,
        })),
      ),
    );
  }

  return risks.sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]);
}
