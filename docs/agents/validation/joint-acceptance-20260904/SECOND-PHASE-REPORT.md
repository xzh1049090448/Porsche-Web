# Independent joint acceptance — second phase

Date: 2026-09-04. Scope: retained local FE/BE fixture only. No business source, fixture data, container, credential, or cookie policy was changed; no cleanup ran.

## Verdict

**FAIL (local joint acceptance).** The current users-read slice passes its implemented read-only scope, but the frontend's local Vite proxy rule makes the existing `/api-keys` client route inaccessible after a hard reload. This prevents a full P02/R01 pass. It is not a restored authenticated session, a failed server-side logout, or private data exposure.

## P02 Phase-1 diagnosis

The original core report recorded logout-route guard PASS. Its final navigation sampled the route before distinguishing a frontend document response from a settled router result. That raw result is retained unchanged. The later three-context diagnostic supersedes only that interpretation:

| Context | Logout | Cookies after logout | Explicit refresh | Stable `/api-keys` result |
| --- | --- | --- | --- | --- |
| 127.0.0.1 #1 | 204 | empty | 401 | URL remained `/api-keys`; document was 404; no subsequent refresh; no login, main-layout, or private API-key DOM rendered |
| localhost | not reached | n/a | 403 during authenticated route refresh | Origin is rejected by the local trusted-origin policy before logout; it is not comparable to the configured 127.0.0.1 app origin |
| 127.0.0.1 #3 | 204 | empty | 401 | same 404/no-refresh/no-private-DOM result as #1 |

Playwright did not expose the response `Set-Cookie` header to the browser response API, so its value was never read. The evidence records the observable clearing result instead: the context cookie inventory was empty after both 127.0.0.1 logouts. The explicit refresh returned 401 in both cases.

Root cause: the private Vite configuration proxies the prefix `/api`, which also matches the browser document route `/api-keys`. Its hard reload is therefore proxied to the backend and receives 404 before Vue can execute a router guard. This is **FAIL_LOCAL_DEV_ROUTE**. It does not demonstrate a logout revocation failure or an authenticated API-key page after logout.

## Implemented-scope findings

| Item | Status | Independent evidence |
| --- | --- | --- |
| A01 | PASS_LIMITED_SCOPE | Ordinary-user list returned 403; direct `/users` showed the denial state and no rows. |
| A02 | PASS_LIMITED_SCOPE | Root self detail 404/Admin detail 200; Admin saw only user rows and could not see self or Root detail. |
| A04 | PASS_LIMITED_SCOPE | GUID exact search preserved `total`/`items`; role/status/deleted, supported sorting, escaped `%`/`_`, invalid page 400, and fast-filter latest-result behavior passed. |
| A05–A08 read subset | PASS_LIMITED_SCOPE | Root catalog 200, ordinary-user catalog 403, Admin permission detail 200, Root permission target 404. An unauthorized legacy forged update was 403 and an invalid legacy status was 422 before mutation. |
| A13 | PASS_LIMITED_SCOPE | Root live users/detail surfaces contained no create, edit, delete, protection-changing, or Root-target control. |
| V01 | PASS_LIMITED_SCOPE | Populated 1440 users and Admin-detail screenshots captured. No versioned prototype artifact exists in this checkout for pixel comparison. Landing/pricing remains outside the candidate; group/quota are visibly marked not integrated. |
| V02 | PASS_LIMITED_SCOPE | 375/768/1440 had no document-level horizontal overflow. Tab, Enter, Escape, visible focus, filter labels/table role, reduced-motion context, and a computed heading/body contrast of 12.13:1 passed. `axe-core` was unavailable and was not installed; this is not an axe audit. |
| P02 | FAIL_LOCAL_DEV_ROUTE | Logout 204, cleared context cookies, and refresh 401 pass; `/api-keys` hard reload is a 404 because of the local proxy prefix collision. HTTPS production behavior was not tested. |
| R01 | FAIL_LOCAL_DEV_ROUTE | Auth/session and users-read routes ran locally, but API-key menu/direct route cannot render through this frontend proxy setup. Model and SSE behavior was excluded. |

## Required 26-item status matrix

| ID | Status |
| --- | --- |
| A01 | PASS_LIMITED_SCOPE |
| A02 | PASS_LIMITED_SCOPE |
| A03 | BLOCKED_NOT_IMPLEMENTED |
| A04 | PASS_LIMITED_SCOPE |
| A05 | BLOCKED_NOT_IMPLEMENTED (read-only subset passed) |
| A06 | BLOCKED_NOT_IMPLEMENTED (read-only subset passed) |
| A07 | BLOCKED_NOT_IMPLEMENTED (read-only subset passed) |
| A08 | BLOCKED_NOT_IMPLEMENTED (read-only subset passed) |
| A09 | BLOCKED_NOT_IMPLEMENTED |
| A10 | BLOCKED_NOT_IMPLEMENTED |
| A11 | BLOCKED_NOT_IMPLEMENTED |
| A12 | BLOCKED_NOT_IMPLEMENTED |
| A13 | PASS_LIMITED_SCOPE |
| A14 | BLOCKED_NOT_IMPLEMENTED |
| P01 | BLOCKED_NOT_IMPLEMENTED |
| P02 | FAIL_LOCAL_DEV_ROUTE |
| P03 | BLOCKED_NOT_IMPLEMENTED |
| P04 | BLOCKED_NOT_IMPLEMENTED |
| P05 | BLOCKED_NOT_IMPLEMENTED |
| P06 | BLOCKED_NOT_IMPLEMENTED |
| P07 | BLOCKED_NOT_IMPLEMENTED |
| P08 | BLOCKED_PRODUCT |
| V01 | PASS_LIMITED_SCOPE |
| V02 | PASS_LIMITED_SCOPE |
| R01 | FAIL_LOCAL_DEV_ROUTE |
| R02 | BLOCKED_ENV |

## Visual evidence hashes

| Artifact | SHA-256 |
| --- | --- |
| `phase2-v01-users-1440.png` | `4cdfc1a2035a41e61a834c53337281ffa6fd929822da3f457254a4142eca0e62` |
| `phase2-v01-admin-detail-1440.png` | `5482bac0259a08a38855021db249a15aed985b52c292b7c11bdcc5806ef120b2` |
| `phase2-v02-users-375.png` | `c329e4223f2196501abf0f6ec40dfe8d74f57f940644d8d47ed9b3f1fdcedc3e` |
| `phase2-v02-users-768.png` | `7951533baa8b58f59f7c3224ec509a184d8043350d5bd401884fd08390a1a342` |
| `phase2-v02-users-1440.png` | `e82739932ee5a51ac1e03459ced60cb127943b6f142bf42d023f366d46b05097` |

The evidence directory was scanned for connection-string schemes and bearer-like token material; no match was found. Raw artifacts retain only statuses, paths, DOM-state booleans, test descriptions, and screenshot hashes.

Primary raw evidence: `core-phase-results.json`, `phase2-results.json`, `p02-three-contexts.json`, `p02-context-1.json`, `guard-debug.json`, and `logout-debug.json`.
