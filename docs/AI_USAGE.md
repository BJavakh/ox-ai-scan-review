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
- Correction from the user mid-task: the project location. I had started to plan it under the home directory; the user asked for it on the Desktop, so it first lived in `~/Desktop/ox-ai-scan-review`. It later moved to `~/dev/ox-ai-scan-review` because iCloud Desktop sync kept offloading files (including `node_modules`) and stalling builds.

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

#### Milestone 3: domain core

- Wrote the pure domain layer in `apps/api/src/domain`: state machine with transition guards, CVSS 3.x base-score calculator, severity derivation (malicious, GHSA, CVSS, unknown), fixed-version selection over OSV SEMVER ranges, scoring, grouping into actions, risk level, top-risk selection, the summary input builder (the only data the LLM will see), the template summary, and the grounding validator for LLM output.
- The worked scoring examples in `ARCHITECTURE.md` 5.2 are asserted verbatim in `scoring.test.ts`, so the doc and the formula cannot drift silently.
- **Agent mistake caught by test:** a CVSS rounding test expected `roundUp(4.000001)` to be 4.1. The CVSS 3.1 spec's Roundup deliberately absorbs differences below 1e-5, so 4.0 is correct; the test was wrong, not the code. Fixed the test and added a comment.
- Verified: 90 API tests + 53 shared tests, typecheck and lint green.

#### Milestone 4: integrations

- Wrote `lib/http.ts` (per-attempt timeout via `AbortSignal.timeout`, parent-signal cancellation, bounded exponential backoff with jitter, `Retry-After` up to 5 s, same-origin-only manual redirects, streaming size cap), `HttpGitHubClient`, `NpmDependencyResolver` (lockfile v2/v3 with Node's nested-then-hoisted resolution to compute which direct dependency pulls in each transitive one; npm aliases; `package.json` fallback), `OsvVulnerabilitySource` (querybatch in chunks of 1000, hydration with concurrency 8 and a cap of 500, withdrawn advisories dropped, partial failures become notes), `AnthropicSummaryGenerator` and `SummaryWriter` (template fallback).
- **Agent correction from documentation lookup:** ADR-011 originally said "force a tool call with `tool_choice`". Before writing the LLM client, the agent loaded the Claude API reference and found that forced `tool_choice` returns HTTP 400 on `claude-sonnet-5-5` (the brief's default model). Switched to structured outputs (`output_config.format` with a JSON schema whose `findingId` is an `enum` of the real top-risk IDs) and updated ADR-011. Our own Zod + grounding validation still runs on the result.
- The reference also recommends server-side refusal `fallbacks` for this model. Not used: a refusal here already falls back to the deterministic template, which is the safer fallback for a security report than another model.
- **Fixtures are recorded, not invented:** `scripts/record-osv-fixtures.ts` resolves the fixture repos with the real resolver and records `querybatch` results and every advisory from the live OSV API (19 packages, 61 advisories). The first recording showed `nanoid@5.0.9`, picked for the "clean" demo repo, now has 3 advisories; swapped it for `picocolors@1.1.1` (verified clean) and re-recorded.
- Mock mode and tests use the same live client classes with a fixture-serving `fetch` (`createFixtureFetch`), so status mapping, size caps and parsing are exercised offline.
- Added `REF_NOT_FOUND` (a bad branch in a `/tree/{ref}` URL previously would have said "repository not found").
- Lint caught 9 issues on first run (an untyped stream reader, unused catch binding, a script outside the TS project); fixed.
- Verified: 142 API tests + 53 shared tests, typecheck and lint green.

#### Milestone 5: job runner and API

- Wrote the orchestrator (drives the state machine, persists and emits every change, 120 s deadline via an `AbortController` whose reason is a `SCAN_TIMEOUT` failure, same-commit result reuse), the scan service (atomic dedupe in `createIfNoActive`), in-process queue, per-scan event bus, the Fastify app (helmet CSP, CORS, rate limits, request IDs, redaction, one error handler, 404 handler), SSE with snapshot-then-live ordering, heartbeats and connection limits, and `fastify.inject` integration tests for every failure in the brief, plus a real-socket SSE test.
- **Agent test assumptions corrected by real data:** expected lodash's target to be 4.17.21 (the brief's example); the recorded OSV data says 4.18.0, because two 2026 advisories are only fixed there. The code was right, the expectation was stale; docs updated. Also expected Fastify to reject `text/plain` with 415; it parses it by default, so the parser was removed (JSON only).
- **Live check** against real repos (OWASP/NodeGoat, snyk-labs/nodejs-goof, juice-shop/juice-shop, expressjs/express): all completed in about 15 s total, lockfiles v2 with ~1,000 packages each resolved exactly.
- **Product changes from the live run:** (1) the template headline listed "101 upgrades fix 306 of 317", which does not say what to do; it now leads with the production-critical count and the first upgrade. A bug was fixed on the way: the critical count was taken from the top-5 risks instead of all findings. (2) Added `majorUpgrade` to actions after seeing "tar 2.2.1 to 7.5.21" presented like a patch bump.
- User instruction mid-milestone: stop committing. Milestone 5 and later are uncommitted until the user says otherwise.

#### Milestone 6: frontend

- React app without a router or UI kit: start screen (client-side validation with the shared parser, examples that switch between live and mock repos based on `/api/health`, recent scans), progress screen (SSE with automatic polling fallback, elapsed time, step list, failure panel with retry when the error is retryable), report screen in the order the brief specifies. Every API response is parsed with the shared Zod schemas in the browser. A lint rule forbids `dangerouslySetInnerHTML`.
- **Agent mistake (environment):** asked to "open the folder in this window", the agent ran `code -r`, which replaced the user's open VS Code workspace for another project and closed its terminals. The agent reopened that workspace with `code -n` and recorded a rule to never reuse a window.
- **Tooling problem:** ESLint ran out of memory (4 GB heap). Bisected by linting files one by one: a generic `call<T>(schema: z.ZodType<T>)` made type-aware rules expand Zod 4's deep types. Replaced it with a plain `parse: (body: unknown) => T` callback. `tsc` had no problem with the original.
- **Product bug found in the browser:** with the first action-scoring formula (`max + 0.25 x rest`) the demo report said "1 critical in production. Start by upgrading axios", but axios's worst issue was high; its 25 issues outweighed the critical in minimist. Changed the action score to the worst finding, with issue count as tiebreak (ADR-018), and added a test reproducing the case.
- **Accessibility/responsive checks in a real browser (Claude in Chrome):** at 375 px the report scrolled horizontally. Found by measuring element bounds: visually-hidden "(opens in a new tab)" spans were absolutely positioned outside the table's scroll container. Fixed with `position: relative` on the wrapper; re-measured `scrollWidth === clientWidth`. Checked that every input has a label, every button has a name, and the console is free of errors.
- Template explanations repeated the advisory title shown right above them; removed the duplicate sentence.
- Verified: typecheck, lint, 178 API + 53 shared + 11 web tests, production build.

#### Milestone 6b: visual redesign (user request)

- The user asked for a full redesign after the reference site `doradora.cc`, using the `build-awwwards-quality-sites` and `frontend-design` skills (a third requested skill, "ui/ux pro max", is not installed and was not used). The agent inspected the reference in the browser, measured its type and colour tokens from computed styles (Geist Mono + Inter, `#f8f6f3` / `#1a1916`), and extracted only high-level traits; no assets, copy or code were reused.
- Design decisions are in ADR-019. The skill's GSAP / smooth-scroll / Three.js stack was deliberately not adopted (dependency and attack-surface cost); fonts were added as self-hosted OFL packages, version-pinned with the same two-week cooldown.
- Browser review found and fixed: advisory IDs wrapping onto four lines in a narrow table panel, the same "DE" avatar on every demo example (owner instead of repo name), example pills coloured as if a result were already known, and the nav button wrapping at 375 px. Overflow at 375 px re-measured on the start and report screens (`scrollWidth === clientWidth`).

#### Milestone 6c: UX pass (user request: "improve UX")

- The agent walked the real flow in the browser against a live scan of OWASP/NodeGoat (1,091 packages, 316 findings, 83 upgrades) and listed concrete friction before changing anything. Changes:
  - Action rows no longer repeat the rationale sentence (it restated versions, counts and scope already shown); they show only the advice that adds information (the exact `overrides` entry for transitive dependencies, the major-version warning, no-fix guidance) and a disclosure listing the issues each upgrade fixes, with CVE links.
  - "Copy top commands" in the actions toolbar and "Copy link" in the report hero, for handing the result to a ticket.
  - A compact sticky bar appears after the report hero with the repo, risk level, section links (current section highlighted) and copy link.
  - Findings table search across package, advisory ID, CVE alias and text, with a "Clear filters" action in the empty state.
  - Route changes reset scroll and move focus to the main region; the report scrolls to the top when it replaces the progress view; the tab title shows progress, then repo and risk level.
  - The URL field shows "Will scan owner/repo on the default branch" as soon as the input parses, and the progress panel states the expected duration.
- **Agent bug caught while implementing:** React runs child effects before parent effects, so the scan screen's "reset title" effect overwrote the report's title. Fixed by letting the parent pass `undefined` (leave the title alone).
- Verified in the browser: disclosure, search by CVE (31 of 316), empty state, sticky bar section tracking, title, scroll and focus after navigation (`scrollY === 0`, focus on `main`), no horizontal overflow at 375 px.

#### Milestone 6d: information architecture (user request: "any user can understand what it does, what actions there are, what features we have")

- Start page restructured as a guided story: hero with a plain promise, quick facts (what it scans, how long, what it needs, what it never does) and a "What you can do here" list; 01 What you get (six feature tiles, each with a small example of the real UI, labelled "Example"); 02 How it works (five steps plus "What we never do"); 03 Examples; 04 Recent scans; 05 FAQ.
- Top nav and footer link to Features, How it works, Examples and FAQ from any screen. The report's section index became "Your next steps" (run the top upgrades, read why they matter, check what was not scanned, search findings, scan again after upgrading). A "What do these labels mean?" legend explains severity, production/development, direct/via, major upgrade and the version arrow. The progress screen says the user can leave and find the scan under Recent scans.
- **Agent-caught issues:** (1) an FAQ answer misstated the risk rule (a high issue in a development tool is medium, not low); corrected against `domain/risk.ts`. (2) Nav links from the report to start-page sections landed at the top: the route-change scroll reset and the browser's own hash-navigation scroll both cancelled the section scroll. Fixed with a pending-section handoff consumed by the route effect, deferred one tick, and instant (not smooth) section jumps, which were also unreliable when interrupted. Verified by measuring section offsets after navigation (FAQ and Examples both land at the scroll-padding offset).
- Verified: no horizontal overflow at 375 px on the new start page; typecheck, lint, tests.

### Pre-submission checks

- **Fresh-clone check:** the working tree was copied without `node_modules`/`dist` into a scratch folder and installed with the stock npm 10.9.2 / Node 22.13.1 a reviewer is likely to have: `npm install`, `npm ci`, typecheck, lint, all tests, production build, then the compiled API (`node dist/server.js`) in mock mode ran a scan end to end.
- That check found **GHSA-mrhx-c7xc-m3w5** (zod, high, memory exhaustion on oversized constrained collections), published after the versions were pinned. Relevant here because zod validates untrusted GitHub/OSV JSON (body-size caps run first). Upgraded zod 4.6.5 to 4.6.7; `npm audit` clean again.
- **Agent mistake in its own check:** the first end-to-end script waited for `"status":"completed"` with grep, which also matches a _step's_ status, so it requested the report early and got `409 SCAN_NOT_COMPLETED`. The API was right; the script was fixed to parse JSON.
- **Bugs found while taking README screenshots on live repositories:** (1) "What this upgrade fixes" listed every advisory twice for a package installed at two versions (ejs 0.8.8 and 1.0.0 in snyk-labs/nodejs-goof); the list is now grouped by advisory with the affected versions, and the count is labelled "advisories" so it does not contradict "fixes 10 issues". (2) The progress header showed "Commit: resolving" after the commit was known, because step events do not carry the SHA; the client now re-fetches the scan once the repository step completes. (3) The timeline panel faded in for almost a second, hiding the most important thing on the screen; the entrance animation was removed there.
- CI added (`.github/workflows/ci.yml`): `npm ci`, `npm audit --audit-level=high`, typecheck, lint, format check, tests, build, and a grep guard against `dangerouslySetInnerHTML`; read-only permissions; actions pinned to commit SHAs. The agent first resolved the SHAs with `git ls-remote` and checked that they are commits (not annotated tag objects, which would break a SHA pin) and older than two weeks. All steps were run locally in order before committing.
- Docs drift pass: the mock-mode description, the LLM structured-output description in `SECURITY.md` (still described the abandoned forced tool call), the "CI grep" claim (it is an ESLint rule), dependency versions, the `Action` data model (`majorUpgrade`, score rule), an outdated headline example in `API.md`, and a missing web-client section in `ARCHITECTURE.md`.

### Independent review before submission

Two fresh agents reviewed the whole codebase in parallel, read-only: one adversarial security review against `docs/SECURITY.md`, one correctness review against `docs/ARCHITECTURE.md`. Every finding was reproduced (the security reviewer wrote scratch exploit scripts), fixed, and covered by a regression test. Findings:

| Finding                                                                                                                                                             | Severity | Fix                                                                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Quadratic "who pulls this in" graph walk: a 325 KB crafted lockfile blocked the event loop for 13 s (574 MB) and the scan timeout cannot interrupt synchronous code | High     | Single multi-source walk, at most 3 introducers per package, index pointer instead of `shift()`, hard step budget; test: 4,000-package chain in well under a second |
| Unvalidated dependency names from the lockfile root reached `introducedBy`, the LLM prompt and the UI (prompt-injection carrier)                                    | Medium   | Only valid npm names enter the graph                                                                                                                                |
| LLM grounding check let through shell commands, bare domains, `pkg@latest`, and "safe to ignore" wording                                                            | Medium   | Validator rejects all four; prompt forbids them; UI label no longer implies the prose is fact-checked                                                               |
| Validator rejected valid AI output that ended a sentence with a version ("lodash@4.18.0.")                                                                          | Medium   | Spec parsed separately from trailing punctuation; test                                                                                                              |
| Web client stopped polling forever after one failed request                                                                                                         | Medium   | Retry with exponential backoff (except 404) and a visible "retrying" notice                                                                                         |
| npm workspace dependencies scored as transitive                                                                                                                     | Medium   | Workspace folders are dependency sources; direct = what a source's declared name resolves to                                                                        |
| Backslash bypassed the dot-segment check in the URL parser (scanned repo differs from the link)                                                                     | Low      | Reject `\`, whitespace and control characters; tests                                                                                                                |
| Same advisory could be chosen twice as a top risk (two packages), which made AI output impossible to validate; top risk showed the wrong version                    | Low      | Top risks unique per package and advisory; lookup by advisory and package                                                                                           |
| Duplicate submit got 503 when the queue was full                                                                                                                    | Low      | Capacity checked only when a new scan would be created                                                                                                              |
| SSE disconnect race (latent with the in-memory store)                                                                                                               | Low      | Guards after every await; check for an already-destroyed socket                                                                                                     |
| Direct upgrade hid a nested vulnerable copy                                                                                                                         | Low      | Keep who pulls the nested copy in; overrides hint in rationale and UI                                                                                               |
| `GET /api/scans` deep-cloned full reports                                                                                                                           | Low      | List projection without reports                                                                                                                                     |
| Rate limits keyed on full IPv6 address                                                                                                                              | Low      | Keyed on the /64 prefix (and IPv4-mapped addresses to IPv4)                                                                                                         |

`docs/SECURITY.md` had claimed more than the code did in four places (name validation, dot segments, length caps, parsing cost); those sections were corrected together with the fixes.

### Last round: likely reviewer complaints

After listing what a reviewer would probably criticize, four were fixed:

- **Wrong command for transitive major fixes.** The report suggested `npm update tar` for tar 2.2.1 to 7.5.21 (pulled in by `forever`), but `npm update` never crosses a major version, so the command did nothing. Transitive fixes that need a new major now use `npm pkg set "overrides[tar]=7.5.21" && npm install`, with a warning that parents expecting the old major may break. The agent checked the `npm pkg set` syntax in a scratch project first: dot paths turn `socket.io` into a nested object, so the bracket form is used for every name.
- **Approximate results looked certain.** Without a lockfile the risk badge and headline now say "estimated".
- **One client could use up the shared GitHub quota.** Added a per-client hourly limit on new scans (`SCANS_PER_HOUR`, default 30; duplicates free; IPv6 keyed on the /64).
- **Thin frontend testing.** Added Playwright smoke tests that start their own mock-mode servers on separate ports (scan to report, URL validation, failure explanation), and a CI step for them.

### Final round: performance and error handling (measured, then changed)

- **Performance question ("workers or threads?").** Before changing anything, the agent timed live scans from the API's own step timings: about 11 s for nodejs-goof, of which 8.8 s was advisory hydration and under 60 ms was CPU. It recommended against worker threads (ADR-022) and instead added a cross-scan advisory cache validated by OSV's `modified` timestamp (ADR-020) and doubled hydration parallelism to 16.
- **Live AI check.** With a real API key, a NodeGoat scan produced an AI summary that passed the grounding validator (numbers and package names matched the computed report). That run also measured the LLM step at 7.8 s, which is the next optimization listed in the README.
- **Error-handling audit.** The agent listed five gaps and fixed them with tests: no React error boundary, unmapped framework 4xx errors becoming 500s, the job queue's silent last-resort `catch`, no process-level crash handlers, and a shutdown that left SSE streams and running scans hanging (ADR-021).
- **Environment issue found on the way.** Test failures (`validateBodyLimitOption is not a function`) turned out to be iCloud Desktop sync offloading files, including `node_modules`. The agent diagnosed it from the `dataless` file flag, restored the files, and the project moved to `~/dev`.

## Verification approach

- **Types:** `strict`, `noUncheckedIndexedAccess`, no `any` (lint-enforced).
- **Domain:** pure functions with unit tests (URL parser, state machine, CVSS, severity, fixed-version selection, scoring, grouping, risk, template summary, LLM output validation).
- **Integrations:** live implementations tested with an injected fake `fetch` serving recorded OSV/GitHub fixtures (status mapping, retries, size caps).
- **API:** `fastify.inject` integration tests for the happy path and each failure mode listed in the brief.
- **Manual:** real scans against public repositories, recorded in the log.
