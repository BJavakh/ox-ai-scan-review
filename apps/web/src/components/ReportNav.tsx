import { useEffect, useState } from 'react';
import type { Report } from '@ox-scan/shared';
import { RiskPill } from './Badges';
import { CopyButton } from './CopyButton';

export interface ReportSection {
  id: string;
  label: string;
}

export function scrollToSection(id: string): void {
  document.getElementById(id)?.scrollIntoView({ behavior: 'instant', block: 'start' });
}

/**
 * Compact bar that appears once the report hero scrolls away, so the risk
 * level and the section index stay in reach on long reports.
 */
export function ReportNav({ report, sections }: { report: Report; sections: ReportSection[] }) {
  const [visible, setVisible] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  const sectionKey = sections.map((s) => s.id).join(',');

  useEffect(() => {
    const hero = document.getElementById('report-hero');
    const heroObserver = new IntersectionObserver(
      ([entry]) => {
        setVisible(entry !== undefined && !entry.isIntersecting);
      },
      { rootMargin: '-64px 0px 0px 0px' },
    );
    if (hero) heroObserver.observe(hero);

    const sectionObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) if (entry.isIntersecting) setActive(entry.target.id);
      },
      { rootMargin: '-40% 0px -55% 0px' },
    );
    for (const id of sectionKey.split(',')) {
      const el = document.getElementById(id);
      if (el) sectionObserver.observe(el);
    }
    return () => {
      heroObserver.disconnect();
      sectionObserver.disconnect();
    };
  }, [sectionKey]);

  return (
    <nav
      className={`report-nav ${visible ? 'is-visible' : ''}`}
      aria-label="Report sections"
      inert={!visible}
    >
      <div className="wrap report-nav-inner">
        <span className="report-nav-repo mono">
          {report.repo.owner}/{report.repo.name}
        </span>
        <RiskPill level={report.riskLevel} estimated={report.coverage.accuracy === 'approximate'} />
        <ol className="report-nav-links">
          {sections.map((s, i) => (
            <li key={s.id}>
              <a
                href={`#${s.id}`}
                aria-current={active === s.id ? 'true' : undefined}
                onClick={(e) => {
                  e.preventDefault();
                  scrollToSection(s.id);
                }}
              >
                <span className="index-n">{String(i + 1).padStart(2, '0')}</span> {s.label}
              </a>
            </li>
          ))}
        </ol>
        <CopyButton
          text={() => window.location.href}
          label="Copy a link to this report"
          idleText="Copy link"
        />
      </div>
    </nav>
  );
}
