/**
 * CVSS v3.0 / v3.1 base score calculator (FIRST specification, section 7).
 * Returns null for anything that is not a complete, valid v3 base vector.
 */

const WEIGHTS = {
  AV: { N: 0.85, A: 0.62, L: 0.55, P: 0.2 },
  AC: { L: 0.77, H: 0.44 },
  UI: { N: 0.85, R: 0.62 },
  C: { H: 0.56, L: 0.22, N: 0 },
  I: { H: 0.56, L: 0.22, N: 0 },
  A: { H: 0.56, L: 0.22, N: 0 },
} as const;

const PR_UNCHANGED = { N: 0.85, L: 0.62, H: 0.27 } as const;
const PR_CHANGED = { N: 0.85, L: 0.68, H: 0.5 } as const;

const VECTOR_PATTERN =
  /^CVSS:3\.[01]\/AV:([NALP])\/AC:([LH])\/PR:([NLH])\/UI:([NR])\/S:([UC])\/C:([HLN])\/I:([HLN])\/A:([HLN])(?:\/.*)?$/;

/** CVSS 3.1 "Roundup": smallest number with one decimal >= input, float-safe. */
export function roundUp(value: number): number {
  const scaled = Math.round(value * 100_000);
  if (scaled % 10_000 === 0) return scaled / 100_000;
  return (Math.floor(scaled / 10_000) + 1) / 10;
}

function weight(table: Readonly<Record<string, number>>, key: string | undefined): number | null {
  if (key === undefined || !Object.hasOwn(table, key)) return null;
  return table[key] ?? null;
}

export function cvss3BaseScore(vector: string): number | null {
  const match = VECTOR_PATTERN.exec(vector.trim());
  if (!match) return null;
  const [, av, ac, pr, ui, scope, c, i, a] = match;
  const scopeChanged = scope === 'C';

  const w = {
    av: weight(WEIGHTS.AV, av),
    ac: weight(WEIGHTS.AC, ac),
    pr: weight(scopeChanged ? PR_CHANGED : PR_UNCHANGED, pr),
    ui: weight(WEIGHTS.UI, ui),
    c: weight(WEIGHTS.C, c),
    i: weight(WEIGHTS.I, i),
    a: weight(WEIGHTS.A, a),
  };
  if (Object.values(w).some((value) => value === null)) return null;
  const n = w as Record<keyof typeof w, number>;

  const iss = 1 - (1 - n.c) * (1 - n.i) * (1 - n.a);
  const impact = scopeChanged ? 7.52 * (iss - 0.029) - 3.25 * (iss - 0.02) ** 15 : 6.42 * iss;
  const exploitability = 8.22 * n.av * n.ac * n.pr * n.ui;

  if (impact <= 0) return 0;
  const raw = scopeChanged
    ? Math.min(1.08 * (impact + exploitability), 10)
    : Math.min(impact + exploitability, 10);
  return roundUp(raw);
}
