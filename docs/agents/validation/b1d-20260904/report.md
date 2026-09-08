# B1-D FE candidate validation report — 2026-09-04

## Candidate and review boundary

- FE worktree HEAD: `25a66a4ad546a481941dfc6e0cc9bc75da2e631b` on `feature/admin-public-260903`.
- Frozen BE r1 baseline: `aec1619ee710c80cd71dbe529660e2d12b3fda7b`.
- Historical deployed frontend hash recorded by the existing M3 evidence: `158a00e`; it was not queried or changed during this task. Historical deployed backend hash is `ad3f5b4`, also not queried or changed here.
- PM `b1d_cross_team_spec` completed final B1-D CODE SPEC PASS after the pagination narrow fix and F1/F2 closure, with the B1-D r1 contract and FE/BE candidate hashes matched. It confirms an implementation candidate only; PM's real joint acceptance remains `NOT_RUN`.
- Independent quality completed with `VERDICT PASS` for the local FE candidate and independent browser scope. Its final Chrome run at `localhost:5177` checked pagination delta/UI, all four detail errors with retry, F1 revocation clearing rows, 24 permission rows after recovery, `pageErrors=[]`, and five expected synthetic console resource errors. Offline audit freshness is `NOT_VERIFIED`.

## Local verification

| Command | Result |
| --- | --- |
| `npm test` | exit 0; 132 pass, 0 fail, 0 skipped |
| `npm run build` | exit 0; Vite build completed in 4.94 s; existing Rollup comment/dynamic-import/chunk-size warnings remain |
| `git diff --check` | exit 0; no output |
| contract JSON guard | exit 0; 27 interfaces and overall `DRAFT` |
| `node /tmp/porsche-b1d-browser.cjs` | exit 0; Chrome with only synthetic `/api/v1/**` and `/admin/v2/**` routes |

The final Chrome run used `http://localhost:5174` against Vite session `11611` (kept running for independent QA). Its script asserts the out-of-range pagination delta is exactly two list requests (page 2 then page 1) and that Element Plus displays page 1. A duplicate third request was first reproduced; the fix announces the recovered page before the fallback response commits total, and the final run passes that assertion.

The raw outputs are retained as `npm-test.log`, `npm-build.log`, and `git-diff-check.log`. They were generated sequentially after the final F1/F2 fixes; their recorded exit codes are all zero. The build completed in 4.94 s in this final capture and retains only the existing warnings described above.

F1 adds an opt-in Axios response envelope for `self` and `users/me`: a safe-read 401 retry returns the retry attempt's trusted request snapshot, then both display profile and permission projection validate that final epoch, token generation and permission revision. The final browser run proves a real store `fetchSelf` 401 → one refresh → successful self retry whose missing projection clears the menu and list.

F2 maps detail errors without rendering backend text: 401 `认证会话无效`, 403 `无权限访问`, 404 `用户不存在`, 503 and fallback `用户信息暂不可用`. Every detail error clears the old detail via the existing state coordinator and offers retry; missing permission and the unavailable permission panel offer `重新检查身份`. The final browser run proves each status, retry recovery, no 401/403 refresh, and detail recovery after a missing projection.

Browser coverage includes first refresh 401 then login, hard refresh with successful refresh, desktop and mobile viewports, list sorting/filtering, 403 and 503 sensitive-data clearing plus retry, no refresh/logout on 403, same-projection `fetchSelf` preserving the list, missing and malformed projections clearing menu/data then recovery through real `fetchSelf`, and Root detail requests for both catalog and permissions.

`pageErrors` is `[]`. Console resource errors for the deliberately synthesized 401, 403, and 503 are preserved in the log as expected HTTP-error evidence; no other console errors were recorded.

## Artifact inventory

- `browser-smoke.cjs`: final Chrome harness.
- `browser-smoke.log`: raw browser request/response, scenario and error evidence.
- `desktop.png`, `root-detail.png`, `mobile.png`: final screenshots.
- `manifest.json`: SHA-256 inventory and environment identifiers.
- `pm-final-review.md`: cross-team candidate contract confirmation.
- `quality-final-review.md`: independent quality `PASS` verdict and real-system skipped-work boundary.

## Not run

- No real backend, database, Redis, production endpoint, production environment, or model request was used.
- Real authentication-cookie integration, database fixture behavior, 100k performance, cross-team joint cases, and PM real joint acceptance remain `SKIPPED` or `NOT_RUN` as recorded in the review artifacts.
- F1/F2 are closed in the implementation candidate; independent quality is complete with local FE candidate `PASS`, not a production or joint-acceptance pass.
