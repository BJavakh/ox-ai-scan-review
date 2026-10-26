import type {
  SummaryActionInput,
  SummaryContent,
  SummaryInput,
  SummaryRiskInput,
} from './summary.js';

function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function headline(input: SummaryInput): string {
  const { totals, packagesChecked, riskLevel } = input;
  const estimated = input.accuracy === 'approximate';
  if (totals.findings === 0) {
    return `No known vulnerabilities found in ${plural(packagesChecked, 'npm package')}${estimated ? ' (estimated from package.json)' : ''}.`;
  }
  const risk = `${capitalize(riskLevel)} risk${estimated ? ' (estimated)' : ''}`;
  const vulns = plural(totals.findings, 'known vulnerability', 'known vulnerabilities');
  const highlight =
    totals.criticalInProduction > 0
      ? `, ${String(totals.criticalInProduction)} critical in production`
      : totals.bySeverity.HIGH > 0
        ? `, ${plural(totals.bySeverity.HIGH, 'high-severity issue')}`
        : '';
  const first = input.actions.find((a) => a.targetVersion !== null);
  if (!first) return `${risk}: ${vulns}${highlight}, none with a patched version yet.`;
  return `${risk}: ${vulns}${highlight}. Start by upgrading ${first.package} to ${first.targetVersion ?? ''}.`;
}

function describeAction(action: SummaryActionInput): string {
  const from = action.currentVersions.join(', ');
  const major = action.majorUpgrade ? ', a major version upgrade' : '';
  return `upgrade ${action.package} from ${from} to ${action.targetVersion ?? 'a patched version'} (${plural(action.fixes, 'issue')}, highest ${action.highestSeverity.toLowerCase()}, ${action.relationship} ${action.scope} dependency${major})`;
}

function overview(input: SummaryInput): string {
  const parts: string[] = [
    `We checked ${plural(input.packagesChecked, 'npm package')} from ${input.manifest} at commit ${input.commit}.`,
  ];
  if (input.accuracy === 'approximate') {
    parts.push(
      'No supported lockfile was found, so versions were estimated from package.json ranges and only direct dependencies were checked.',
    );
  }
  if (input.totals.findings === 0) {
    parts.push('None of them has a known vulnerability in OSV.dev at the time of the scan.');
    return parts.join(' ');
  }
  const first = input.actions.find((a) => a.targetVersion !== null);
  if (first) parts.push(`Start here: ${describeAction(first)}.`);
  if (input.totals.actions > 1) {
    parts.push(
      `In total, ${plural(input.totals.actions, 'upgrade')} would fix ${String(input.totals.fixable)} of the ${String(input.totals.findings)} findings; they are listed by priority below.`,
    );
  }
  if (input.totals.devOnlyFindings > 0) {
    parts.push(
      `${plural(input.totals.devOnlyFindings, 'finding')} ${input.totals.devOnlyFindings === 1 ? 'is' : 'are'} in development-only dependencies; they do not ship to production but can still affect your build and CI.`,
    );
  }
  if (input.totals.bySeverity.UNKNOWN > 0) {
    parts.push(
      `${plural(input.totals.bySeverity.UNKNOWN, 'finding')} could not be rated and should be reviewed manually.`,
    );
  }
  return parts.join(' ');
}

export function explainRisk(risk: SummaryRiskInput): string {
  const via =
    risk.relationship === 'transitive' && risk.introducedBy.length > 0
      ? ` pulled in by ${risk.introducedBy.join(', ')}`
      : '';
  const where = `${risk.package}@${risk.version} is a ${risk.relationship} ${risk.scope} dependency${via}.`;
  const severity =
    risk.severitySource === 'malicious'
      ? 'This version is listed as a malicious package: treat any system that installed it as potentially compromised.'
      : risk.severity === 'UNKNOWN'
        ? 'The severity is not rated in the advisory data, so review it manually.'
        : `It is rated ${risk.severity.toLowerCase()} severity.`;
  const fix =
    risk.fixedVersion === null
      ? 'No patched version is available yet; consider replacing the package or limiting how untrusted input reaches it.'
      : `Upgrading to ${risk.fixedVersion} or later fixes it.`;
  // The advisory title is shown next to the explanation, so it is not repeated here.
  return [where, severity, fix].join(' ');
}

/** Deterministic summary used when no LLM is configured or the LLM output is rejected. */
export function generateTemplateSummary(input: SummaryInput): SummaryContent {
  return {
    headline: headline(input),
    overview: overview(input),
    riskExplanations: input.topRisks.map((risk) => ({
      findingId: risk.findingId,
      explanation: explainRisk(risk),
    })),
  };
}
