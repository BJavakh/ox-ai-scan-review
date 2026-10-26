import type { Action, Finding } from '@ox-scan/shared';
import { plural } from '../lib/format';
import { DotPill, SeverityPill, dependencyLabel } from './Badges';
import { CopyButton } from './CopyButton';

/** Only the advice the row does not already show; the rest of the rationale is visible above. */
function groupByAdvisory(
  findings: readonly Finding[],
): Map<string, { finding: Finding; versions: string[] }> {
  const groups = new Map<string, { finding: Finding; versions: string[] }>();
  for (const f of findings) {
    const group = groups.get(f.id);
    if (group) group.versions.push(f.installedVersion);
    else groups.set(f.id, { finding: f, versions: [f.installedVersion] });
  }
  return groups;
}

function adviceFor(action: Action): string[] {
  const advice: string[] = [];
  if (action.targetVersion === null) {
    advice.push(
      'No patched version exists yet. Replace the package, or limit how untrusted input reaches it.',
    );
  } else if (action.direct && action.introducedBy.length > 0) {
    advice.push(
      `A nested copy pulled in by ${action.introducedBy.join(', ')} is not fixed by this command; also add "${action.packageName}": "${action.targetVersion}" under "overrides" in package.json.`,
    );
  } else if (!action.direct && action.majorUpgrade) {
    const parents =
      action.introducedBy.length > 0 ? action.introducedBy.join(', ') : 'the packages that use it';
    advice.push(
      `npm update cannot cross a major version, so this command pins it for every package with an "overrides" entry. ${parents} may expect the old major: run your tests after upgrading.`,
    );
  } else if (!action.direct) {
    advice.push(
      `If ${action.introducedBy[0] ?? 'the parent package'} pins an older range, add "${action.packageName}": "${action.targetVersion}" under "overrides" in package.json.`,
    );
  }
  if (action.majorUpgrade && (action.direct || action.targetVersion === null))
    advice.push('Major version change: read the changelog for breaking changes before upgrading.');
  return advice;
}

export function ActionRow({
  action,
  rank,
  fixed,
}: {
  action: Action;
  rank: number;
  /** This package's findings, in priority order. */
  fixed: readonly Finding[];
}) {
  const issues = action.findingIds.length;
  const fixable = action.targetVersion !== null;
  const titleId = `action-${action.id}`;
  // One row per advisory: a package installed at several versions has one finding per version.
  const advisories = [...groupByAdvisory(fixed).values()];

  return (
    <li className={`action-row ${fixable ? '' : 'is-nofix'}`} aria-labelledby={titleId}>
      <span className="action-rank mono" aria-hidden="true">
        {String(rank).padStart(2, '0')}
      </span>
      <div className="action-main">
        <div className="action-line">
          <h3 id={titleId} className="action-name">
            <span className="visually-hidden">{fixable ? 'Upgrade ' : 'Replace or mitigate '}</span>
            {action.packageName}
          </h3>
          <span className="action-versions mono">
            {action.currentVersions.join(', ')}
            {fixable && (
              <>
                <span className="arrow" aria-hidden="true">
                  {' '}
                  →{' '}
                </span>
                <span className="visually-hidden"> to </span>
                <strong>{action.targetVersion}</strong>
              </>
            )}
          </span>
        </div>
        <p className="action-sub">
          {dependencyLabel(action.direct, action.dev, action.introducedBy)}
          {' · '}
          {fixable
            ? `fixes ${plural(action.fixableCount, 'issue')}${action.fixableCount < issues ? ` of ${String(issues)}` : ''}`
            : `${plural(issues, 'issue')}, no patched version yet`}
        </p>
        {action.command !== null && (
          <div className="command">
            <code>{action.command}</code>
            <CopyButton text={action.command} label={`Copy command for ${action.packageName}`} />
          </div>
        )}
        {adviceFor(action).map((line) => (
          <p key={line} className="action-advice">
            {line}
          </p>
        ))}
        {advisories.length > 0 && (
          <details className="fixes">
            <summary>
              {fixable ? 'What this upgrade fixes' : 'Open issues'}{' '}
              <span className="fixes-count">
                {plural(advisories.length, 'advisory', 'advisories')}
              </span>
            </summary>
            <ul className="fixes-list">
              {advisories.map(({ finding: f, versions }) => (
                <li key={f.id}>
                  <SeverityPill severity={f.severity} />
                  <span className="fixes-title">
                    {f.summary}
                    {action.currentVersions.length > 1 && (
                      <span className="fixes-versions mono"> {versions.join(', ')}</span>
                    )}
                  </span>
                  <a
                    href={f.advisoryUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="link-mono"
                  >
                    {f.aliases[0] ?? f.id}
                    <span className="visually-hidden"> (opens in a new tab)</span>
                  </a>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
      <div className="action-side">
        <SeverityPill severity={action.highestSeverity} />
        {action.majorUpgrade && <DotPill tone="neutral">Major upgrade</DotPill>}
      </div>
    </li>
  );
}
