import type { ReactNode } from 'react';
import { DotPill } from '../../components/Badges';
import { Band, SectionHead } from '../../components/Layout';

interface Feature {
  title: string;
  text: string;
  example: ReactNode;
}

const FEATURES: Feature[] = [
  {
    title: 'A clear verdict',
    text: 'One risk level for the whole repository and a one-sentence answer to "what should I do first".',
    example: (
      <div className="mini-verdict">
        <DotPill tone="critical">Critical risk</DotPill>
        <p>
          57 known vulnerabilities, 1 critical in production. Start by upgrading minimist to 1.2.6.
        </p>
      </div>
    ),
  },
  {
    title: 'Upgrades ranked by real risk',
    text: 'Hundreds of advisories become a short list of upgrades, each with the exact command to run.',
    example: (
      <div className="mini-action">
        <div className="mini-row">
          <strong>minimist</strong>
          <span className="mono muted">1.2.5 → 1.2.6</span>
          <DotPill tone="critical">Critical</DotPill>
        </div>
        <code className="mini-cmd">$ npm update minimist</code>
      </div>
    ),
  },
  {
    title: 'Explained in plain words',
    text: 'Why each top risk matters for this project: shipped to production or not, and which dependency pulls it in.',
    example: (
      <p className="mini-text">
        minimist@1.2.5 is a transitive production dependency pulled in by mkdirp. Upgrading to 1.2.6
        or later fixes it.
      </p>
    ),
  },
  {
    title: 'Live progress',
    text: 'Watch each step run, with real timings. If something fails, you get the reason and what to do next.',
    example: (
      <div className="mini-timeline" aria-hidden="true">
        {[
          ['Fetch repository', 0, 28],
          ['Resolve dependencies', 28, 8],
          ['Check advisories', 36, 40],
        ].map(([label, left, width]) => (
          <div key={label} className="mini-tl-row">
            <span>{label}</span>
            <span className="mini-tl-track">
              <span style={{ left: `${String(left)}%`, width: `${String(width)}%` }} />
            </span>
          </div>
        ))}
      </div>
    ),
  },
  {
    title: 'Honest coverage',
    text: 'Exactly what was checked and what was not, so a clean result is never mistaken for "not scanned".',
    example: (
      <dl className="mini-spec">
        <div>
          <dt>Manifest</dt>
          <dd className="mono">package-lock.json · v3</dd>
        </div>
        <div>
          <dt>Packages</dt>
          <dd>812 checked · 34 direct</dd>
        </div>
        <div>
          <dt>Not checked</dt>
          <dd>yarn.lock, first-party code</dd>
        </div>
      </dl>
    ),
  },
  {
    title: 'Supply-chain checks',
    text: 'Risks that are not CVEs, each with its fix: install scripts, git sources, unpinned ranges, end-of-life Node, copyleft licences.',
    example: (
      <div className="mini-verdict">
        <DotPill tone="moderate">Medium</DotPill>
        <p>
          4 packages run scripts when installed.{' '}
          <span className="mono">npm ci --ignore-scripts</span>
        </p>
      </div>
    ),
  },
];

export function Features() {
  return (
    <Band tone="white" id="features" labelledBy="features-title">
      <SectionHead
        index="01"
        label="What you get"
        titleId="features-title"
        title={
          <>
            A security review you can act on
            <br />
            in five minutes
          </>
        }
        lead="Not a raw scanner dump. Every scan gives you the same six things, in the order you need them."
      />
      <ul className="feature-grid">
        {FEATURES.map((f, i) => (
          <li
            key={f.title}
            className="feature reveal-up"
            style={{ animationDelay: `${String(i * 60)}ms` }}
          >
            <div className="feature-example" aria-label={`Example: ${f.title}`}>
              <span className="feature-tag">Example</span>
              {f.example}
            </div>
            <h3 className="feature-title">{f.title}</h3>
            <p className="feature-text">{f.text}</p>
          </li>
        ))}
      </ul>
    </Band>
  );
}
