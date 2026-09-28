# Task 6 independent QA and security report

Date: 2026-09-04

Verdict: `PASS`

Scope: local Vite proxy boundary remediation for P02 and R01

## Independent code gates

The gates were rerun independently on the current historical-evidence descendant while the checked runtime code remained identical to frontend candidate `c788e78848a08c2fa3472812374448f388fb81aa`:

| Gate | Result |
| --- | --- |
| `node --test vite.config.test.js` | PASS — 2 passed, 0 failed |
| `npm test` | PASS — 134 passed, 0 failed, 0 skipped |
| `npm run build` | PASS — Vite 6.4.3, 2308 modules transformed |
| `git diff --check` | PASS — empty output |

The build retained the previously observed Rollup annotation, mixed static/dynamic import, and chunk-size warnings. They remained non-failing and introduced no new build error.

## Fresh-browser QA

Independent QA created a new browser context and did not reuse the writer's cookies or browser storage. The private result is `QA_PASS`.

- Login returned 200.
- Authenticated `/api-keys`, `/users`, and `/profile` each returned a 200 HTML SPA document, rendered the expected private page, and rendered again after hard reload.
- `/api?health=1` and `/api/public/__qa_proxy_probe__` each returned backend 404 `text/plain`, proving the requests reached the backend proxy rather than SPA fallback.
- UI logout returned 204; the browser held zero cookies afterward; the explicit same-origin refresh returned 401.
- Post-logout direct document navigation for `/api-keys`, `/users`, and `/profile` returned the 200 HTML SPA document, settled at `/login`, rendered the login card, and contained zero private DOM selectors.
- Nine automatic platform catalog requests were aborted before network dispatch. No model, chat, SSE, or upstream request reached the backend.
- The retained frontend, backend, MySQL, and Redis identities matched the recorded fixture. No cleanup occurred during QA.

## P02 and R01 decision

| Case | Decision | Boundary |
| --- | --- | --- |
| P02 | `PASS_LIMITED_SCOPE` | Local loopback Vite+backend only: authenticated hard reload, logout 204, cookie clearance, refresh 401, and post-logout private-route guard passed. |
| R01 | `PASS_LIMITED_SCOPE` | Local loopback menu/direct-route and hard-reload behavior for `/api-keys` passed; `/users` and `/profile` regressions also passed. |

The original `FAIL_LOCAL_DEV_ROUTE` archive remains immutable historical evidence. These local results do not establish production HTTPS, production reverse-proxy behavior, R02, full-PRD acceptance, model behavior, chat behavior, or SSE behavior; all remain not run or retain their previous state.

## Evidence integrity and secret scan

Private QA evidence directory: `/private/tmp/porsche-vite-api-route-fix-260904.xNjvNz`

| Artifact | SHA-256 |
| --- | --- |
| `qa-results.json` | `e822b1655465eb233d4a985f7b77dedfdd1120bce87bd1da1e9599fa7b536286` |
| `qa-environment.json` | `a8cd17bb8fe2ff0d7d217d59dbd236a3b56c45ee563e16a118105c63577562e1` |
| `qa-manifest.json` | `a7cf2ba005ebad6ab8dbc08e299aa3af5f01a3404d630f2adb7f5c7af2ce3629` |
| `qa-report.md` | `cef0d2c24cc90b8df427b25dd9735d06d59d33bd626072ca3f0c9360a8604b27` |
| `qa-independent.mjs` | `025919ab0a989607e5360b14e89fabafacfa3dcd81787a6d51d082f37874c431` |

The QA manifest records six screenshot hashes. The final result, environment, manifest, report, harness, committed writer result, committed writer report, and both Task 6 review files were checked against ten exact credential/token candidates read from the private fixture. Nine text evidence files were scanned and zero exact secret matches were found. No credential, token, Cookie value, Authorization header, or password is included in this report.

Final Task 6 gate: `PASS`. Status promotion remains limited to P02 and R01 local `PASS_LIMITED_SCOPE` and requires the separate Task 7 state update.
