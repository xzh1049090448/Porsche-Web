# A14 frontend gates

- Executed: 2026-09-06, Asia/Shanghai
- Frontend candidate tested: `b8cbf0b5ecfd944457be0501d89e54a41e208044`
- Backend contract source: `811213d557eea7b6b9523a584245252ba4dd7d80`
- Frontend contract SHA-256: `1b379b34f6bea0a35000022c773f784f451fa29b1f5013ec14d5d56b99b853a3`
- Backend contract SHA-256: `514e9a08475e6b15193f653d18f3054bddc0f753228c48af45d88cca1c230986`
- Verdict: **PASS** for the Task 17 frontend test, build, contract, replay, and static leakage gates.
- Scope: local frontend gates only. No browser, live backend, fixture, container, deployment, push, or production operation was run.

## Test and build results

| Command | Exit | Exact result |
| --- | ---: | --- |
| `npm test` | 1 | 199 tests: 197 pass, 1 fail, 1 skip. The only failure is the deliberate `missing_A14_BACKEND_CONTRACT` fail-closed guard; the matching test skips for the same missing input. This is an incomplete invocation, not a product failure. |
| `A14_BACKEND_CONTRACT=/Users/xuzhihao/code/Porsche/.worktrees/admin-public-260903/docs/agents/contracts/admin-action-future-contract.json npm test` | 0 | 199 tests: 199 pass, 0 fail, 0 skip, 0 cancelled, 0 todo; duration 1250.03925 ms. This is the authoritative complete test gate. |
| `A14_BACKEND_CONTRACT=/Users/xuzhihao/code/Porsche/.worktrees/admin-public-260903/docs/agents/contracts/admin-action-future-contract.json node --test src/api/admin-user-actions-contract.test.js src/api/admin-user-actions-state.test.js src/api/admin-user-actions.test.js src/components/admin/UserSoftDeleteDialog.contract.test.js src/stores/admin-user-actions.test.js src/views/admin-user-delete.contract.test.js` | 0 | Focused A14 evidence: 62 pass, 0 fail, 0 skip, 0 cancelled, 0 todo; duration 286.167166 ms. |
| `npm run build` | 0 | Vite 6.4.3 transformed 2313 modules and built the production bundle in 6.06 s. |
| `git diff --check` | 0 | PASS before this report; rerun after the report below. |
| Parse both contract JSON files | 0 | 2/2 files parse successfully. The authoritative full test also proves normalized Issue, Execute, Query, legacy-delete, v2 user-read, replay-limit, security-property, and error contracts are exactly equal. |

The build emitted five non-fatal warning groups: two Rollup pure-annotation placement warnings from `@vueuse/core`, one mixed dynamic/static import warning for `src/utils/export.js`, one mixed dynamic/static import warning for `src/api/request.js`, and the existing chunk-size warning. No source map was emitted (`find dist -type f -name '*.map'` returned 0).

## Required scans

The required commands were run against the fresh build:

```bash
rg -n 'localStorage|sessionStorage|console\.(log|info|debug)|current_password|X-Action-Ticket|Idempotency-Key' src dist
rg -n 'users\.(create_admin|reset_password|promote|demote|permissions_write)|public_content\.(publish|rollback)' src dist
```

The first scan returned 29 matching lines and 39 occurrences. Source counts were 7 `Idempotency-Key`, 2 `X-Action-Ticket`, 2 `current_password`, 13 `localStorage`, 5 `sessionStorage`, and 0 console calls. Built-output counts were 2 `Idempotency-Key`, 1 `X-Action-Ticket`, 1 `current_password`, 6 `localStorage`, 0 `sessionStorage`, and 0 console calls.

Line-by-line classification for the first scan:

| Match | Classification |
| --- | --- |
| `src/api/admin-user-actions.js:108` | Required public Issue body field name. The password value exists only as the direct request argument. No storage, URL, analytics, or logging sink is present. |
| `src/api/admin-user-actions.js:114` | Required public Execute header names. The ticket/key values are placed only on this one POST. |
| `src/api/admin-user-actions.js:119` | Required public Query header name. Query reuses the original key and is the only action request eligible for the separately tested one-refresh GET replay. |
| `src/api/admin-user-actions.test.js:31,37,43` | Transport contract fixtures/assertions; no production sink. |
| `src/api/admin-user-actions-state.test.js:468,469,474,475,489,490` | Trap installation/restoration proving the workflow does not access browser storage. |
| `src/api/auth-request-policy.test.js:91,101,146` | Replay-policy fixtures/assertions proving only the exact Query GET is recoverable. |
| `src/api/auth-session.test.js:52` | Negative source assertion. |
| `src/utils/gateway-token-presentation.test.js:99` | Negative source assertion. |
| `src/utils/export.test.js:21` | Escaping-test input for an unrelated export feature. |
| `src/stores/chat.test.js:10,27` | Unrelated chat storage test fixture. |
| `src/api/auth-browser.test.js:11` | Unrelated authentication-coordination storage fixture. |
| `src/api/auth-browser.js:10` | Existing authentication epoch/pending coordination adapter; it neither imports nor receives A14 workflow state, reason, password, ticket, or key. |
| `src/utils/storage.js:5,13,17` | Generic existing UI-preference helper. No A14 production file imports this helper. |
| `dist/assets/UserSoftDeleteDialog-oJDMJ4gy.js:2` | Minified equivalents of the required public body/header identifiers. The chunk has no storage or console match. |
| `dist/index.html:11,20` | Existing theme and locale preference reads only. |
| `dist/assets/index-BNpm5Sg2.js:101` | Minified existing storage/auth-coordination code. The A14 dialog chunk is separate and has no storage import or call. |

The second scan returned 7 matching lines and 24 occurrences. Source and built-output token counts were identical: 2 `users.reset_password`, 3 `users.promote`, 3 `users.demote`, 2 `public_content.publish`, and 2 `public_content.rollback`; `users.create_admin` and `users.permissions_write` returned zero.

Line-by-line classification for the second scan:

| Match | Classification |
| --- | --- |
| `src/api/admin-users.js:2,4,6,9` | Read-only B1-D capability-catalog identifiers and metadata validation. They are not A14 action descriptors, routes, controls, or transport payload action values. |
| `src/api/auth-session.js:15` | Read-only allowlist for the server-projected permission vocabulary. It creates no action UI or transport. |
| `dist/assets/index-BNpm5Sg2.js:101,105` | Minified equivalents of those read-only capability vocabulary checks. |

A dedicated production-source check for these strings as `action:` values returned zero. A second check across the A14 adapter, state machine, store, dialog, and list/detail integration returned zero. The only production A14 action values remain `users.delete` for Issue and `delete` for Execute.

## Reason, unknown-state, leakage, and replay review

A supplementary `reason|unknown` scan covered the A14 adapter, state machine, store, dialog, and list/detail integration, plus the generated A14 dialog chunk.

- The normalized reason is held in the coordinator/workflow closure, sent only in the two specified request bodies, retained after a known failure for an explicit user retry, and cleared on success, close, dispose, or authentication failure. It is never included in the public state snapshot or failure object.
- Password is cleared after Issue settles and before Execute; ticket is cleared after Execute settles; reason, ticket, key, password, and active intent are all cleared at terminal workflow cleanup/unmount.
- `unknown` is the intended in-memory public state reached only after an ambiguous Execute. It immediately drives Query with the original key; it is neither serialized nor written to storage, URL, analytics, logs, or evidence.
- A14 production files contain zero `localStorage`, `sessionStorage`, or `console.log/info/debug` occurrences and do not import the generic storage helper.
- The production request layer sends sensitive POSTs through a transport without session/retry interceptors. The focused tests prove Issue and Execute are never replayed, duplicate submissions share one run, and only exact scoped Query may refresh/retry once.
- The fresh `dist` contains no source maps. The A14 dialog chunk contains only required public field/header names and the intended `reason`/`unknown` code paths; it has no storage or console channel.
- A scan of `dist` for the repository's A14 private test markers returned zero, so test-only values are absent from the production bundle.

No product defect was demonstrated by these gates, so no implementation or test file was changed.
