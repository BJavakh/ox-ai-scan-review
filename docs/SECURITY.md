# Security: threat model and controls

This document covers the security of **this service**, not the vulnerabilities it reports. The service takes an untrusted URL from an anonymous user, reads untrusted content from GitHub, sends some of it to an LLM, and renders the LLM's output in a browser. Each of those is an attack surface.

## 1. Assets and trust boundaries

| Asset                                        | Why it matters                                                                 |
| -------------------------------------------- | ------------------------------------------------------------------------------ |
| `GITHUB_TOKEN`, `ANTHROPIC_API_KEY`          | Billing and rate-limit abuse; a GitHub token may have more scope than intended |
| The server's network position                | SSRF into internal services or cloud metadata                                  |
| Availability (worker slots, outbound quotas) | A few requests could exhaust the GitHub/OSV/LLM budget                         |
| Report integrity                             | A user acting on a wrong "fix" or a fake advisory is a real harm               |

Trust boundaries: browser to API (untrusted input), API to GitHub (untrusted content), API to OSV (semi-trusted data, untrusted free text), API to LLM (untrusted output).

## 2. STRIDE-lite

| Threat                     | Example                                                                        | Control                                                                                       |
| -------------------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| **S**poofing               | A crafted URL makes the server talk to a host that pretends to be GitHub       | Fixed base URLs; the user URL is parsed, never fetched (section 3)                            |
| **T**ampering              | A malicious lockfile tries to inject content into the report or the LLM prompt | Strict parsing, name/version validation, prompt-injection controls (sections 4, 5)            |
| **R**epudiation            | "Who started this scan?"                                                       | Structured logs with request ID, IP and scan ID; no auth in v1, so attribution is per IP only |
| **I**nformation disclosure | Secrets in logs, stack traces in responses, token sent to the browser          | pino redaction, error envelope without stacks, secrets only in server env (sections 7, 8)     |
| **D**enial of service      | Huge lockfile, thousands of scans, open SSE sockets forever                    | Size and count caps, rate limits, bounded queue, timeouts, SSE limits (section 6)             |
| **E**levation of privilege | Repo content executed during scanning (install scripts, `postinstall`)         | We never clone, install or execute anything; we only parse JSON (section 4)                   |

## 3. SSRF

- The only accepted input shape is `https://github.com/{owner}/{repo}` with an optional trailing `/`, `.git`, or `/tree/{ref}`. `www.github.com` is accepted and normalized.
- Parsing uses the WHATWG `URL` parser, then checks: protocol is exactly `https:`, hostname is exactly `github.com` or `www.github.com`, no username/password, no port, path segments match the allowed forms.
- `owner` must match GitHub's rules: 1 to 39 characters, alphanumerics or single hyphens, not starting or ending with a hyphen. `repo` must be 1 to 100 characters of `[A-Za-z0-9._-]` and not `.` or `..`. `ref` must be 1 to 200 characters of `[A-Za-z0-9._/-]` with no `..` segment and no leading `/` or `-`.
- **The user's URL is never fetched.** The server extracts `owner`, `repo` and `ref`, then builds requests against fixed constants `https://api.github.com` and `https://api.osv.dev`. Path components are `encodeURIComponent`-escaped.
- Redirects: GitHub returns 301 for renamed repositories. All outbound requests use `redirect: "manual"`; the HTTP helper follows at most 3 redirects and only when the `Location` stays on the same fixed origin (`https://api.github.com`). Any other redirect is treated as an upstream error. OSV requests do not follow redirects at all.
- The same parser lives in `packages/shared`, so the browser gives instant feedback, but the server re-validates and is authoritative.

## 4. Untrusted repository content

- **No clone, no install, no execution.** We read two files through the GitHub contents API (`package-lock.json`, `package.json`) at a pinned commit SHA. Lifecycle scripts, `.npmrc`, and `preinstall` hooks are irrelevant because nothing runs.
- **Size cap 10 MB**, enforced while streaming the response body: we stop reading and abort the request once the cap is crossed, so a 2 GB file costs at most 10 MB of memory. The `Content-Length` header is checked first when present.
- **JSON parse safety:** `JSON.parse` on a size-capped string, wrapped so any error becomes `MANIFEST_INVALID`. The parsed value is validated with Zod before use. Package entries are read from object keys via `Object.entries` into fresh objects; `__proto__`, `constructor` and `prototype` are rejected as package names, so prototype pollution through crafted keys is not possible.
- **Package count cap** 10,000 unique `name@version` pairs (`TOO_MANY_PACKAGES`).
- **Name and version validation:** names must match npm's naming rules (max 214 chars), versions must be valid semver. Anything else is counted as `skippedPackages` and reported in coverage, not passed downstream.
- **Advisory text** from OSV is also untrusted (anyone can contribute to advisory databases). Summaries are truncated to 300 characters and are only ever rendered as text.
- **Advisory links** are built by us (`https://osv.dev/vulnerability/{id}` with an ID matching `^[A-Za-z0-9._:-]{1,100}$`). We never render reference URLs from advisory data as links.

## 5. Prompt injection and LLM output

The LLM sees data that an attacker can influence: package names in a lockfile they wrote, and advisory summaries.

- **Structured, capped input.** The prompt contains only a JSON object with: repo name, risk level, counts, up to 5 actions (package, versions, counts, severity, flags) and up to 5 top risks (ID, package, version, severity, flags, summary capped at 200 chars). No file contents, no advisory `details`, no reference URLs. Every string field is length-capped.
- **System prompt treats data as data.** It states that the JSON is untrusted, that any instructions inside it must be ignored, that the model must not invent packages, versions or advisory IDs, must not change severities, and must answer only through the provided tool schema.
- **Structured output.** The model is forced to call a single tool whose input schema defines `headline`, `overview` and `riskExplanations[{ findingId, explanation }]`. The tool input is validated with Zod (types and lengths).
- **Grounding check** (`domain/summaryValidation.ts`): the output is rejected if any `findingId` is not one of the top risks, if a top risk is missing, or if any text mentions an advisory ID (`GHSA-*`, `CVE-*`, `MAL-*`, `PYSEC-*`, `OSV-*`) or a `name@version` that is not in the findings.
- **Fallback.** Missing key, network error, timeout (20 s), non-tool response, schema failure or grounding failure all produce the deterministic template summary. The report says `mode: "template"` and why.
- **The LLM cannot affect severity, ranking, actions, commands or the risk level.** Those are computed before the LLM is called and are not read back from it.

## 6. LLM output rendering (XSS)

- React renders every string as text. There is no `dangerouslySetInnerHTML`, no markdown renderer, and no HTML parsing anywhere in the web app (enforced in review; a grep is part of the CI checklist in `CLAUDE.md`).
- Links in the UI are only built from our own `advisoryUrl` (validated `https://osv.dev/...`) and the canonical GitHub URL we constructed. Both open with `rel="noopener noreferrer"`.
- The copy-command button copies text we generated (`npm install pkg@version` with validated name and version), not text from the LLM.

## 7. Abuse and DoS

| Control            | Setting                                                                                                              |
| ------------------ | -------------------------------------------------------------------------------------------------------------------- |
| Global rate limit  | 100 requests / minute / IP (`@fastify/rate-limit`)                                                                   |
| Scan creation      | 10 / minute / IP                                                                                                     |
| Body size          | 16 KB (`bodyLimit`)                                                                                                  |
| Job concurrency    | 2 scans at a time, 25 queued; `503 SERVICE_BUSY` beyond                                                              |
| Per-scan timeout   | 120 s, propagated via `AbortSignal` to every outbound call                                                           |
| Outbound timeouts  | GitHub 10 s, OSV 15 s, LLM 20 s                                                                                      |
| Advisory hydration | 8 concurrent, 500 per scan                                                                                           |
| SSE                | 10 streams per IP, 100 total, 15 s heartbeat, stream closed on terminal state, listener removed on client disconnect |
| Dedupe             | Same repo/ref while running returns the same scan; same SHA within 1 h reuses the result                             |
| Memory             | Store keeps the last 200 scans                                                                                       |

## 8. Secrets

- `GITHUB_TOKEN` and `ANTHROPIC_API_KEY` are read only from environment variables, validated at startup by a Zod schema (`apps/api/src/config/env.ts`). Both are optional; the service works without them.
- They are never logged: pino `redact` covers `req.headers.authorization`, `req.headers.cookie`, `*.token`, `*.apiKey`, `*.GITHUB_TOKEN`, `*.ANTHROPIC_API_KEY`, `headers.authorization` and `headers["x-api-key"]`. The env object itself is never logged.
- They are never sent to the browser. `/api/health` exposes only a boolean `aiSummaries`.
- `.env.example` documents every variable with empty values; `.env` is in `.gitignore`. Fixtures are recorded responses with no credentials.
- Recommendation for real deployments: a fine-grained GitHub token with **public repository read-only** access and no other permissions.

## 9. HTTP hardening

- `@fastify/helmet` with a strict CSP for API responses: `default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`. JSON responses never need to load anything.
- The production web build should be served with `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`. The built app uses no inline scripts or styles, so this works without `unsafe-inline`.
- CORS is restricted to `WEB_ORIGIN` (default `http://localhost:5180`), methods `GET, POST`, no credentials. In development the Vite proxy makes requests same-origin anyway.
- `X-Request-Id` on every response: a client-supplied ID is accepted only if it matches `^[A-Za-z0-9-]{1,64}$` (prevents log injection); otherwise a UUID is generated.
- The server binds to `127.0.0.1` by default (`HOST`).
- `X-Powered-By` is not sent; error responses never include stack traces.

## 10. Supply chain of this project

- `package-lock.json` is committed; CI uses `npm ci`.
- All dependencies are pinned to exact versions (`save-exact=true` in `.npmrc`).
- We chose versions that had been published for at least two weeks at the time of writing, as a simple cooldown against freshly compromised releases.
- `npm audit --audit-level=high` runs in CI.
- Runtime dependencies are kept to what the server needs: Fastify and three official plugins, Zod, semver, and the official Anthropic SDK. Every dependency is justified in `docs/DEPENDENCIES.md`. Retries, concurrency limiting, CVSS scoring and SSE are implemented in-house in a few dozen lines each instead of adding packages.

## 11. Known limitations

- **No authentication.** Anyone who can reach the API can start scans and read any scan by ID (IDs are random UUIDs, which is obscurity, not authorization). Fine for a single-user demo; not for multi-tenant use.
- **In-memory store.** Restart loses all scans; no multi-instance consistency.
- **Public repositories only.** A private repo returns `REPO_NOT_FOUND` (GitHub returns 404 for repos you cannot see).
- **Data sent to the LLM provider:** repo name, package names, versions and advisory summaries. No source code. Customers must accept this or leave the key unset.
- **Rate limiting is per process and per IP**, so it does not survive restarts or work across instances, and is weak behind shared NAT.
- **Report accuracy** depends on the committed lockfile and on OSV's data; we do not check reachability.
