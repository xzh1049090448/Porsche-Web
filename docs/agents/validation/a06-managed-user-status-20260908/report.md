# A06 managed-user status frontend acceptance

Status: `PASS_LIMITED_SCOPE`

- Backend candidate: `08617d400228c224fa2312583fde14f54f7a7686`
- Frontend candidate: `07c7b9e3caa5fe18bd69be74e71f577577943840`
- Contract SHA-256: `c3662b25500879d67c6811fa270d4a6a39a44db812c7c493d6f02e535940b415`

The production adapter sends one strict PATCH and never replays it. Both 409 codes share one owner-bound detail GET. Dialog close, route/identity/permission drift, and a new dialog owner prevent late results and announcements from landing. Disable requires a 1–200 code-point reason and confirmation; enable requires confirmation. Reason state and its native textarea are cleared on close and unmount.

Full Node tests passed `364/364`. Real Element Plus/UserDetail mounted status tests passed `13/13`, including focus, trap, Escape, close/unmount clearing, 200/201 astral code points, validation-stage duplicate suppression, 403/404 recovery, both 409 codes, ineligible fresh-target reconciliation, close/route/identity races, permission-cache preservation, and route-bound visibility. Independent frontend review returned `REVIEW_PASS`. `VITE_USE_MOCK=false npm run build` and `git diff --check` passed. Chrome at 375px and 390px reported no horizontal overflow.

Production deployment, production acceptance, and real business accounts remain `NOT_RUN`. Broader rejected-action auditing remains a separate PRD residual. Backend project-manager written confirmation was not obtained through an external channel in this run.
