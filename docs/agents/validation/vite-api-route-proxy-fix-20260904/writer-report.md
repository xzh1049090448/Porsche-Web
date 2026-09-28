# Vite API route proxy fix writer acceptance

Date: 2026-09-04

Result: `PASS`

## Candidates and retained fixture

- Frontend candidate: `c788e78848a08c2fa3472812374448f388fb81aa`
- Backend candidate: `aec1619ee710c80cd71dbe529660e2d12b3fda7b`
- Frontend: `http://127.0.0.1:15174`, retained session `86781`, listener PID `35568`
- Backend: `http://127.0.0.1:8000`, retained session `23372`, listener PID `35526`
- Task label: `vite-api-route-fix-260904-c788e78848a0`
- MySQL: `vite-api-route-fix-260904-c788e78848a0-mysql`, container `8b689bfc0f743d6b97d27d35774c3f798a2e49cae82370a9cd583d46548a0a79`, image `mysql:8.0` (`sha256:7dcddc01f13bab2f15cde676d44d01f61fc9f99fe7785e86196dfc07d358ae2b`), loopback port `53802`, auto-remove, tmpfs data
- Redis: `vite-api-route-fix-260904-c788e78848a0-redis`, container `cc4c4c06d5cfbe7068cf446737ff9eb227fe39447ab69bbd17aa8946f2a8f40f`, image `redis:7-alpine` (`sha256:ff02b58f971e7d7d156a1267e283fcbbeee91773b6aa36c49dac28ecfe28eadf`), loopback port `53803`, auto-remove, tmpfs data
- The fixture remains running for PM review and independent QA. No cleanup or production action was performed.

## Regression gates

- `node --test vite.config.test.js`: 2 passed, 0 failed.
- `npm test`: 134 passed, 0 failed.
- `npm run build`: passed with Vite 6.4.3. The recorded Rollup annotations, mixed static/dynamic import notices, and chunk-size warning remained non-failing.
- `git diff --check`: passed with empty output.

## P02 and R01 browser acceptance

The writer used the retained real FE+BE fixture in a new Playwright browser context.

1. Real `/api/v1/auth/login` returned 200.
2. Authenticated `/api-keys` returned a 200 HTML document through SPA fallback, rendered `.api-keys-page`, and rendered again after hard reload.
3. Authenticated `/users` rendered `.admin-page` before and after hard reload.
4. Authenticated `/profile` rendered `.profile-page` before and after hard reload.
5. `/api/public/__proxy_probe__` returned backend 404 with a non-HTML response.
6. `/api?health=1` returned backend 404 with a non-HTML response, proving the raw-query route used the API proxy rather than SPA fallback.
7. UI logout called `/api/v1/auth/logout` and returned 204. The browser context then held zero cookies, and an explicit credentialed refresh returned 401.
8. Direct document navigation and hard-load behavior for `/api-keys`, `/users`, and `/profile` each returned the 200 SPA document, then the router guard settled on `/login`; `.api-keys-page`, `.main-layout`, `.token-list-card`, `.admin-page`, and `.profile-page` were absent.

All `/api/v1/platform/**` browser requests were aborted before reaching the backend. Eight automatic catalog requests were blocked. No model, chat, SSE, or upstream request completed or produced a response.

## Evidence

Private retained evidence directory: `/private/tmp/porsche-vite-api-route-fix-260904.xNjvNz`

- Raw request summary: `writer-raw.json`, SHA-256 `30a658a9ddb0982623cad1b3cc556bc9f511be9bec9987205d7833ffb5fcb8ed`
- Private writer result: `writer-results.json`, SHA-256 `2d45848cab174011e6c444b6c251957943884ffe4f982abe5378731c46e75bc3`
- Writer harness: `p02-r01-writer.mjs`, SHA-256 `884aaad08fd89a895b722daaccae5ddee432fb7e0f70c22126a11f913752a680`
- Proxy test log: `task5-proxy-test.log`, SHA-256 `055c71e93f1d985da53df6607338ca012034d99b96f1d3d16d29383f8301128f`
- Full test log: `task5-full-test.log`, SHA-256 `525f511a1641ce4b83220de7938ecd0633833d1376fc83074379b28ce34083ac`
- Build log: `task5-build.log`, SHA-256 `624ca78ab3f86293bc597d3c9002e0d45c9a8088d835727a6ca686108843abb9`
- Diff-check log: `task5-diff-check.log`, SHA-256 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`
- Screenshot hash manifest: `task5-evidence.sha256`

The retained screenshots mask fixture identity fields:

- `writer-screenshots/01-auth-api-keys-hard-reload.png`: `d5e4849406065e2fd4731317ea520ef159713933aae12abb8329293a03b4f36a`
- `writer-screenshots/02-auth-users-hard-reload.png`: `2f4c46315e79b6b03743ffbae5e397b88bf189d23ade5543a7568a5fb936a6be`
- `writer-screenshots/03-auth-profile-hard-reload.png`: `9b8eba8750b4b87f3c5c02a35870009396a3ceb6af5608c7e14e49ae588a8715`
- `writer-screenshots/04-post-logout-api-keys-login.png`: `3488dd7214d30f9eb3f6144ae1ebbe044461841ab969c2e32b0b14d74db1b4f6`
- `writer-screenshots/05-post-logout-users-login.png`: `295efbc9715418fa6f1a035bedeec1fcbbebf2898eb96f062fe5a4ec0a757c41`
- `writer-screenshots/06-post-logout-profile-login.png`: `eab63a4e62da577a46d109de76c206aa67fd55515b7191924154a331a4bad43e`

Two preliminary harness failures were preserved as private evidence. The first was a Node 24 CommonJS import incompatibility; the second was a missing bundled Chromium executable. Both occurred before a browser launched, sent no HTTP request, and invoked no model, SSE, or upstream route. The passing run reused the installed local Google Chrome executable without downloading or changing dependencies.
