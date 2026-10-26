import { useEffect, useRef } from 'react';
import { api } from './api/client';
import { DotPill } from './components/Badges';
import { ErrorBoundary } from './components/ErrorBoundary';
import { useAsync } from './hooks/useAsync';
import { useHashRoute } from './hooks/useHashRoute';
import { START_SECTIONS, consumePendingSection, goToStartSection } from './lib/sections';
import { ScanScreen } from './screens/ScanScreen';
import { StartScreen } from './screens/StartScreen';

export function App() {
  const route = useHashRoute();
  const health = useAsync(() => api.health(), 'health');
  const info = health.status === 'ready' ? health.data : null;
  const routeKey = route.name === 'scan' ? route.id : 'start';
  const firstRender = useRef(true);

  // A hash change keeps the old scroll position and focus; reset both like a page load would.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    document.getElementById('main')?.focus({ preventScroll: true });
    const section = consumePendingSection();
    const target = section === null ? null : document.getElementById(section);
    if (target) {
      // After the browser's own hash-navigation scroll, which would cancel a scroll started now.
      setTimeout(() => {
        target.scrollIntoView({ block: 'start', behavior: 'instant' });
      }, 0);
    } else {
      window.scrollTo({ top: 0 });
    }
  }, [routeKey]);

  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="nav">
        <div className="wrap nav-inner">
          <a href="#/" className="brand">
            <span className="brand-mark" aria-hidden="true">
              <span />
            </span>
            Scan Review
          </a>
          <nav className="nav-links" aria-label="Main">
            {START_SECTIONS.map((s) => (
              <a
                key={s.id}
                href="#/"
                onClick={(e) => {
                  e.preventDefault();
                  goToStartSection(s.id);
                }}
              >
                {s.label}
              </a>
            ))}
          </nav>
          <div className="nav-meta">
            {info?.mode === 'mock' && <DotPill tone="moderate">Offline demo</DotPill>}
            {info !== null && (
              <span className="nav-note">AI summaries {info.aiSummaries ? 'on' : 'off'}</span>
            )}
            {health.status === 'error' && <DotPill tone="critical">API unreachable</DotPill>}
            <a href="#/" className="btn btn-small">
              New scan
            </a>
          </div>
        </div>
      </header>
      <main id="main" tabIndex={-1}>
        <ErrorBoundary key={routeKey}>
          {route.name === 'scan' ? (
            <ScanScreen key={route.id} id={route.id} />
          ) : (
            <StartScreen health={info} />
          )}
        </ErrorBoundary>
      </main>
      <footer className="footer">
        <div className="wrap footer-inner">
          <div className="footer-col">
            <span className="brand brand-quiet">Scan Review</span>
            <nav className="footer-links" aria-label="Footer">
              {START_SECTIONS.map((s) => (
                <a
                  key={s.id}
                  href="#/"
                  onClick={(e) => {
                    e.preventDefault();
                    goToStartSection(s.id);
                  }}
                >
                  {s.label}
                </a>
              ))}
            </nav>
          </div>
          <p>
            Dependencies are read at a pinned commit; nothing is cloned or executed. Advisories from{' '}
            <a href="https://osv.dev" target="_blank" rel="noopener noreferrer">
              OSV.dev
            </a>
            . Severity and ranking are deterministic; AI only writes the explanations.
          </p>
        </div>
      </footer>
    </>
  );
}
