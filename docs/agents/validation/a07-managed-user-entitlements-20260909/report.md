# A07 frontend local joint acceptance

Status: `PASS_LIMITED_SCOPE`

Frontend code under test is `41648181ab42fb46fe7d45663e746121956b50b8`; backend code under test is `a600a0815b5eab5203333755a2466788fe67d61a`. The byte-identical shared contract SHA-256 is `9e1969b238911b6eee5b6aa85ed364e795a6854f0a026daac5d15e2ab78851be`.

The configured full suite passed 395/395 with zero skips, and the production build passed. Visible Chrome at 375px and 390px verified all three dialogs, first-Escape close for focused selects, focus trapping and owned restoration, mutual exclusion, secret clearing, and no overflow or page errors. Conflict recovery performs at most one owned detail GET, applies the shared result for the same owner, and rejects late results after ownership changes. Mounted tests cover success, duplicate 409, late ownership, 401, focus restoration, and pending recovery. Independent final review returned `FRONTEND_REVIEW_PASS`.

The backend canonical report is `docs/superpowers/reports/validation/2026-09-09-a07-managed-user-entitlements/manifest.json` in the Porsche repository. Gateway Key plan/quota consumption and every production operation remain outside this local frontend acceptance.
