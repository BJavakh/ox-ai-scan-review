# CLAUDE.md: conventions for agent sessions

AI Scan Review: submit a public GitHub repo, scan its npm dependencies against OSV.dev, get prioritized upgrade actions with an AI (or template) summary. Read `docs/ARCHITECTURE.md` before changing behaviour; keep `docs/` in sync with code.

## Commands

```bash
npm install                 # also builds packages/shared (postinstall)
npm run dev                 # shared watcher + API on :3000 + web on :5173
SCANNER_MODE=mock npm run dev   # fully offline demo with fixtures
npm run typecheck           # all workspaces
npm run lint                # eslint, type-aware
npm test                    # vitest in every workspace
npm run format              # prettier --write
npm run build               # shared, api (tsc), web (vite)
```

Run `npm run typecheck && npm run lint && npm test` before every commit. Never commit a red build.

## Layout

```
packages/shared/src     Zod schemas = API contract (+ GitHub URL parser). Change here first.
apps/api/src
  config/               env.ts (Zod-validated env)
  domain/               PURE logic: no I/O, no Fastify, no fetch. Unit tested.
  integrations/         github/, npm/, osv/, llm/  each: interface + live + mock
  lib/                  http (fetch w/ timeout, retry, size cap), concurrency
  scans/                repository, job queue, events, orchestrator, service
  http/                 app.ts, routes, SSE, error handler
  container.ts          wires implementations based on SCANNER_MODE
apps/api/fixtures       recorded GitHub/OSV responses (no secrets)
apps/web/src            React app: screens/, components/, api/, hooks/
docs/                   BRD, ARCHITECTURE, API, SECURITY, DEPENDENCIES, DECISIONS, AI_USAGE
```

## Hard rules

- **Never execute, install or clone repository code.** Only read manifests via the GitHub API and parse them as data.
- **Never fetch a user-supplied URL.** Parse it with `parseGitHubRepoUrl`, then call fixed base URLs only.
- **The LLM never decides** severity, ranking, actions or the risk level. It only writes prose, validated by `validateSummary`.
- **No `dangerouslySetInnerHTML`, no markdown rendering** in the web app. LLM and advisory text are plain text.
- **No secrets** in code, logs, fixtures, tests or commits. Env only, via `config/env.ts`.
- **No em-dash or en-dash characters** anywhere. Use `-`.

## Code style

- TypeScript strict, `noUncheckedIndexedAccess`, ESM with `.js` import suffixes in api/shared.
- No `any`. Take `unknown` and narrow it, usually with a Zod schema.
- Validate every boundary with Zod: env, request body/params, GitHub/OSV/LLM responses.
- Small functions; domain functions take plain data and return plain data.
- Exact dependency versions; justify any new dependency in `docs/DEPENDENCIES.md`.
- Prettier formatting (100 cols, single quotes, trailing commas).

## Error handling pattern

- Integrations throw `ScanFailure(code)` for known conditions (`domain/errors.ts` maps each code to a human message and a `retryable` flag).
- The orchestrator catches everything: `ScanFailure` becomes `scan.error`; anything else is logged with its stack and becomes `INTERNAL_ERROR`.
- Route handlers throw `AppError(status, code, message, details?)`. One error handler renders `{ error: { code, message, details? } }`. Never return stacks or upstream messages.
- Partial failures (an advisory that will not load, an LLM error) degrade the report and add a `notes[]` entry or fall back; they do not fail the scan.
- Every outbound call: `AbortSignal` timeout, bounded retries only for read-only requests, typed error.

## Testing rules

- Domain: thorough unit tests, including edge cases (unknown severity, no fix, multiple installed versions, dev vs prod).
- Integrations: use the live class with an injected fake `fetch` serving `fixtures/`; no real network in tests.
- API: `buildApp()` + `app.inject()`; cover happy path and every failure mode.
- Tests must be deterministic and offline. Do not chase coverage on glue code.

## Adding an ecosystem

Implement `DependencyResolver` in `integrations/<ecosystem>/`, register it in `container.ts`, add its manifest names to the detection list, add fixtures and tests, update `docs/`.
