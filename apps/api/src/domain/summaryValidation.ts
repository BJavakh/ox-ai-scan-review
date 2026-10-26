import { type SummaryContent, type SummaryInput, summaryContentSchema } from './summary.js';

export type SummaryValidationResult =
  { ok: true; value: SummaryContent } | { ok: false; reason: string };

const ADVISORY_ID =
  /\b(?:GHSA(?:-[0-9a-z]{4}){3}|CVE-\d{4}-\d{4,}|MAL-\d{4}-\d+|PYSEC-\d{4}-\d+|OSV-\d{4}-\d+)\b/gi;
/** `name@spec`; the spec is checked separately so trailing punctuation never becomes part of it. */
const PACKAGE_SPEC = /(?<![\w@/.-])(@?[a-z0-9][\w.-]*(?:\/[\w.-]+)?)@([^\s,;:)\]'"`]+)/gi;
const EXACT_VERSION = /^v?\d+\.\d+\.\d+(?:-[0-9a-z.-]*[0-9a-z])?(?:\+[0-9a-z.-]*[0-9a-z])?$/i;
const URL_LIKE = /\b(?:https?:\/\/|www\.)/i;
/** Commands come only from deterministic data; prose must never contain one. */
const SHELL_COMMAND =
  /\b(?:curl|wget|bash|powershell|iex|chmod|sudo|eval)\b|\|\s*(?:sh|bash)\b|\b(?:npm|npx|yarn|pnpm)\s+(?:i|install|add|exec|run|update|uninstall)\b/i;
const DOMAIN_LIKE =
  /\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|net|org|io|dev|sh|xyz|ru|cn|app|co|me|info|biz|link|site|top|cc)\b/gi;
/** Severity is decided by data; prose must not argue an issue away. */
const DISMISSIVE =
  /\b(?:safe to ignore|can (?:safely )?be ignored|false positives?|not (?:actually )?exploitable|no action (?:is )?(?:needed|required)|not a real (?:issue|risk))\b/i;

function knownFacts(input: SummaryInput) {
  const ids = new Set<string>();
  const packages = new Set<string>();
  const versions = new Map<string, Set<string>>();
  const addVersion = (name: string, version: string | null) => {
    if (version === null) return;
    packages.add(name.toLowerCase());
    const set = versions.get(name.toLowerCase()) ?? new Set<string>();
    set.add(version.toLowerCase());
    versions.set(name.toLowerCase(), set);
  };
  for (const risk of input.topRisks) {
    ids.add(risk.findingId.toUpperCase());
    for (const alias of risk.aliases) ids.add(alias.toUpperCase());
    addVersion(risk.package, risk.version);
    addVersion(risk.package, risk.fixedVersion);
  }
  for (const action of input.actions) {
    for (const v of action.currentVersions) addVersion(action.package, v);
    addVersion(action.package, action.targetVersion);
  }
  return { ids, versions, packages };
}

/**
 * Accept LLM output only if it is schema-valid AND grounded in the input:
 * exactly one explanation per top risk, no advisory IDs or package@version
 * strings we did not provide, and no links. See docs/SECURITY.md section 5.
 */
export function validateSummary(raw: unknown, input: SummaryInput): SummaryValidationResult {
  const parsed = summaryContentSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, reason: 'output did not match the schema' };
  const content = parsed.data;

  const expected = input.topRisks.map((r) => r.findingId);
  const got = content.riskExplanations.map((r) => r.findingId);
  if (got.length !== expected.length || new Set(got).size !== got.length) {
    return { ok: false, reason: 'explanations do not match the top risks one-to-one' };
  }
  if (!got.every((id) => expected.includes(id))) {
    return { ok: false, reason: 'explanation references an unknown finding' };
  }

  const { ids, versions, packages } = knownFacts(input);
  const texts = [
    content.headline,
    content.overview,
    ...content.riskExplanations.map((r) => r.explanation),
  ];
  for (const text of texts) {
    if (URL_LIKE.test(text)) return { ok: false, reason: 'output contains a link' };
    for (const match of text.matchAll(ADVISORY_ID)) {
      if (!ids.has(match[0].toUpperCase())) {
        return { ok: false, reason: `output mentions unknown advisory ${match[0]}` };
      }
    }
    if (SHELL_COMMAND.test(text)) return { ok: false, reason: 'output contains a shell command' };
    if (DISMISSIVE.test(text)) return { ok: false, reason: 'output dismisses a finding' };
    for (const match of text.matchAll(DOMAIN_LIKE)) {
      if (!packages.has(match[0].toLowerCase())) {
        return { ok: false, reason: `output mentions a domain ${match[0]}` };
      }
    }
    for (const match of text.matchAll(PACKAGE_SPEC)) {
      const name = (match[1] ?? '').toLowerCase();
      const spec = (match[2] ?? '').replace(/[.!?]+$/, '').toLowerCase();
      if (!EXACT_VERSION.test(spec) || !versions.get(name)?.has(spec.replace(/^v/, ''))) {
        return { ok: false, reason: `output mentions unknown package version ${match[0]}` };
      }
    }
  }

  // Keep explanations in the deterministic top-risk order.
  const order = new Map(expected.map((id, index) => [id, index]));
  content.riskExplanations.sort(
    (a, b) => (order.get(a.findingId) ?? 0) - (order.get(b.findingId) ?? 0),
  );
  return { ok: true, value: content };
}
