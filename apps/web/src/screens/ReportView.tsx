import { useEffect, useMemo, useState } from 'react';
import type { Finding, Report, Scan } from '@ox-scan/shared';
import { ActionRow } from '../components/ActionRow';
import { DotPill, RiskPill, SeverityPill, dependencyLabel } from '../components/Badges';
import { FindingsTable } from '../components/FindingsTable';
import { CopyButton } from '../components/CopyButton';
import { Legend } from '../components/Legend';
import { RescanButton } from '../components/RescanButton';
import { Band, Panel, SectionHead } from '../components/Layout';
import { ReportNav, type ReportSection, scrollToSection } from '../components/ReportNav';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { RISK_LABELS, formatDuration, plural, shortSha } from '../lib/format';

const FIX_FIRST = 3;

/** Section links phrased as what the reader does there. */
const NEXT_STEP: Record<string, string> = {
  'fix-first': 'Run the top upgrades',
  'top-risks': 'Read why they matter',
  coverage: 'Check what was not scanned',
  findings: 'Search every finding',
};

function sectionsFor(report: Report): ReportSection[] {
  const clean = report.findings.length === 0;
  return [
    ...(clean
      ? []
      : [
          { id: 'fix-first', label: 'Fix first' },
          { id: 'top-risks', label: 'Top risks' },
        ]),
    { id: 'coverage', label: 'What we checked' },
    ...(clean ? [] : [{ id: 'findings', label: 'All findings' }]),
  ];
}

function Hero({ report, sections }: { report: Report; sections: ReportSection[] }) {
  const { summary, stats } = report;
  return (
    <Band tone="paper" id="report-hero" labelledBy="report-title" className="hero">
      <div className="hero-grid">
        <div className="hero-copy reveal">
          <p className="micro">
            Security review · commit {shortSha(report.commitSha)}
            {report.ref !== null && ` · ${report.ref}`}
          </p>
          <h1 id="report-title" className="display display-repo">
            <a href={report.repo.url} target="_blank" rel="noopener noreferrer">
              {report.repo.owner}/{report.repo.name}
              <span className="visually-hidden"> (opens GitHub in a new tab)</span>
            </a>
          </h1>
          <div className="verdict">
            <RiskPill
              level={report.riskLevel}
              estimated={report.coverage.accuracy === 'approximate'}
            />
            <span className="micro">
              {summary.mode === 'ai'
                ? 'AI-written summary · advisory IDs and versions checked'
                : 'Template summary'}
            </span>
          </div>
          {/* Plain text only: summaries are never rendered as HTML or markdown. */}
          <p className="headline">{summary.headline}</p>
          <p className="hero-lead">{summary.overview}</p>
          <div className="btn-row">
            <a className="btn" href="#/">
              New scan <span aria-hidden="true">→</span>
            </a>
            <CopyButton
              text={() => window.location.href}
              label="Copy a link to this report"
              idleText="Copy link"
              className="btn"
            />
            <a
              className="btn btn-quiet"
              href={`/api/scans/${report.scanId}/report`}
              target="_blank"
              rel="noopener noreferrer"
            >
              Report JSON
            </a>
          </div>
        </div>

        <div className="hero-index reveal" style={{ animationDelay: '120ms' }}>
          {stats.totalFindings > 0 && (
            <dl className="stats">
              <div>
                <dt>Findings</dt>
                <dd>{stats.totalFindings.toLocaleString()}</dd>
              </div>
              <div>
                <dt>Critical · High</dt>
                <dd>
                  {stats.bySeverity.CRITICAL} · {stats.bySeverity.HIGH}
                </dd>
              </div>
              <div>
                <dt>Fixable</dt>
                <dd>{stats.fixableFindings.toLocaleString()}</dd>
              </div>
              <div>
                <dt>Upgrades</dt>
                <dd>{stats.actionCount.toLocaleString()}</dd>
              </div>
            </dl>
          )}
          <nav aria-label="Your next steps">
            <p className="micro">Your next steps</p>
            <ol className="index-list steps-list">
              {sections.map((s, i) => (
                <li key={s.id}>
                  <a
                    href={`#${s.id}`}
                    onClick={(e) => {
                      e.preventDefault();
                      scrollToSection(s.id);
                    }}
                  >
                    <span className="index-n">{String(i + 1).padStart(2, '0')}</span>
                    {NEXT_STEP[s.id] ?? s.label}
                  </a>
                </li>
              ))}
              <li>
                <span className="index-n">{String(sections.length + 1).padStart(2, '0')}</span>
                <span>
                  After upgrading, commit and{' '}
                  <RescanButton scan={report} label="scan again" className="link-button" />
                </span>
              </li>
            </ol>
          </nav>
        </div>
      </div>
    </Band>
  );
}

function FixFirst({ report, index }: { report: Report; index: string }) {
  const [showAll, setShowAll] = useState(false);
  const { actions } = report;
  const shown = showAll ? actions : actions.slice(0, FIX_FIRST);
  const byPackage = useMemo(() => {
    const map = new Map<string, Finding[]>();
    for (const f of report.findings) map.set(f.packageName, [...(map.get(f.packageName) ?? []), f]);
    return map;
  }, [report.findings]);
  const topCommands = actions
    .slice(0, FIX_FIRST)
    .flatMap((a) => (a.command === null ? [] : [a.command]))
    .join('\n');
  const covered = actions.slice(0, FIX_FIRST).reduce((n, a) => n + a.fixableCount, 0);
  const lead =
    actions.length > FIX_FIRST
      ? `The first ${String(FIX_FIRST)} upgrades fix ${plural(covered, 'issue')}. Ranked by the most severe issue each one fixes, then by how many.`
      : 'Ranked by the most severe issue each one fixes, then by how many.';
  return (
    <Band tone="white" id="fix-first" labelledBy="fix-first-title">
      <SectionHead
        index={index}
        label="Fix first"
        titleId="fix-first-title"
        title={
          actions.length === 1
            ? 'One upgrade to make'
            : `${plural(Math.min(FIX_FIRST, actions.length), 'upgrade')} to make first`
        }
        lead={lead}
      />
      <Legend />
      <Panel
        toolbar={
          <>
            <span className="toolbar-title">Actions</span>
            <span className="toolbar-meta">
              {plural(actions.length, 'upgrade')} ·{' '}
              {plural(report.stats.fixableFindings, 'fixable issue')}
            </span>
            {topCommands !== '' && (
              <CopyButton
                text={topCommands}
                label={`Copy the commands for the first ${String(FIX_FIRST)} upgrades`}
                idleText="Copy top commands"
              />
            )}
          </>
        }
      >
        <ol className="action-list">
          {shown.map((action, i) => (
            <ActionRow
              key={action.id}
              action={action}
              rank={i + 1}
              fixed={byPackage.get(action.packageName) ?? []}
            />
          ))}
        </ol>
        {actions.length > FIX_FIRST && (
          <button
            type="button"
            className="panel-more"
            aria-expanded={showAll}
            onClick={() => {
              setShowAll((v) => !v);
            }}
          >
            {showAll ? 'Show the first three only' : `Show all ${String(actions.length)} upgrades`}
          </button>
        )}
      </Panel>
    </Band>
  );
}

function TopRisks({ report, index }: { report: Report; index: string }) {
  // An advisory ID alone is not unique: the same advisory can hit several packages and versions.
  const findingFor = (id: string, packageName: string) =>
    report.findings.find((f) => f.id === id && f.packageName === packageName);
  return (
    <Band tone="paper" id="top-risks" labelledBy="risks-title">
      <SectionHead
        index={index}
        label="Top risks"
        titleId="risks-title"
        title="Why these matter"
        lead="The most serious issue in each of the riskiest packages, in plain language."
      />
      <Panel>
        <ol className="risk-list">
          {report.topRisks.map((risk) => {
            const finding = findingFor(risk.findingId, risk.packageName);
            return (
              <li key={risk.findingId} className="risk">
                <div className="risk-top">
                  <SeverityPill severity={risk.severity} />
                  <span className="risk-pkg mono">
                    {risk.packageName}
                    {finding && `@${finding.installedVersion}`}
                  </span>
                  {finding && (
                    <span className="risk-dep">
                      {dependencyLabel(finding.direct, finding.dev, finding.introducedBy)}
                    </span>
                  )}
                </div>
                <h3 className="risk-title">{risk.title}</h3>
                <p className="risk-text">{risk.explanation}</p>
                {finding && (
                  <a
                    href={finding.advisoryUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="link-mono"
                  >
                    {risk.findingId}
                    {finding.aliases.length > 0 && ` · ${finding.aliases.join(', ')}`}
                    <span className="visually-hidden"> (opens in a new tab)</span>
                  </a>
                )}
              </li>
            );
          })}
        </ol>
      </Panel>
    </Band>
  );
}

function Coverage({
  report,
  scan,
  index,
  tone,
}: {
  report: Report;
  scan: Scan;
  index: string;
  tone: 'paper' | 'white';
}) {
  const { coverage, summary } = report;
  const duration =
    scan.finishedAt === null ? null : Date.parse(scan.finishedAt) - Date.parse(scan.createdAt);
  const rows: [string, React.ReactNode][] = [
    [
      'Commit',
      <a
        key="c"
        href={`${report.repo.url}/tree/${report.commitSha}`}
        target="_blank"
        rel="noopener noreferrer"
        className="link-mono"
      >
        {shortSha(report.commitSha)}
        <span className="visually-hidden"> (opens GitHub in a new tab)</span>
      </a>,
    ],
    [
      'Manifest',
      <span key="m" className="mono">
        {coverage.manifest}
        {coverage.lockfileVersion !== null && ` · v${String(coverage.lockfileVersion)}`}
      </span>,
    ],
    [
      'Accuracy',
      coverage.accuracy === 'exact'
        ? 'Exact versions from the lockfile'
        : 'Approximate: no supported lockfile',
    ],
    [
      'Packages',
      `${coverage.packagesChecked.toLocaleString()} checked · ${coverage.directDependencies.toLocaleString()} direct · ${coverage.transitiveDependencies.toLocaleString()} transitive`,
    ],
    [
      'Not checked',
      [
        coverage.skippedPackages > 0
          ? plural(coverage.skippedPackages, 'non-registry package')
          : null,
        coverage.unsupportedManifests.length > 0
          ? `Unsupported: ${coverage.unsupportedManifests.join(', ')}`
          : null,
        'Subdirectories, first-party code',
      ]
        .filter(Boolean)
        .join(' · '),
    ],
    ['Sources', 'Repository root via the GitHub API · advisories from OSV.dev'],
    [
      'Summary',
      summary.mode === 'ai'
        ? 'Written by AI from the ranked findings; advisory IDs, versions, links and commands are checked before display'
        : `Template${summary.fallbackReason !== null ? ` · ${summary.fallbackReason}` : ''}`,
    ],
    [
      'Scanned',
      report.reusedFromScanId !== null ? (
        <span key="s">
          Reused <a href={`#/scans/${report.reusedFromScanId}`}>an earlier scan</a> of the same
          commit
        </span>
      ) : (
        `${new Date(report.generatedAt).toLocaleString()}${duration !== null ? ` · ${formatDuration(duration)}` : ''}`
      ),
    ],
  ];
  return (
    <Band tone={tone} id="coverage" labelledBy="coverage-title">
      <SectionHead
        index={index}
        label="Coverage"
        titleId="coverage-title"
        title="What we checked, and what we didn't"
        lead="A clean result only means something if you know its scope."
      />
      <Panel>
        <dl className="spec">
          {rows.map(([label, value]) => (
            <div key={label} className="spec-row">
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
        {report.notes.length > 0 && (
          <div className="notes">
            <p className="micro">Notes</p>
            <ul>
              {report.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </div>
        )}
      </Panel>
    </Band>
  );
}

export function ReportView({ report, scan }: { report: Report; scan: Scan }) {
  const sections = sectionsFor(report);
  const indexOf = (id: string) =>
    String(sections.findIndex((s) => s.id === id) + 1).padStart(2, '0');
  const clean = report.findings.length === 0;
  useDocumentTitle(`${report.repo.owner}/${report.repo.name} · ${RISK_LABELS[report.riskLevel]}`);

  // The report replaces the progress screen in place; start reading it from the top.
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [report.scanId]);

  return (
    <>
      <ReportNav report={report} sections={sections} />
      <Hero report={report} sections={sections} />
      {clean && (
        <Band tone="white" labelledBy="clean-title">
          <div className="clean">
            <DotPill tone="none">No known vulnerabilities</DotPill>
            <h2 id="clean-title" className="section-title">
              Nothing to upgrade today
            </h2>
            <p className="section-lead">
              None of the {plural(report.coverage.packagesChecked, 'package')} we checked has a
              published advisory in OSV.dev right now. That is not proof of safety; the scope is
              listed below.
            </p>
          </div>
        </Band>
      )}
      {!clean && <FixFirst report={report} index={indexOf('fix-first')} />}
      {!clean && <TopRisks report={report} index={indexOf('top-risks')} />}
      <Coverage
        report={report}
        scan={scan}
        index={indexOf('coverage')}
        tone={clean ? 'paper' : 'white'}
      />
      {!clean && (
        <Band tone="paper" id="findings" labelledBy="findings-title">
          <SectionHead
            index={indexOf('findings')}
            label="All findings"
            titleId="findings-title"
            title="Every advisory, filterable"
            lead="One row per advisory and installed version, highest priority first."
          />
          <FindingsTable findings={report.findings} />
        </Band>
      )}
    </>
  );
}
