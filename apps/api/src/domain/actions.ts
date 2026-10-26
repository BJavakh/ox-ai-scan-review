import semver from 'semver';
import type { Action, Finding, Severity } from '@ox-scan/shared';
import { highestSeverity, scoreAction } from './scoring.js';
import { maxVersion } from './versions.js';

function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

function describeDependency(direct: boolean, dev: boolean): string {
  return `${direct ? 'direct' : 'transitive'} ${dev ? 'development' : 'production'} dependency`;
}

/**
 * The command that actually applies the fix. `npm update` stays inside the
 * parent's semver range, so it can never cross a major version: those
 * transitive fixes are pinned with an `overrides` entry instead. Name and
 * version are validated upstream (npm name rules, semver), so quoting is safe.
 */
function buildCommand(
  name: string,
  target: string | null,
  direct: boolean,
  dev: boolean,
  majorUpgrade: boolean,
): string | null {
  if (target === null) return null;
  if (!direct) {
    return majorUpgrade
      ? `npm pkg set "overrides[${name}]=${target}" && npm install`
      : `npm update ${name}`;
  }
  return dev ? `npm install --save-dev ${name}@${target}` : `npm install ${name}@${target}`;
}

function buildRationale(
  group: readonly Finding[],
  current: readonly string[],
  target: string | null,
  fixable: number,
  severity: Severity,
  direct: boolean,
  dev: boolean,
  introducedBy: readonly string[],
  majorUpgrade: boolean,
): string {
  const name = group[0]?.packageName ?? 'package';
  const where = describeDependency(direct, dev);
  const highest = severity.toLowerCase();
  const via =
    !direct && introducedBy.length > 0 ? ` (pulled in by ${introducedBy.join(', ')})` : '';

  if (target === null) {
    return `${name} ${current.join(', ')} has ${plural(group.length, 'known issue')} (highest: ${highest}) with no patched version yet, in a ${where}${via}. Consider replacing it or limiting how untrusted input reaches it.`;
  }

  const unfixed = group.length - fixable;
  const tail = unfixed > 0 ? ` ${plural(unfixed, 'issue')} remain without a fix.` : '';
  const transitiveHint = !direct
    ? majorUpgrade
      ? ` npm update cannot cross a major version, so the command pins ${name} with an "overrides" entry; packages that expect the old major may break, so run your tests.`
      : ` If the parent package pins an older range, add an "overrides" entry for ${name}.`
    : introducedBy.length > 0
      ? ` A nested copy pulled in by ${introducedBy.join(', ')} is not fixed by npm install; add an "overrides" entry for ${name}.`
      : '';
  return `Upgrade ${name} ${current.join(', ')} to ${target}: fixes ${plural(fixable, 'issue')} (highest: ${highest}) in a ${where}${via}.${tail}${transitiveHint}`;
}

function isMajorUpgrade(current: readonly string[], target: string | null): boolean {
  if (target === null) return false;
  return current.some((v) => semver.valid(v) !== null && semver.major(target) > semver.major(v));
}

function toAction(packageName: string, group: readonly Finding[]): Action {
  const currentVersions = [...new Set(group.map((f) => f.installedVersion))].sort();
  const fixedVersions = group.flatMap((f) => (f.fixedVersion === null ? [] : [f.fixedVersion]));
  const targetVersion = maxVersion(fixedVersions);
  const fixableCount = fixedVersions.length;
  // A package that is direct anywhere counts as direct; production anywhere counts as production.
  const direct = group.some((f) => f.direct);
  const dev = group.every((f) => f.dev);
  const introducedBy = [...new Set(group.flatMap((f) => f.introducedBy))].sort().slice(0, 3);
  const severity = highestSeverity(group.map((f) => f.severity));
  const majorUpgrade = isMajorUpgrade(currentVersions, targetVersion);

  return {
    id: packageName,
    packageName,
    currentVersions,
    targetVersion,
    majorUpgrade,
    findingIds: group.map((f) => f.id),
    fixableCount,
    highestSeverity: severity,
    direct,
    dev,
    // Direct somewhere but also nested under another package: keep who pulls the nested copy in.
    introducedBy,
    score: scoreAction(group.map((f) => f.score)),
    command: buildCommand(packageName, targetVersion, direct, dev, majorUpgrade),
    rationale:
      buildRationale(
        group,
        currentVersions,
        targetVersion,
        fixableCount,
        severity,
        direct,
        dev,
        introducedBy,
        majorUpgrade,
      ) +
      (majorUpgrade
        ? ' This is a major version upgrade: review the changelog for breaking changes.'
        : ''),
  };
}

/** Score first, then more fixable issues, then more issues, then name. */
export function compareActions(a: Action, b: Action): number {
  return (
    b.score - a.score ||
    b.fixableCount - a.fixableCount ||
    b.findingIds.length - a.findingIds.length ||
    a.packageName.localeCompare(b.packageName)
  );
}

/** Group findings by package into one upgrade action each, highest score first. */
export function groupIntoActions(findings: readonly Finding[]): Action[] {
  const byPackage = new Map<string, Finding[]>();
  for (const finding of findings) {
    const group = byPackage.get(finding.packageName) ?? [];
    group.push(finding);
    byPackage.set(finding.packageName, group);
  }
  return [...byPackage.entries()]
    .map(([name, group]) => toAction(name, group))
    .sort(compareActions);
}
