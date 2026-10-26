import { useId, useMemo, useState } from 'react';
import { type Finding, SEVERITY_ORDER, type Severity } from '@ox-scan/shared';
import { SEVERITY_LABELS, plural } from '../lib/format';
import { SeverityPill } from './Badges';

type DepFilter = 'all' | 'production' | 'development' | 'direct' | 'transitive';

const DEP_FILTERS: Record<DepFilter, { label: string; test: (f: Finding) => boolean }> = {
  all: { label: 'All', test: () => true },
  production: { label: 'Production', test: (f) => !f.dev },
  development: { label: 'Development', test: (f) => f.dev },
  direct: { label: 'Direct', test: (f) => f.direct },
  transitive: { label: 'Transitive', test: (f) => !f.direct },
};

export function FindingsTable({ findings }: { findings: Finding[] }) {
  const [severity, setSeverity] = useState<Severity | 'all'>('all');
  const [dep, setDep] = useState<DepFilter>('all');
  const [query, setQuery] = useState('');
  const ids = { severity: useId(), dep: useId(), search: useId(), caption: useId() };

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return findings.filter(
      (f) =>
        (severity === 'all' || f.severity === severity) &&
        DEP_FILTERS[dep].test(f) &&
        (q === '' ||
          f.packageName.toLowerCase().includes(q) ||
          f.id.toLowerCase().includes(q) ||
          f.aliases.some((a) => a.toLowerCase().includes(q)) ||
          f.summary.toLowerCase().includes(q)),
    );
  }, [findings, severity, dep, query]);

  return (
    <div className="panel panel-wide">
      <div className="panel-toolbar filters" role="group" aria-label="Filter findings">
        <label htmlFor={ids.search} className="search-chip">
          <span className="visually-hidden">Search findings</span>
          <input
            id={ids.search}
            type="search"
            placeholder="Search package, CVE or text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
            }}
          />
        </label>
        <label htmlFor={ids.severity} className="select-chip">
          <span>Severity</span>
          <select
            id={ids.severity}
            value={severity}
            onChange={(e) => {
              setSeverity(e.target.value as Severity | 'all');
            }}
          >
            <option value="all">All</option>
            {SEVERITY_ORDER.map((s) => (
              <option key={s} value={s}>
                {SEVERITY_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
        <label htmlFor={ids.dep} className="select-chip">
          <span>Dependency</span>
          <select
            id={ids.dep}
            value={dep}
            onChange={(e) => {
              setDep(e.target.value as DepFilter);
            }}
          >
            {Object.entries(DEP_FILTERS).map(([value, { label }]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <p className="toolbar-meta" aria-live="polite">
          {plural(visible.length, 'finding')} of {findings.length.toLocaleString()}
        </p>
      </div>

      <div className="table-wrap" tabIndex={0} aria-labelledby={ids.caption}>
        <table>
          <caption id={ids.caption} className="visually-hidden">
            All findings, highest priority first
          </caption>
          <thead>
            <tr>
              <th scope="col">Severity</th>
              <th scope="col">Package</th>
              <th scope="col">Issue</th>
              <th scope="col">Fixed in</th>
              <th scope="col">Type</th>
              <th scope="col">Advisory</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((f) => (
              <tr key={`${f.packageName}@${f.installedVersion}#${f.id}`}>
                <td>
                  <SeverityPill severity={f.severity} />
                </td>
                <td className="cell-pkg">
                  <span className="pkg-name">{f.packageName}</span>
                  <span className="mono muted">{f.installedVersion}</span>
                </td>
                <td className="cell-issue">{f.summary}</td>
                <td className="mono">{f.fixedVersion ?? <span className="muted">No fix</span>}</td>
                <td className="nowrap muted">
                  {f.dev ? 'Dev' : 'Prod'} · {f.direct ? 'direct' : 'transitive'}
                </td>
                <td>
                  <a
                    href={f.advisoryUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="link-mono"
                  >
                    {f.id}
                    <span className="visually-hidden"> (opens in a new tab)</span>
                  </a>
                </td>
              </tr>
            ))}
            {visible.length === 0 && (
              <tr>
                <td colSpan={6} className="empty-row">
                  No findings match these filters.{' '}
                  <button
                    type="button"
                    className="link-button"
                    onClick={() => {
                      setQuery('');
                      setSeverity('all');
                      setDep('all');
                    }}
                  >
                    Clear filters
                  </button>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
