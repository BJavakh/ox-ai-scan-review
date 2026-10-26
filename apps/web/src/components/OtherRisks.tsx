import type { OtherRisk, OtherRiskLevel, Report } from '@ox-scan/shared';
import { DotPill } from './Badges';
import { CopyButton } from './CopyButton';
import { Band, Panel, SectionHead } from './Layout';

const LEVEL: Record<OtherRiskLevel, { tone: 'high' | 'moderate' | 'low'; label: string }> = {
  high: { tone: 'high', label: 'High' },
  medium: { tone: 'moderate', label: 'Medium' },
  low: { tone: 'low', label: 'Low' },
};

function RiskItem({ risk }: { risk: OtherRisk }) {
  const more = risk.totalPackages - risk.packages.length;
  return (
    <li className="risk">
      <div className="risk-top">
        <DotPill tone={LEVEL[risk.level].tone}>{LEVEL[risk.level].label}</DotPill>
      </div>
      <h3 className="risk-title">{risk.title}</h3>
      <p className="risk-text">{risk.why}</p>
      {risk.packages.length > 0 && (
        <ul className="other-packages" aria-label="Affected packages">
          {risk.packages.map((name) => (
            <li key={name} className="mono">
              {name}
            </li>
          ))}
          {more > 0 && <li className="other-more">and {String(more)} more</li>}
        </ul>
      )}
      <p className="risk-text">
        <strong>Fix:</strong> {risk.fix}
      </p>
      {risk.command !== null && (
        <div className="command">
          <code>{risk.command}</code>
          <CopyButton text={risk.command} label={`Copy command: ${risk.title}`} />
        </div>
      )}
    </li>
  );
}

/** Supply-chain and hygiene risks from the manifests, kept apart from vulnerability findings. */
export function OtherRisks({
  report,
  index,
  tone,
}: {
  report: Report;
  index: string;
  tone: 'paper' | 'white';
}) {
  const lockfile = report.coverage.manifest === 'package-lock.json';
  return (
    <Band tone={tone} id="other-risks" labelledBy="other-risks-title">
      <SectionHead
        index={index}
        label="Other risks"
        titleId="other-risks-title"
        title="Supply chain and hygiene"
        lead={
          lockfile
            ? 'Not vulnerabilities, but ways a dependency setup gets attacked or breaks. Found by fixed rules in your manifests, each with its fix.'
            : 'Found by fixed rules in package.json. Install scripts, licences and duplicate versions need a lockfile, so they were not checked.'
        }
      />
      <Panel>
        <ol className="risk-list">
          {report.otherRisks.map((risk) => (
            <RiskItem key={risk.kind} risk={risk} />
          ))}
        </ol>
      </Panel>
    </Band>
  );
}
