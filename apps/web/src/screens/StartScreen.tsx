import { useId, useState } from 'react';
import { type HealthResponse, isTerminalStatus, parseGitHubRepoUrl } from '@ox-scan/shared';
import { ApiRequestError, api } from '../api/client';
import { DotPill, RiskPill } from '../components/Badges';
import { Band, Panel, SectionHead } from '../components/Layout';
import { useAsync } from '../hooks/useAsync';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { navigate } from '../hooks/useHashRoute';
import { normalizeRepoInput, relativeTime } from '../lib/format';
import { goToStartSection } from '../lib/sections';
import { Faq } from './start/Faq';
import { Features } from './start/Features';
import { HowItWorks } from './start/HowItWorks';

const ON_THIS_PAGE = [
  { id: 'scan', label: 'Scan a repository' },
  { id: 'features', label: 'See what a report contains' },
  { id: 'examples', label: 'Try an example repository' },
  { id: 'recent', label: 'Open a recent scan' },
  { id: 'how-it-works', label: 'Learn how it works' },
];

const LIVE_EXAMPLES = [
  {
    url: 'https://github.com/OWASP/NodeGoat',
    note: 'Deliberately vulnerable app',
    hint: 'Lockfile v2',
  },
  {
    url: 'https://github.com/snyk-labs/nodejs-goof',
    note: 'Old dependencies, many advisories',
    hint: 'Lockfile v2',
  },
  {
    url: 'https://github.com/expressjs/express',
    note: 'No lockfile, so the scan is approximate',
    hint: 'package.json',
  },
];

const MOCK_EXAMPLES = [
  {
    url: 'https://github.com/demo/vulnerable-app',
    note: 'Lockfile with known vulnerabilities',
    hint: 'Lockfile v3',
  },
  {
    url: 'https://github.com/demo/clean-app',
    note: 'Nothing known to fix',
    hint: 'Lockfile v3',
  },
  {
    url: 'https://github.com/demo/approximate-app',
    note: 'package.json only, approximate',
    hint: 'package.json',
  },
  {
    url: 'https://github.com/demo/python-only',
    note: 'Unsupported ecosystem, shows a failure',
    hint: 'requirements.txt',
  },
];

export function StartScreen({ health }: { health: HealthResponse | null }) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const inputId = useId();
  const hintId = useId();
  const errorId = useId();
  const recent = useAsync(() => api.listScans(), 'recent');
  useDocumentTitle(null);
  const preview = value.trim() === '' ? null : parseGitHubRepoUrl(normalizeRepoInput(value));

  const start = async (raw: string) => {
    const parsed = parseGitHubRepoUrl(normalizeRepoInput(raw));
    if (!parsed.ok) {
      setError(parsed.message);
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const { scanId } = await api.createScan(parsed.value.canonicalUrl);
      navigate({ name: 'scan', id: scanId });
    } catch (e) {
      setError(e instanceof ApiRequestError ? e.message : 'Could not start the scan.');
      setSubmitting(false);
    }
  };

  const examples = health?.mode === 'mock' ? MOCK_EXAMPLES : LIVE_EXAMPLES;

  return (
    <>
      <Band tone="paper" labelledBy="hero-title" className="hero">
        <div className="hero-grid">
          <div className="hero-copy reveal">
            <p className="micro">Dependency security review for npm projects</p>
            <h1 id="hero-title" className="display">
              See what to fix first
            </h1>
            <p className="hero-lead">
              Paste a public GitHub repository. We check every npm package it uses against known
              vulnerabilities and tell you which few upgrades remove the most risk, why, and the
              exact commands to run.
            </p>

            <form
              className="scan-form"
              noValidate
              onSubmit={(event) => {
                event.preventDefault();
                void start(value);
              }}
            >
              <label htmlFor={inputId} className="field-label">
                Repository URL
              </label>
              <div className="field-row">
                <input
                  id={inputId}
                  name="repoUrl"
                  type="url"
                  inputMode="url"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="github.com/owner/repo"
                  value={value}
                  onChange={(e) => {
                    setValue(e.target.value);
                    if (error) setError(null);
                  }}
                  aria-invalid={error !== null}
                  aria-describedby={error ? `${errorId} ${hintId}` : hintId}
                  required
                />
                <button type="submit" className="btn btn-ink" disabled={submitting}>
                  {submitting ? 'Starting' : 'Scan repository'}
                  <span aria-hidden="true">→</span>
                </button>
              </div>
              <p id={errorId} className="form-error" role="alert">
                {error}
              </p>
              {error === null && preview?.ok === true && (
                <p className="field-preview" aria-live="polite">
                  <span className="dot" aria-hidden="true" />
                  Will scan{' '}
                  <strong>
                    {preview.value.owner}/{preview.value.repo}
                  </strong>{' '}
                  on {preview.value.ref === null ? 'the default branch' : preview.value.ref}
                </p>
              )}
              <p id={hintId} className="micro">
                npm lockfile or package.json · advisories from OSV.dev · nothing is cloned or
                executed
              </p>
            </form>
          </div>

          <div className="hero-index reveal" style={{ animationDelay: '120ms' }}>
            <dl className="facts-grid">
              <div>
                <dt>Scans</dt>
                <dd>Public GitHub repos, npm</dd>
              </div>
              <div>
                <dt>Takes</dt>
                <dd>About 20 seconds</dd>
              </div>
              <div>
                <dt>Needs</dt>
                <dd>No sign-up, no install</dd>
              </div>
              <div>
                <dt>Never</dt>
                <dd>Runs or clones your code</dd>
              </div>
            </dl>
            <nav aria-label="On this page">
              <p className="micro">What you can do here</p>
              <ol className="index-list">
                {ON_THIS_PAGE.map((item, i) => (
                  <li key={item.id}>
                    <a
                      href="#/"
                      onClick={(e) => {
                        e.preventDefault();
                        if (item.id === 'scan') document.getElementById(inputId)?.focus();
                        else goToStartSection(item.id);
                      }}
                    >
                      <span className="index-n">{String(i + 1).padStart(2, '0')}</span>
                      {item.label}
                    </a>
                  </li>
                ))}
              </ol>
            </nav>
          </div>
        </div>
      </Band>

      <Features />
      <HowItWorks />

      <Band tone="white" id="examples" labelledBy="examples-title">
        <SectionHead
          index="03"
          label="Examples"
          titleId="examples-title"
          title={
            <>
              Start with a repository
              <br />
              you already know
            </>
          }
          lead={
            health?.mode === 'mock'
              ? 'Offline demo data: each example exercises a different outcome, including a failure.'
              : 'Public projects with known, intentionally outdated dependencies, and one without a lockfile.'
          }
        />
        <Panel
          className="reveal-up"
          toolbar={
            <>
              <span className="toolbar-title">Examples</span>
              <span className="toolbar-meta">{examples.length} repositories</span>
            </>
          }
        >
          <ul className="rows">
            {examples.map((ex) => (
              <li key={ex.url}>
                <button
                  type="button"
                  className="row row-button"
                  disabled={submitting}
                  onClick={() => {
                    setValue(ex.url);
                    void start(ex.url);
                  }}
                >
                  <span className="row-avatar mono" aria-hidden="true">
                    {ex.url.split('/')[4]?.slice(0, 2).toUpperCase()}
                  </span>
                  <span className="row-main">
                    <span className="row-title">{ex.url.replace('https://github.com/', '')}</span>
                    <span className="row-sub">{ex.note}</span>
                  </span>
                  <span className="row-side">
                    <DotPill tone="neutral">{ex.hint}</DotPill>
                    <span className="row-go" aria-hidden="true">
                      Scan →
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Panel>
      </Band>

      <Band tone="paper" id="recent" labelledBy="recent-title">
        <SectionHead
          index="04"
          label="Recent"
          titleId="recent-title"
          title="Your recent scans"
          lead="Scans started from your network, kept in memory until the server restarts. Other visitors never see them."
        />
        <Panel
          toolbar={
            <>
              <span className="toolbar-title">Recent scans</span>
              <span className="toolbar-meta">
                {recent.status === 'ready' ? `${String(recent.data.length)} total` : ''}
              </span>
            </>
          }
        >
          {recent.status === 'loading' && <p className="panel-empty">Loading</p>}
          {recent.status === 'error' && (
            <p className="panel-empty">Recent scans are unavailable. {recent.error.message}</p>
          )}
          {recent.status === 'ready' && recent.data.length === 0 && (
            <p className="panel-empty">
              No scans yet. Pick an example above or paste a repository URL.
            </p>
          )}
          {recent.status === 'ready' && recent.data.length > 0 && (
            <ul className="rows">
              {recent.data.map((scan) => (
                <li key={scan.id}>
                  <a href={`#/scans/${scan.id}`} className="row">
                    <span className="row-avatar mono" aria-hidden="true">
                      {scan.repo.name.slice(0, 2).toUpperCase()}
                    </span>
                    <span className="row-main">
                      <span className="row-title">
                        {scan.repo.owner}/{scan.repo.name}
                        {scan.ref !== null && <span className="row-ref"> #{scan.ref}</span>}
                      </span>
                      <span className="row-sub">
                        {scan.commitSha === null
                          ? 'Commit pending'
                          : `Commit ${scan.commitSha.slice(0, 7)}`}{' '}
                        · {relativeTime(scan.createdAt)}
                      </span>
                    </span>
                    <span className="row-side">
                      {scan.riskLevel !== null ? (
                        <RiskPill level={scan.riskLevel} />
                      ) : isTerminalStatus(scan.status) ? (
                        <DotPill tone="critical">Failed</DotPill>
                      ) : (
                        <DotPill tone="live">Running</DotPill>
                      )}
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </Band>
      <Faq />
    </>
  );
}
