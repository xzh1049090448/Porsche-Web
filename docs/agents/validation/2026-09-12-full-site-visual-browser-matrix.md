# Full-site visual browser matrix — 2026-09-12

## Candidate and environment

- Revision under test: `e41d6cb362ffb5adea03fa5a5a74edc9af45c4bb`
- Contract: SHA-256 `47cfbc485c4df0f5d2c12539f389f466c97bb8318adf04966757420287d10a2f`, version `v1.0.0-p0`, status `agreed_for_implementation`
- Application: local production build served by Vite Preview at `http://127.0.0.1:5191`
- Browser: visible Chromium through `playwright-skill`
- Data: repository-compatible synthetic responses intercepted locally. User, model, content, notification and token values were invented for this run. No production credentials, upstream calls, database writes, or real mutations were used.
- Primary language: `zh-CN`. The visible language controls remained present on public, authentication and console shells; alternate-language copy was not exhaustively repeated across all 126 combinations.
- Screenshots: external-only directory `/private/tmp/porsche-web-visual-task11-20260912/screenshots`; no user data or secrets and no screenshots committed.

## Matrix

Each row below passed all six combinations: `375x812`, `768x1024`, and `1440x900`, each in `light` and `dark`, using `zh-CN`. Every case checked the resolved page, horizontal overflow, theme application, a keyboard-reachable visible focus target, dialog viewport bounds when a dialog was open, and forbidden prototype copy (`ModelHub`, `40+`, `100%`, `MIT License`).

| Route | Synthetic state | Six-combination result |
| --- | --- | --- |
| `/` | published content | PASS |
| `/about` | published content | PASS |
| `/terms` | published legal content | PASS |
| `/privacy` | published legal content | PASS |
| `/not-a-real-route` | public 404 | PASS |
| `/pricing` | published model | PASS |
| `/pricing/fixture-model` | published detail with nullable input price | PASS |
| `/login` | anonymous form | PASS |
| `/register` | anonymous form | PASS |
| `/chat` | authenticated empty history/catalog | PASS |
| `/billing` | authenticated empty plans/orders | PASS |
| `/api-keys` | authenticated token fixture/empty matrix state | PASS |
| `/profile` | authenticated profile/session fixture | PASS |
| `/users` | Root list fixture | PASS |
| `/users/903496573054181377` | Root detail fixture | PASS |
| `/admin/public-models` | configured plus missing-model fixture | PASS |
| `/admin/public-models/903496573054181378` | active detail fixture | PASS |
| `/admin/public-pricing` | draft and release-history fixture | PASS |
| `/admin/public-content` | draft and release-history fixture | PASS |
| `/admin/public-content/preview?revision=3` | sanitized preview fixture | PASS |
| `/admin/notifications` | active unread/unacknowledged plus resolved-empty fixture | PASS |

Total: **126/126 PASS**. Browser event collection returned `consoleErrors=[]` and `pageErrors=[]`.

## Interaction and state probes

- Public and console mobile menu controls were exercised at 375px, including Escape dismissal. The public pricing filter drawer was covered by the existing focused browser fixture at the same candidate family.
- API Keys/Profile focused probe passed at 1440px and 390px: table/card overflow, creation drawer, one-time secret dialog focus, copy stub, close cleanup, no secret persistence, profile forms, session table and revoke controls. No real token or session mutation occurred.
- Public model/pricing administration focused probe passed at 1440px and 390px: responsive tables, missing-model surface, creation dialog focus and Escape close, immutable identifiers, nullable price display, release history and password autocomplete.
- Public pricing state probe observed a visible loading surface and a synthetic HTTP 503 retry/error surface at 375px with zero overflow. The deliberately injected browser resource error was classified as expected; unexpected console and page errors remained empty.
- Empty states were observed for chat history/catalog, billing plans/orders, token lists and resolved notifications in the main matrix.
- Representative screenshots cover home, login, chat and public-content administration at 375px and 1440px in both themes (16 files).

## Explicit skips and boundaries

| State | Result | Reason |
| --- | --- | --- |
| Live production content and prices | SKIP | P08 production content remains pending; Task11 used synthetic published documents and pricing. |
| Public pricing empty (`/pricing`, state `empty`) | SKIP | The independent empty-state probe did not stably prove the empty surface and instead reached the unavailable surface. This probe is not included in the 126/126 published-state PASS and does not change the separately proven loading and synthetic 503 results. |
| Live authenticated account data | SKIP | No real credentials or user data were permitted. |
| Live writes: registration, billing purchase/payment, token creation/revoke, profile/session mutation, user/admin mutations, publish/restore/read/acknowledge | SKIP | Dangerous and externally visible writes were intentionally not executed; browser interactions used local synthetic fixtures and copy stubs only. |
| Real upstream chat generation and paid streaming | SKIP | Existing BE06 synthetic lifecycle evidence remains separate; no upstream or paid request was authorized here. |
| Public 410/authenticated-only/live 503 backend variants across every viewport-theme pair | SKIP | The matrix covered representative synthetic ready, loading, 404 and 503 states; live service variants require a dedicated acceptance environment. |
| Exhaustive `en` copy matrix | SKIP | Every case records `zh-CN`; language toggles were present, but a second 126-case copy matrix was outside this Task11 minimum. |

No concrete production visual or accessibility defect was reproduced, so no production file or focused TDD repair was required.

## Deterministic verification

- `VITE_USE_MOCK=false npm run build`: PASS. Rollup retained its existing large-chunk and mixed static/dynamic import warnings.
- Resolved visual test list: `src/layouts/visual-shell.contract.test.js`, `src/stores/theme.test.js`, `src/views/console-pages.visual.contract.test.js`, `src/views/users.visual.contract.test.js`.
- Focused visual suite: 32 PASS, 0 FAIL, 1 SKIP. The skipped in-test browser launch was sandbox-limited and was superseded by the successful visible Chromium matrix above.
- `node scripts/check-public-route-chunks.mjs dist`: PASS, 8 public chunks, 154,847 JavaScript bytes and 18,464 CSS bytes; JavaScript remains below the 200,000-byte budget.
- `git diff --check`: PASS.
- A plain `npm test` diagnostic was also attempted. It did not pass because frozen backend contract environment variables were intentionally absent, the real Vite server test could not bind `127.0.0.1` inside the command sandbox, and the pre-existing `admin-balance-mock.contract.test.js` still expects the historical relative demo route after the router was corrected to `/demo/admin/balance`. These failures are outside Task11's report-only scope and are not represented as passing.
