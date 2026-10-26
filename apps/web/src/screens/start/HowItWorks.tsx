import { Band, SectionHead } from '../../components/Layout';

const STEPS = [
  {
    title: 'Fetch the commit',
    text: 'We resolve the branch to an exact commit and read package-lock.json or package.json through the GitHub API.',
  },
  {
    title: 'Resolve dependencies',
    text: 'Every installed package and version, marked direct or transitive, production or development.',
  },
  {
    title: 'Check advisories',
    text: 'Each package version is looked up in OSV.dev, which includes the GitHub Advisory Database and known malicious packages.',
  },
  {
    title: 'Rank by real risk',
    text: 'Severity, production use, direct use and whether a fix exists decide the order. The rules are fixed and documented.',
  },
  {
    title: 'Explain in plain words',
    text: 'AI writes the summary from the ranked results only, and is checked against them. Without AI, a template writes it.',
  },
];

const NEVER = [
  'Clone the repository or download its code',
  'Install packages or run any scripts',
  'Send source code to the AI (only package names, versions and advisory titles)',
  'Let AI decide severity or ranking',
];

export function HowItWorks() {
  return (
    <Band tone="paper" id="how-it-works" labelledBy="how-title">
      <SectionHead
        index="02"
        label="How it works"
        titleId="how-title"
        title="Five steps, about twenty seconds"
        lead="The same pipeline you will see running live after you start a scan."
      />
      <div className="how-grid">
        <ol className="how-steps">
          {STEPS.map((step, i) => (
            <li key={step.title}>
              <span className="index-n">{String(i + 1).padStart(2, '0')}</span>
              <div>
                <h3>{step.title}</h3>
                <p>{step.text}</p>
              </div>
            </li>
          ))}
        </ol>
        <aside className="never" aria-labelledby="never-title">
          <p id="never-title" className="micro">
            What we never do
          </p>
          <ul>
            {NEVER.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </aside>
      </div>
    </Band>
  );
}
