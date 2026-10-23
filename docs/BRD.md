# Business Requirements Document: AI Scan Review Experience

## 1. Problem statement

The customer request, verbatim:

> "I want to connect one of my GitHub repositories and get an AI-assisted code or dependencies security review. I don't want a raw scanner report. I want to understand what matters, what is risky, and what I should do next. It should feel like a product experience, not just an API."

### Interpretation

The customer does not lack data. Every dependency scanner already prints hundreds of advisories. What they lack is **a decision**: which few things should I do this week, and why. So the product is judged on how fast a repo owner goes from "here is my repo URL" to "I know the 1 to 3 upgrades that remove most of my risk".

Concretely, we interpret the request as:

| Phrase in the request                   | What we build                                                                                                                                             |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "connect one of my GitHub repositories" | Paste a public `https://github.com/{owner}/{repo}` URL. No OAuth in this version.                                                                         |
| "code or dependencies security review"  | **Dependencies** (npm). Code scanning (SAST) is out of scope for v1; see section 5.                                                                       |
| "AI-assisted"                           | The AI writes the plain-language summary and explains each top risk. It never decides severity or invents findings.                                       |
| "I don't want a raw scanner report"     | The report leads with **actions** (upgrades), grouped and ranked, not with a list of CVEs.                                                                |
| "what matters, what is risky"           | A deterministic risk level and a short "top risks" list, with production vs development and direct vs transitive context.                                 |
| "what I should do next"                 | Each action has a target version and a copyable command.                                                                                                  |
| "a product experience, not just an API" | A web UI with live progress, failure states that explain themselves, and an honest coverage section. The API is still a first-class, documented contract. |

## 2. Personas

**P1: Dana, tech lead and repo owner.** Owns a Node.js service. Gets Dependabot noise she has learned to ignore. Wants to know whether anything in her dependency tree is actually dangerous for production and what single command fixes it. Has 10 minutes, not an afternoon.

**P2: Omer, security-minded engineering manager.** Responsible for several teams' repos. Does not run the upgrades himself. Wants a defensible, consistent risk level per repo, wants to know what was and was not checked (so a "low risk" result is not a false comfort), and wants a link he can paste into a ticket.

## 3. User stories and acceptance criteria

### US-1: Submit a repository (capability 1)

As Dana, I want to paste my GitHub repository URL so that I can review it without installing anything.

- Accepts `https://github.com/{owner}/{repo}`, with an optional trailing `/`, `.git` suffix, or `/tree/{ref}`.
- Rejects anything else (other hosts, `http://`, credentials in the URL, `blob/` paths, invalid owner/repo names) **before** a scan is created, with a message that says what format is expected.
- Validation runs in the browser for instant feedback and again on the server (the server is authoritative).
- Example repositories are one click away so a first-time user can see a result without having a vulnerable repo at hand.

### US-2: Start a scan (capability 2)

As Dana, I want one click to start the scan and to land on a progress page immediately.

- `POST /api/scans` returns within 100 ms (no outbound calls on the request path) with a scan ID.
- Submitting the same repo and ref while a scan is still running returns the existing scan instead of starting a second one.
- If the service is at capacity, the user is told to retry shortly (HTTP 503), not left with a scan that never starts.

### US-3: Follow progress (capability 3)

As Dana, I want to see what the scan is doing so that I trust it and know it has not hung.

- The progress page shows six named steps (fetch repository, resolve dependencies, check vulnerabilities, prioritize, write summary, done) with live status, per-step detail (for example "812 packages, 34 direct") and elapsed time.
- Updates arrive by Server-Sent Events; if the stream drops, the page falls back to polling without user action.
- A scan never runs forever: it fails with `SCAN_TIMEOUT` after 120 seconds.
- On failure, the page shows a human explanation (for example "GitHub's unauthenticated rate limit was hit, try again in a few minutes or set GITHUB_TOKEN") and a retry button when the error is retryable.

### US-4: See a useful result (capability 4)

As Dana, I want a result page that I can read top to bottom in under a minute.

- Order: risk level and headline, "Fix first" actions, top risks explained, coverage, full findings table.
- Each action shows package, current to fixed version, number of issues fixed, highest severity, whether it is a production or dev dependency, direct or transitive (and which direct dependency pulls it in), and a copyable command.
- The full findings table can be filtered by severity and by dependency type and links each finding to its advisory.
- The same data is available as JSON from `GET /api/scans/:id/report`.

### US-5: Understand risk and next actions (capability 5)

As Omer, I want a risk level I can defend and know what was checked.

- The risk level (`critical`, `high`, `medium`, `low`, `none`) is computed from a documented rule, never by the LLM.
- The report states the commit SHA, which manifest was used, whether versions are exact (lockfile) or approximate (`package.json` ranges), how many packages were checked, and which ecosystems were detected but not scanned.
- The report states whether the summary was written by the AI or by the template, and why the template was used if so.
- A clean result says "No known vulnerabilities" **and** shows what was checked, so "none" is not mistaken for "not scanned".

## 4. In scope

- Public GitHub repositories, root-level npm manifests: `package-lock.json` (v2/v3) preferred, `package.json` fallback.
- Vulnerability data from OSV.dev.
- Deterministic prioritization, grouping into upgrade actions, risk level.
- AI summary via the Anthropic API with a template fallback.
- Web UI (start, progress, report) and a documented REST + SSE API.
- Offline mock mode (`SCANNER_MODE=mock`) for demos and tests.

## 5. Out of scope (explicit non-goals)

| Non-goal                                        | Why it is out                                               | Where it is tracked            |
| ----------------------------------------------- | ----------------------------------------------------------- | ------------------------------ |
| User accounts and authentication                | Single-user demo; adds no insight to the core flow          | README "What I'd do next"      |
| Private repositories via OAuth / GitHub App     | Requires app registration, token storage and per-user authz | README "What I'd do next"      |
| SAST (scanning first-party code)                | Different engine (Semgrep); would double the scope          | README "What I'd do next"      |
| Ecosystems other than npm                       | Resolver interface exists; parsers are not implemented      | `DependencyResolver` interface |
| Monorepo / nested manifests                     | Root only; stated in the coverage section                   | README "Known limitations"     |
| Yarn and pnpm lockfiles, npm lockfile v1        | Fall back to `package.json` with an accuracy warning        | Coverage notes                 |
| Persistence across restarts                     | In-memory store behind `ScanRepository`                     | `docs/DECISIONS.md`            |
| Reachability analysis, EPSS/KEV exploit signals | Valuable, but each is its own project                       | README "What I'd do next"      |
| Opening PRs or applying fixes automatically     | Write access to customer repos is a big trust step          | README "What I'd do next"      |

## 6. Functional requirements

| ID    | Requirement                                                                                                                                                            |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FR-1  | Parse and validate a GitHub repository URL (shared code, used by browser and server).                                                                                  |
| FR-2  | Create a scan, return its ID, enqueue it on a bounded job queue.                                                                                                       |
| FR-3  | Deduplicate: a non-terminal scan for the same `owner/repo` and ref returns the existing scan ID. A completed result for the same commit SHA (within 1 hour) is reused. |
| FR-4  | Resolve the ref (default branch if none given) to a commit SHA, then read every file at that SHA.                                                                      |
| FR-5  | Detect supported and unsupported manifests in the repository root.                                                                                                     |
| FR-6  | Resolve npm dependencies with name, version, direct/transitive, production/development, and the direct dependencies that pull in each transitive one.                  |
| FR-7  | Query OSV.dev for every unique `name@version`, hydrate advisory details, and derive severity and the fixed version.                                                    |
| FR-8  | Score findings, group them into upgrade actions, derive the risk level and the top risks.                                                                              |
| FR-9  | Generate a summary with the LLM when configured; otherwise, or on any failure, with the template.                                                                      |
| FR-10 | Publish progress events per step; expose status by polling as well.                                                                                                    |
| FR-11 | Expose the report as JSON and render it in the UI.                                                                                                                     |
| FR-12 | List recent scans.                                                                                                                                                     |

## 7. Non-functional requirements

| Area                  | Target                                                                                                                                                          |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Submit latency        | `POST /api/scans` p95 < 100 ms (no outbound I/O on the request path).                                                                                           |
| Time to first insight | p50 < 15 s for a repo with ~1,000 packages, unauthenticated GitHub, AI summary on.                                                                              |
| Bounded runtime       | Hard 120 s scan timeout; every outbound call has its own timeout (GitHub 10 s, OSV 15 s, LLM 20 s).                                                             |
| Reliability           | Idempotent reads retried up to 2 times with exponential backoff and jitter; non-retryable errors fail fast with a stable code.                                  |
| Graceful degradation  | LLM failure gives the template summary. An advisory that cannot be hydrated gives a finding with `UNKNOWN` severity and a visible note. Neither fails the scan. |
| Resource limits       | Manifest <= 10 MB, <= 10,000 unique packages, <= 500 advisories hydrated, request body <= 16 KB, 2 concurrent scans, 25 queued.                                 |
| Security              | See `docs/SECURITY.md`. No execution of repository code, ever.                                                                                                  |
| Accessibility         | Labelled inputs, keyboard reachable controls, visible focus, WCAG AA contrast, usable at 360 px width.                                                          |
| Operability           | Structured JSON logs with request IDs; secrets redacted.                                                                                                        |

## 8. Assumptions

- The customer's repositories are public, or they are fine providing a server-side `GITHUB_TOKEN` for higher rate limits.
- The customer's primary stack is JavaScript/TypeScript (npm). This is the single biggest assumption; it is why the resolver is behind an interface.
- A committed `package-lock.json` reflects what is deployed. If they build with a different lockfile in CI, our result is only as good as the committed one.
- OSV.dev's npm data (sourced from the GitHub Advisory Database) is an acceptable source of truth for v1.
- "Production dependency" means "not marked `dev` in the lockfile". We do not know which code paths actually run.

## 9. Open questions for the customer

1. Which ecosystems matter most after npm? (Decides the second resolver.)
2. Are your repos monorepos? Where do the manifests live?
3. Do you need private repositories on day one? Org-wide GitHub App install, or per-user OAuth?
4. Where should the output land: this UI, PR comments, Jira tickets, Slack?
5. Do you have a policy (for example "no criticals in production") we should evaluate against instead of a generic risk level?
6. Is sending dependency names and advisory summaries to an LLM provider acceptable under your data policy? (No source code is sent.)
7. Do you want "accept risk" / suppression with a reason and an expiry?

## 10. Success metrics

| Metric                     | Definition                                                                                    | Target                                                                         |
| -------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Time to first insight      | From clicking "Scan" to the report's headline being visible                                   | p50 < 15 s                                                                     |
| Actions to understand risk | Number of action cards the user must read to cover every critical/high production finding     | <= 3 for a typical repo (shown on the report as "N actions fix X of Y issues") |
| Compression ratio          | Findings divided by actions                                                                   | > 2 (lodash alone: 6 findings, 1 action)                                       |
| Explained failures         | Share of failed scans with a specific error code (not `INTERNAL_ERROR`)                       | > 95%                                                                          |
| Summary reliability        | Share of AI summaries that pass validation (no fallback) when a key is set                    | > 95%                                                                          |
| Trust                      | Share of reports viewed whose coverage section was expanded or scrolled to (future telemetry) | Tracked, no target in v1                                                       |
