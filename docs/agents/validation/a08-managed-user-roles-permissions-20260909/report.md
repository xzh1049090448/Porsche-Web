# A08 managed-user roles and permissions frontend evidence

Status: `PASS_LIMITED_SCOPE`

Frontend code under test is `25b073164dc3fccecbf3b74309f12dd7589c024b`. Paired backend code is `f2f976005c2331c0409c1b27da79e3a43d25bcb0`, with final backend evidence commit `3f41ef2dc1f38fc363cbdcf1e2205b26f7a9da09`. The frontend and authoritative backend A08 contracts remain byte-identical with SHA-256 `dd202cb5019b10a891e10f03f77629b5f54e993110f148f417e05d089df35698`.

## Automated gates

- A08 focused gate: 41 pass, 0 fail, 0 skip.
- Full frontend gate with all five authoritative backend contract paths: 446 pass, 0 fail, 0 skip.
- Production build with `VITE_USE_MOCK=false`: exit 0. Existing PURE annotation, mixed import and chunk-size warnings remain.
- `git diff --check`: exit 0.

The final browser run found and closed one integration-only defect. `admin-users.js` compared a Vue-proxied `state.selected` object with the raw detail object by reference, so Root never loaded `/admin/v2/authz/catalog` for an ordinary User target and the promotion control stayed hidden. Commit `25b0731` now unwraps only for precise identity comparison; its regression test proves a cloned same-value object is still rejected.

## Visible Chromium acceptance

The real frontend at `127.0.0.1:4176` used the real backend at `127.0.0.1:8000`, disposable MySQL 8.0.46 and Redis 7.4.11. A temporary Root account and temporary ordinary User completed this sequence:

1. Detail and authorization catalog GETs both returned 200; the promotion control appeared.
2. Promotion used one verification POST returning 201 and one action POST returning 200.
3. The refreshed Admin detail and permissions GETs each returned 200; permission and demotion controls appeared.
4. Permission save set `users.read` to explicit deny, using one verification POST returning 201 and one permission PATCH returning 200.
5. Demotion used one verification POST returning 201 and one action POST returning 200.
6. The final detail returned to User; database evidence showed `auth_version=7`, permission version `3`, rule count `0` and zero active overrides.

There were no relevant console or page errors. The initial anonymous refresh 401 before login is expected and excluded.

An intentionally corrupt target created by the backend fail-closed test returned exact `policy_version_conflict` 409. The UI sent no replay, performed one fresh detail GET, closed the attempt and displayed “用户状态已刷新，请重新发起操作。” The successful flow then used a clean fixture target.

At both 390px and 375px, the promotion dialog remained fully inside the viewport and `scrollWidth === clientWidth`. Initial focus was the operation-reason textarea, Escape closed the owned dialog, and the settled screenshots showed no clipped or overlapping content.

## Cross-stack and cleanup evidence

The paired backend real-fixture gate passed migration 0012 down/up, atomic facts, zero-write conflicts, rollback, concurrency, credential invalidation, Gateway Key policy reload and corruption fail-closed tests. The exact temporary services were stopped; containers `porsche-a08-mysql-260909` and `porsche-a08-redis-260909` were removed, and ports 8000/4176 had no listener.

Visible override-at-promotion, commit-unknown recovery and disabled-target branches remain covered by automated contract, store and mounted Element Plus tests rather than live fault injection. External backend `project_manager` written confirmation, production migration, deployment, production acceptance and real business accounts remain `NOT_RUN`.

The 26-item matrix is now 15 `PASS_LIMITED_SCOPE`, 9 `BLOCKED_NOT_IMPLEMENTED`, 1 `BLOCKED_PRODUCT` and 1 `BLOCKED_ENV`. `web-012` remains `in_progress` because 11 non-A08 items are still blocked.

Canonical backend evidence: `/Users/xuzhihao/code/Porsche/.worktrees/a07-managed-user-entitlements/docs/superpowers/reports/validation/2026-09-09-a08-managed-user-roles-permissions/backend/manifest.json`.
