# How coding agents were used

This project was built with Claude Code (model: Claude Opus 5.5) working from a single detailed brief that I wrote (the brief fixed the product direction, stack, phases and engineering rules). This file is a factual log kept by the agent while it worked, plus a section reserved for my own review notes.

## Workflow

1. **Brief first.** I wrote a long prompt that fixed the product decisions (real OSV scan, actions over findings, deterministic scoring, LLM only explains, template fallback, mock mode) so the agent would not re-decide them.
2. **Phase 1: documentation before code.** The agent wrote `BRD.md`, `ARCHITECTURE.md`, `API.md`, `SECURITY.md`, `DEPENDENCIES.md`, `DECISIONS.md`, this file and `CLAUDE.md` before any application code, so the implementation had a spec to be checked against.
3. **Phase 2: milestones with a green build gate.** After each milestone the agent ran `npm run typecheck`, `npm run lint`, `npm test`, fixed failures, and committed.
4. **Final drift check.** The agent re-read the docs against the code at the end.

## Agent log

Entries are appended as work happens.

### Phase 1: documentation

- Checked the local toolchain (Node 22.13.1, npm 10.9.2) and queried the npm registry for current versions and publish dates. Picked, for every dependency, the newest release older than two weeks (ADR-008). Noticed TypeScript 7.0.2 was published that same day and that `typescript-eslint` only supports TS `<6.1`, so pinned TS 6.0.3.
- Called the live OSV API (`/v1/vulns/GHSA-p6mc-m468-83gw` and `/v1/querybatch` for `lodash@4.17.15`) to confirm the response shapes before documenting them. Confirmed: `querybatch` returns only `{id, modified}` per vuln and an empty object `{}` for a package with no vulns; `lodash@4.17.15` has 6 advisories, which matches the example in the brief.
- Wrote all Phase 1 docs. Decisions the brief did not cover were recorded as ADRs: dedupe key at submit time (ADR-009, a deliberate deviation from "dedupe by SHA" with the reason), retrying the read-only `querybatch` POST (ADR-010, a deliberate deviation from "retry GETs only"), forced tool call for structured output (ADR-011), `MAL-` advisories as critical (ADR-014).
- Correction from the user mid-task: the project location. I had started to plan it under the home directory; the user asked for it on the Desktop, so it lives in `~/Desktop/ox-ai-scan-review`.

### Phase 2: implementation

(appended per milestone below)

## Verification approach

- **Types:** `strict`, `noUncheckedIndexedAccess`, no `any` (lint-enforced).
- **Domain:** pure functions with unit tests (URL parser, state machine, CVSS, severity, fixed-version selection, scoring, grouping, risk, template summary, LLM output validation).
- **Integrations:** live implementations tested with an injected fake `fetch` serving recorded OSV/GitHub fixtures (status mapping, retries, size caps).
- **API:** `fastify.inject` integration tests for the happy path and each failure mode listed in the brief.
- **Manual:** real scans against public repositories, recorded in the log.

---

## Human review notes - to be written by Beso

### Decisions I made myself

_To be written._

### Agent mistakes I caught

_To be written._

### What I'd do differently

_To be written._
