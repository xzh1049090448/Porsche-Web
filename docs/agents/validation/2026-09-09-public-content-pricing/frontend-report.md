# Public Content and Pricing Frontend Task 11 Evidence

**Date:** 2026-09-11

**Frontend status:** `PASS_FRONTEND_LOCAL`

**Browser fixture status:** `BLOCKED_FIXTURE`

**Live acceptance status:** `PENDING_LIVE_ACCEPTANCE`

**P08 status:** `BLOCKED_PRODUCT`

## Candidate identity

- Frontend code under test: `8001346bcfcaf16889a967f53b2042993e11fddf` (`fix: isolate root notification ownership`).
- Backend reference revision: `7d7d1dd8d141e2847c431d9c58e07fb53238eb72` (`fix: protect content preview route`).
- Frozen public-content/pricing contract SHA-256: `89e94d93939876a62baeaba0ca0bfcc94dcdc2ee111a4aad4ce8a31db28dfe7e`.
- A03 contract SHA-256: `897fac0ba1a41ac05f72607a56e0e3fc4a5cd6afb0d6027052886bf8c74c894c`.
- A14 contract SHA-256: `514e9a08475e6b15193f653d18f3054bddc0f753228c48af45d88cca1c230986`.

The three contracts were read from the backend `public-content-pricing` worktree and supplied explicitly to the frontend test process. This report does not replace the backend-local report at `docs/superpowers/reports/2026-09-09-public-content-pricing-backend.md` in that repository. The backend records P03-P07 as `PASS_BACKEND_LOCAL`; it does not claim frontend, deployment, production migration, or production acceptance.

## Local verification

| Gate | Result | Evidence |
| --- | --- | --- |
| Full Node suite with `A03_BACKEND_CONTRACT`, `A14_BACKEND_CONTRACT`, `PUBLIC_PRICING_BACKEND_CONTRACT`, and `VITE_USE_MOCK=false` | `PASS` | 511 tests, 511 passed, 0 failed, 0 skipped, 0 cancelled, 0 todo. |
| Production build with `VITE_USE_MOCK=false` | `PASS` | Vite 6.4.3 transformed 2387 modules and completed the production build. The existing Rollup annotation, mixed import, and chunk-size warnings were non-failing. |
| `node scripts/check-public-route-chunks.mjs dist` | `PASS` | 8 public chunks, 194574 JavaScript bytes, 5421 CSS bytes; no forbidden private module entered the public graph. |
| `git diff --check` | `PASS` | Empty output before documentation changes. |

The first sandboxed full-suite attempt reported 510/511 because the real Vite Preview integration test could not bind `127.0.0.1` (`EPERM`). The same complete command was rerun with loopback-listener permission and passed 511/511. Only the successful rerun is pass evidence; the sandbox failure is retained here rather than hidden.

The production environment gate rejected enabled or missing mock mode in its tests, and the successful build used the exact value `VITE_USE_MOCK=false`. Public content validation tests cover the P08 prototype-claim markers and fail closed; these code checks do not approve the actual production copy.

## Bounded feature status

| Requirement | Current status | Boundary |
| --- | --- | --- |
| P01 public pages and published reads | `PASS_FRONTEND_LOCAL` | Router, publication store, independent content/price generations, 404/410 states, and public module isolation passed automated tests. Anonymous browser acceptance was not run. |
| P03 stable `modelKey` and model details | `PASS_FRONTEND_LOCAL` | Encoded stable keys, list/detail/direct-route behavior, strict DTO projection, and published catalog binding passed automated tests. |
| P04 public price units and missing-price rules | `PASS_FRONTEND_LOCAL` | USD per million input/output token labels, decimal strings, provenance, sorting, and missing/redacted states passed automated tests. |
| P05 anonymous price hiding | `PASS_FRONTEND_LOCAL` | Anonymous/authenticated representation partitioning, ETag separation, no-store authenticated reads, and redacted values passed automated tests. CDN and deployed HTML were not inspected. |
| P06 draft, preview, concurrent publish, and restore | `PASS_FRONTEND_LOCAL` | Draft revision ownership, validation binding, preview headers, conflict recovery, immutable history, restore, demotion cleanup, and idempotency paths passed automated tests. No real Root fixture was mutated. |
| P07 rich-text and dangerous URL handling | `PASS_FRONTEND_LOCAL` | Sanitizer parity, stable decoding, executable markup, event handlers, unsafe URLs, remote media, embeds, legal metadata, and controlled assets passed automated tests. |
| P08 production content truth | `BLOCKED_PRODUCT` | Safe-draft and truth gates are implemented and tested, but prices, claims, terms, privacy, brand copy, and final production content still require product/legal approval. |

These statuses describe frontend-local implementation evidence. They do not promote P01 or P03-P07 to full cross-stack or production acceptance.

## Evidence not produced in this task

- Task 11 browser acceptance at 375/768/1440, keyboard focus, route refresh/share, anonymous and Root flows, CRUD/lifecycle, missing detection, publication/history, and notifications was not run. No isolated accounts or mutable test dataset were provisioned under this evidence-only task, and fixture mutation was explicitly excluded. Browser evidence is therefore `BLOCKED_FIXTURE`.
- External live HTTP/browser acceptance was not run. Production HTTPS, CDN/cache behavior, sitemap exposure, reverse-proxy behavior, production database migrations, deployment, rollback, and final cleanup are `PENDING_LIVE_ACCEPTANCE` or retain their existing R02 environment boundary.
- No fixture, account, database, Redis state, deployed asset, or production content was created, changed, or deleted. No push, merge, or deploy was performed.

`web-012` remains `in_progress`. Local code gates are complete for this frontend candidate, while browser fixture acceptance, live cross-stack acceptance, and P08 approval remain open.
