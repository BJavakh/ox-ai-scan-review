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

#### Milestone 1: scaffold

- Created npm workspaces (`packages/shared`, `apps/api`, `apps/web`), strict `tsconfig.base.json`, ESLint flat config (`typescript-eslint` strict type-checked, react-hooks, a `no-restricted-syntax` rule banning `dangerouslySetInnerHTML`), Prettier, Vitest per workspace, Zod-validated env with tests, `.env.example`, `.gitignore`, `.nvmrc`, `.npmrc` (`save-exact`).
- **Problem:** `npm install` with the local npm 10.9.2 crashed with `Cannot read properties of null (reading 'edgesOut')`. First guess (workspace version spec `0.1.0` vs `*`) did not fix it. Ran the same install with npm 11 via `npx`, which worked, then confirmed `npm ci` on npm 10 works with the generated lockfile. Documented in `DEPENDENCIES.md`.
- **Problem:** `npm audit` flagged GHSA-389g-gv7q-r4x8 in `fastify` 5.12.5, the version the cooldown rule had picked. Upgraded to 5.12.7 and recorded the exception (ADR-008).
- **Agent mistake:** the first `npm run dev` smoke test collided with two unrelated dev servers already running on the machine (ports 3000 and 5173). The agent's health check got a 200 from the other project's Vite server and only noticed because the HTML title was wrong. Worse, the cleanup command `pkill -f vite` stopped that unrelated Vite server. The agent reported this to the user, switched to killing only the PIDs it started, and moved the defaults to 8787/5180 (ADR-017).
- Typed `vite.config.ts` could not take a `test` key with Vite 8 + Vitest 5 typings; moved web test config to its own `vitest.config.ts`.
- Verified: typecheck, lint, 3 env tests green; `npm run dev` serves the web app on 5180 and proxies `/api/health` to the API on 8787.

#### Milestone 2: shared contract

- Wrote Zod schemas for scans, steps, errors, reports, actions, findings, coverage, API requests/responses, the error envelope and SSE events in `packages/shared`, plus the GitHub URL parser (shared so the browser and server validate identically).
- **Agent mistake caught by its own test:** the first parser test assumed `https://github.com/o/r/tree/../../x/y` would parse as repo `x/y`. It actually normalizes to `/o/x/y` (the WHATWG parser resolves dot segments), which shows the risk: the URL the user typed and the repo we would scan differ. Changed the parser to reject literal and `%2e`-encoded dot segments, and updated `SECURITY.md`.
- Verified: 53 shared tests (URL accept/reject table including SSRF-style inputs such as `169.254.169.254`, `github.com.evil.com`, credentials, ports) plus schema tests.

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
