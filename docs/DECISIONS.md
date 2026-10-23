# Architecture Decision Records

Short ADRs. Status is "Accepted" unless noted.

### ADR-001: Fastify over Express

Fastify ships a structured logger (pino) with path-based redaction, first-class TypeScript types, encapsulated plugins for helmet/CORS/rate-limit maintained by the core team, and `fastify.inject()` for socket-free integration tests. Express 5 would need morgan/pino-http, supertest and hand-wired error handling to reach the same baseline. Fastify's schema-first style is not used (we validate with Zod in handlers, ADR-007), so we do not pay for its JSON Schema layer.

### ADR-002: OSV.dev over `npm audit` and Snyk

`npm audit` needs a full `npm install`-shaped tree on disk and calls the npm registry's bulk endpoint, which is undocumented for third-party use; it also ties us to npm. Snyk needs an account and token and its data is proprietary. OSV.dev is free, keyless, documented, has a batch endpoint, aggregates the GitHub Advisory Database (which is what `npm audit` uses for npm anyway), covers every ecosystem we would add next, and includes the OpenSSF malicious-packages feed. Cost: `querybatch` returns only IDs, so we hydrate each advisory with a second call (deduped, 8 concurrent, capped at 500).

### ADR-003: SSE with polling fallback over WebSockets

Progress is strictly server-to-client, low frequency (about 10 events per scan) and text. SSE runs over plain HTTP, works through the Vite proxy and most corporate proxies, reconnects automatically in the browser, and needs no library on either side. WebSockets add a bidirectional protocol we do not need. The `GET /api/scans/:id` endpoint stays as a polling fallback because some proxies buffer SSE; the client switches to polling after an SSE error.

### ADR-004: In-memory store behind an interface, Postgres in production

For a 3-hour single-process demo, persistence adds setup cost (Docker, migrations) without changing what reviewers can evaluate. All access goes through `ScanRepository`, so a `PostgresScanRepository` is a drop-in. Production schema and the dedupe index are described in `ARCHITECTURE.md` section 9. The in-memory store caps itself at 200 scans.

### ADR-005: Deterministic prioritization; the LLM only explains

Severity, scores, actions, commands and the risk level must be reproducible, explainable and testable. An LLM deciding "is this critical" would make the same repo produce different answers on different days, and an attacker could influence it through advisory text or package names. So the LLM receives the already-computed result and writes prose; its output is schema-validated and grounding-checked, and the template generator produces the same fields when the LLM is absent or wrong. The report shows which one wrote the summary.

### ADR-006: GitHub REST API instead of cloning

We need two files at one commit. Cloning downloads the whole history, needs disk, a `git` binary and cleanup, and puts attacker-controlled files (hooks, symlinks, huge blobs) on our filesystem. The contents API with `Accept: application/vnd.github.raw` gives exactly the file, size-capped while streaming, at a pinned SHA. Cost: 3 to 5 API calls per scan against the 60/hour unauthenticated limit, so `GITHUB_TOKEN` is recommended.

### ADR-007: Monorepo with shared Zod schemas

`packages/shared` holds the Zod schemas for every request, response, report and SSE event, plus the GitHub URL parser. The API validates its own responses' shape in tests, and the web client parses every response with the same schemas, so contract drift becomes a test failure instead of a runtime `undefined`. npm workspaces keep tooling minimal. `shared` is compiled to `dist/` (`postinstall` and `predev` build it) so Node, Vite and Vitest all consume plain JS plus `.d.ts` with no special resolution conditions.

### ADR-008: TypeScript 6.0 and a two-week dependency cooldown

TypeScript 7.0 (native compiler) was released on the day this project started; `typescript-eslint` supports `<6.1`. We use 6.0.3. More generally, every dependency is the newest version that had been public for at least two weeks, which avoids most "compromised release pulled within days" incidents. Exact pins and the committed lockfile make the result reproducible. Exception: when `npm audit` reports an advisory for a pinned version, the patched version wins even if it is newer than two weeks (this happened with `fastify` 5.12.5 to 5.12.7).

### ADR-009: In-flight dedupe by `owner/repo#ref` at submit time

The brief asks for dedupe on `owner/repo@sha`. The SHA is only known after calling GitHub, and we want `POST /api/scans` to do no outbound I/O (fast, and an anonymous request cannot directly cause outbound traffic beyond the queue's control). So: (1) at submit, a running scan for the same `owner/repo#ref` is returned; (2) after the SHA is resolved, a completed scan for the same `owner/repo@sha` within 1 hour is reused and the new scan completes immediately. Two different refs pointing at the same SHA while both are in flight will both run; that is acceptable.

### ADR-010: Retry OSV `querybatch` although it is a POST

The engineering rule is "retry only idempotent GETs". `POST /v1/querybatch` is a pure read (a query with a body), so retrying it is safe and has the same semantics as retrying a GET. Not retrying it would make one transient OSV 503 fail the entire scan. LLM calls are not retried: they are slow, cost money, and we have a fallback.

### ADR-011: Structured LLM output via `output_config.format` (revised)

First draft: force a single tool call with `tool_choice`. Revised before implementation because forced `tool_choice` (`any`/`tool`) is rejected with HTTP 400 on `claude-sonnet-5-5`. We use structured outputs instead: a JSON schema with `additionalProperties: false`, where `riskExplanations[].findingId` is an `enum` of the actual top-risk IDs, so the model cannot even name an unknown finding. The SDK's built-in retries are disabled and effort is `low` (short, factual prose). The parsed JSON is still validated with Zod and grounding-checked, because a schema-valid answer can still invent a CVE in free text. Server-side refusal fallbacks to another model are not used; the deterministic template is our fallback.

### ADR-012: Supported npm inputs

`package-lock.json` v2 and v3 contain a flat `packages` map with exact versions and `dev` flags, so they give an exact result. Lockfile v1, `yarn.lock` and `pnpm-lock.yaml` are not parsed in v1 of this tool; when present, we fall back to `package.json` and the report says the result is approximate (the lowest version satisfying each range is checked, direct dependencies only). Supporting them is a resolver change only.

### ADR-013: Upgrade commands for transitive dependencies

For a transitive dependency, `npm install pkg@x` would add it as a new direct dependency, which is wrong. We suggest `npm update pkg` (works when the parent's range allows the fixed version) and the rationale names the direct dependencies that pull it in and mentions `overrides` for when the parent pins an older range. We do not try to compute which parent version fixes it; that needs registry metadata and is listed in "What I'd do next".

### ADR-014: Malicious packages are always critical

OSV entries with `MAL-` IDs come from the OpenSSF malicious-packages feed and usually carry no severity. Treating them as `UNKNOWN` would rank an actively malicious package below a moderate ReDoS. We map them to `CRITICAL` with `severitySource: "malicious"`.

### ADR-015: Hash-based navigation in the web app

Three screens (`#/`, `#/scans/:id`) do not justify a router dependency. Hash routing lets a user refresh or share a scan link, and the progress screen switches to the report in place when the scan completes.

### ADR-016: Mock mode is a fixture-serving `fetch`, not separate mock classes

`SCANNER_MODE=mock` keeps the real `HttpGitHubClient` and `OsvVulnerabilitySource` and injects `createFixtureFetch`, which serves recorded GitHub-shaped repos and recorded OSV responses from `apps/api/fixtures` (with a little latency so progress is visible). It also forces the template summary. Tests use the same fetch, so mock mode, tests and production share every line of parsing and error-mapping code. Unknown repos in mock mode fall back to the vulnerable demo repo so any URL produces a demo; in tests they 404. Fixtures are re-recorded from the live API with `npx tsx scripts/record-osv-fixtures.ts`.

### ADR-017: Default ports 8787 (API) and 5180 (web)

The usual 3000/5173 were already in use on the development machine by other projects, and Vite's `strictPort` would otherwise silently fail or another app would answer on the same port. Uncommon defaults avoid both; both are configurable (`PORT`, `WEB_ORIGIN`, `vite.config.ts`).
