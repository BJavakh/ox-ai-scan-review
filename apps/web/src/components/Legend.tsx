import { DotPill, SeverityPill } from './Badges';

/** Plain explanations of every label used on action rows and findings. */
export function Legend() {
  return (
    <details className="legend">
      <summary>What do these labels mean?</summary>
      <dl className="legend-grid">
        <div>
          <dt>
            <SeverityPill severity="CRITICAL" /> <SeverityPill severity="HIGH" />{' '}
            <SeverityPill severity="MODERATE" /> <SeverityPill severity="LOW" />
          </dt>
          <dd>
            How serious the worst issue is, from the GitHub Advisory Database or the CVSS score.
            Unknown means the advisory has no rating; review it yourself.
          </dd>
        </div>
        <div>
          <dt>Production · Development</dt>
          <dd>
            Production packages ship with your app. Development packages are only used to build and
            test it, so they rank lower, but can still affect your build and CI.
          </dd>
        </div>
        <div>
          <dt>Direct · via another package</dt>
          <dd>
            Direct means you list it in package.json. "via express" means express pulls it in for
            you; upgrade it with npm update, or an "overrides" entry if express pins an older range.
          </dd>
        </div>
        <div>
          <dt>
            <DotPill tone="neutral">Major upgrade</DotPill>
          </dt>
          <dd>
            The fix is in a newer major version. Expect breaking changes; read the changelog first.
          </dd>
        </div>
        <div>
          <dt>1.2.5 → 1.2.6</dt>
          <dd>
            Installed version, then the lowest version that fixes every issue listed for this
            package.
          </dd>
        </div>
      </dl>
    </details>
  );
}
