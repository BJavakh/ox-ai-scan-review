import { Band, SectionHead } from '../../components/Layout';

const QUESTIONS: { q: string; a: string }[] = [
  {
    q: 'What can I scan?',
    a: 'Public GitHub repositories with an npm project in the root folder. A package-lock.json gives exact results; with only package.json the result is approximate and the report says so. Private repositories, monorepo subfolders and other ecosystems (Python, Go) are not supported yet.',
  },
  {
    q: 'What do the risk levels mean?',
    a: 'Critical: a critical issue in a production dependency. High: a high issue in production, or a critical one in a development tool. Medium: a moderate or unrated issue in production, or a high one in a development tool. Low: anything else. None: no known advisories for the versions we checked.',
  },
  {
    q: 'How are upgrades ranked?',
    a: 'Each issue gets a score from its severity, whether the package ships to production, whether you use it directly, and whether a fix exists. An upgrade ranks by the most serious issue it fixes; the number of issues breaks ties.',
  },
  {
    q: 'What does the AI do, and what does it not?',
    a: 'It writes the headline, the overview and the plain-language explanations, from the already-ranked results. It never decides severity, ranking or commands, and its text is checked against the findings before it is shown. If it fails the check, a template is used and the report says so.',
  },
  {
    q: 'Is a clean result proof that my project is safe?',
    a: 'No. It means none of the package versions we checked has a published advisory today. The "What we checked" section lists the scope, including what was not covered, such as your own code.',
  },
  {
    q: 'Why does an upgrade say "major version"?',
    a: 'The fixed version is in a higher major version than the one installed, so expect breaking changes. Read the package changelog before upgrading.',
  },
  {
    q: 'How do I use the results?',
    a: 'Start with "Fix first": copy the commands, run them, commit, and scan again. Share the report link or the JSON with your team. Scans are kept in memory on this server until it restarts.',
  },
];

export function Faq() {
  return (
    <Band tone="white" id="faq" labelledBy="faq-title">
      <SectionHead index="05" label="Questions" titleId="faq-title" title="Good to know" />
      <div className="faq">
        {QUESTIONS.map(({ q, a }) => (
          <details key={q} className="faq-item">
            <summary>{q}</summary>
            <p>{a}</p>
          </details>
        ))}
      </div>
    </Band>
  );
}
