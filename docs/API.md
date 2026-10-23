# API

Base path: `/api`. All bodies are JSON (`application/json`) except the SSE stream. The Zod schemas in `packages/shared/src` are the source of truth; this document mirrors them. The web client validates every response against the same schemas.

Every response carries an `X-Request-Id` header. A client may send its own `X-Request-Id` (1 to 64 chars of `[A-Za-z0-9-]`); otherwise the server generates a UUID.

## Error envelope

Every non-2xx response has this shape:

```json
{
  "error": {
    "code": "INVALID_REPO_URL",
    "message": "Only https://github.com/{owner}/{repo} URLs are supported.",
    "details": { "reason": "host" }
  }
}
```

`details` is optional. Stack traces and internal messages are never returned; 500s always say `"An unexpected error occurred."` and the request ID is the correlation handle.

| HTTP | `code`                   | When                                                                              |
| ---- | ------------------------ | --------------------------------------------------------------------------------- |
| 400  | `VALIDATION_ERROR`       | Body or params fail schema validation (`details.issues` lists paths and messages) |
| 400  | `INVALID_REPO_URL`       | URL is not an accepted GitHub repository URL (`details.reason`)                   |
| 404  | `NOT_FOUND`              | Unknown scan ID or route                                                          |
| 409  | `SCAN_NOT_COMPLETED`     | Report requested before completion (`details.status`)                             |
| 413  | `PAYLOAD_TOO_LARGE`      | Body over 16 KB                                                                   |
| 415  | `UNSUPPORTED_MEDIA_TYPE` | Body is not JSON                                                                  |
| 429  | `RATE_LIMITED`           | Per-IP request rate exceeded (`Retry-After` header set)                           |
| 429  | `TOO_MANY_STREAMS`       | Too many open SSE streams for this IP or globally                                 |
| 503  | `SERVICE_BUSY`           | Scan queue is full                                                                |
| 500  | `INTERNAL_ERROR`         | Anything unexpected                                                               |

## `POST /api/scans`

Start a scan. Rate limited to 10 per minute per IP.

Request:

```json
{ "repoUrl": "https://github.com/expressjs/express" }
```

`repoUrl`: string, 1 to 300 chars. Accepted forms: `https://github.com/{owner}/{repo}`, optional trailing `/`, optional `.git`, optional `/tree/{ref}` (ref may contain `/`). `www.github.com` is accepted. Query strings and fragments are ignored.

Responses:

- `202 Accepted`: a new scan was created and queued.
- `200 OK`: a scan for the same `owner/repo#ref` is still running; its ID is returned (`deduplicated: true`).

```json
{ "scanId": "8a7c3e0e-3a0b-4c55-9a55-1a1f4b9a4b8e", "status": "queued", "deduplicated": false }
```

Errors: `400 VALIDATION_ERROR`, `400 INVALID_REPO_URL`, `429 RATE_LIMITED`, `503 SERVICE_BUSY`.

```bash
curl -s -X POST localhost:8787/api/scans -H 'content-type: application/json' \
  -d '{"repoUrl":"https://github.com/expressjs/express"}'
```

## `GET /api/scans/:id`

Current state of a scan. Use this for polling (the web client polls every 1.5 s when SSE is unavailable).

`200`:

```json
{
  "id": "8a7c3e0e-3a0b-4c55-9a55-1a1f4b9a4b8e",
  "repo": {
    "owner": "expressjs",
    "name": "express",
    "url": "https://github.com/expressjs/express"
  },
  "ref": null,
  "commitSha": "1f0d5b3c0e4c2b8f0b7d2a7e9c0a1b2c3d4e5f60",
  "status": "checking_vulnerabilities",
  "progress": 33,
  "steps": [
    {
      "name": "fetching_repo",
      "label": "Fetch repository",
      "status": "completed",
      "detail": "Commit 1f0d5b3 on master, package.json",
      "startedAt": "2026-10-23T10:00:00.120Z",
      "finishedAt": "2026-10-23T10:00:01.020Z"
    },
    {
      "name": "resolving_dependencies",
      "label": "Resolve dependencies",
      "status": "completed",
      "detail": "31 packages (31 direct)",
      "startedAt": "...",
      "finishedAt": "..."
    },
    {
      "name": "checking_vulnerabilities",
      "label": "Check known vulnerabilities",
      "status": "running",
      "detail": null,
      "startedAt": "...",
      "finishedAt": null
    },
    {
      "name": "prioritizing",
      "label": "Prioritize risks",
      "status": "pending",
      "detail": null,
      "startedAt": null,
      "finishedAt": null
    },
    {
      "name": "generating_summary",
      "label": "Write summary",
      "status": "pending",
      "detail": null,
      "startedAt": null,
      "finishedAt": null
    },
    {
      "name": "completed",
      "label": "Report ready",
      "status": "pending",
      "detail": null,
      "startedAt": null,
      "finishedAt": null
    }
  ],
  "error": null,
  "createdAt": "2026-10-23T10:00:00.010Z",
  "updatedAt": "2026-10-23T10:00:02.400Z",
  "finishedAt": null
}
```

`status` is one of `queued`, `fetching_repo`, `resolving_dependencies`, `checking_vulnerabilities`, `prioritizing`, `generating_summary`, `completed`, `failed`. When `failed`, `error` is set:

```json
{
  "code": "GITHUB_RATE_LIMITED",
  "message": "GitHub's API rate limit was reached. Try again in a few minutes, or configure GITHUB_TOKEN on the server.",
  "retryable": true
}
```

Scan error codes: `REPO_NOT_FOUND`, `REPO_EMPTY`, `REF_NOT_FOUND`, `GITHUB_RATE_LIMITED`, `GITHUB_UNAVAILABLE`, `NO_SUPPORTED_MANIFEST`, `MANIFEST_TOO_LARGE`, `MANIFEST_INVALID`, `TOO_MANY_PACKAGES`, `VULN_SOURCE_UNAVAILABLE`, `SCAN_TIMEOUT`, `INTERNAL_ERROR`.

Errors: `400 VALIDATION_ERROR` (ID is not a UUID), `404 NOT_FOUND`.

## `GET /api/scans/:id/events`

Server-Sent Events stream (`text/event-stream`). Each event's `data` is JSON.

| Event       | `data`                                         | When                                                                  |
| ----------- | ---------------------------------------------- | --------------------------------------------------------------------- |
| `snapshot`  | full `Scan`                                    | First message on every connection (lets a reconnecting client resync) |
| `step`      | `ScanStep`                                     | A step changes status or detail                                       |
| `progress`  | `{ "status": ScanStatus, "progress": number }` | After every step change                                               |
| `completed` | `{ "scanId": string }`                         | Scan completed; the server then closes the stream                     |
| `failed`    | `{ "scanId": string, "error": ScanError }`     | Scan failed; the server then closes the stream                        |

A comment line `: heartbeat` is sent every 15 s so proxies keep the connection open and dead clients are detected. If the scan is already terminal when the client connects, the server sends `snapshot` followed by `completed`/`failed` and closes.

Limits: 10 concurrent streams per IP, 100 in total (`429 TOO_MANY_STREAMS`).

```
event: step
data: {"name":"resolving_dependencies","label":"Resolve dependencies","status":"completed","detail":"812 packages (34 direct)","startedAt":"...","finishedAt":"..."}

event: progress
data: {"status":"checking_vulnerabilities","progress":33}
```

## `GET /api/scans/:id/report`

`200` with a `Report` once `status` is `completed`. Errors: `404 NOT_FOUND`, `409 SCAN_NOT_COMPLETED` (`details.status` is the current status, including `failed`).

```json
{
  "scanId": "8a7c3e0e-...",
  "repo": { "owner": "acme", "name": "shop", "url": "https://github.com/acme/shop" },
  "ref": null,
  "commitSha": "1f0d5b3c...",
  "generatedAt": "2026-10-23T10:00:09.100Z",
  "riskLevel": "high",
  "summary": {
    "mode": "template",
    "headline": "High risk: 2 upgrades fix 7 of 8 known vulnerabilities, including 1 high in production.",
    "overview": "We checked 812 npm packages from package-lock.json at commit 1f0d5b3...",
    "fallbackReason": "ANTHROPIC_API_KEY is not configured."
  },
  "actions": [
    {
      "id": "lodash",
      "packageName": "lodash",
      "currentVersions": ["4.17.15"],
      "targetVersion": "4.17.21",
      "findingIds": ["GHSA-35jh-r3h4-6jhm", "GHSA-p6mc-m468-83gw", "..."],
      "fixableCount": 6,
      "highestSeverity": "HIGH",
      "direct": true,
      "dev": false,
      "introducedBy": [],
      "score": 9.84,
      "command": "npm install lodash@4.17.21",
      "rationale": "Upgrade lodash 4.17.15 to 4.17.21: fixes 6 issues (highest: high) in a direct production dependency."
    }
  ],
  "topRisks": [
    {
      "findingId": "GHSA-35jh-r3h4-6jhm",
      "packageName": "lodash",
      "severity": "HIGH",
      "title": "Command Injection in lodash",
      "explanation": "..."
    }
  ],
  "findings": [
    {
      "id": "GHSA-35jh-r3h4-6jhm",
      "aliases": ["CVE-2021-23337"],
      "packageName": "lodash",
      "installedVersion": "4.17.15",
      "severity": "HIGH",
      "severitySource": "ghsa",
      "cvssScore": 7.2,
      "summary": "Command Injection in lodash",
      "fixedVersion": "4.17.21",
      "direct": true,
      "dev": false,
      "introducedBy": [],
      "score": 7,
      "advisoryUrl": "https://osv.dev/vulnerability/GHSA-35jh-r3h4-6jhm"
    }
  ],
  "stats": {
    "totalFindings": 8,
    "bySeverity": { "CRITICAL": 0, "HIGH": 3, "MODERATE": 4, "LOW": 1, "UNKNOWN": 0 },
    "actionCount": 2,
    "fixableFindings": 7
  },
  "coverage": {
    "ecosystem": "npm",
    "manifest": "package-lock.json",
    "lockfileVersion": 3,
    "accuracy": "exact",
    "packagesChecked": 812,
    "directDependencies": 34,
    "transitiveDependencies": 778,
    "skippedPackages": 0,
    "unsupportedManifests": ["requirements.txt"],
    "scannedPath": "/"
  },
  "notes": [],
  "reusedFromScanId": null
}
```

Field semantics are in `docs/ARCHITECTURE.md` section 4 and 5.

## `GET /api/scans`

The 20 most recent scans, newest first.

```json
{
  "scans": [
    {
      "id": "...",
      "repo": { "owner": "acme", "name": "shop", "url": "..." },
      "ref": null,
      "status": "completed",
      "riskLevel": "high",
      "commitSha": "1f0d5b3c...",
      "createdAt": "..."
    }
  ]
}
```

`riskLevel` is `null` unless the scan completed.

## `GET /api/health`

```json
{ "status": "ok", "mode": "live", "aiSummaries": true }
```

`mode` is `live` or `mock` (`SCANNER_MODE`). `aiSummaries` says whether an LLM key is configured (it does not reveal the key or the model). Not rate limited.
