# Joint acceptance core phase — 2026-09-04

Result: **PASS_LIMITED_SCOPE**. The narrowed phase produced five passing checks and no failures.

| Item | Status | Evidence |
| --- | --- | --- |
| A01 | PASS_LIMITED_SCOPE | An ordinary user received HTTP 403 from the admin users read endpoint. In Chrome, direct `/users` showed the no-permission state and no user-table rows. |
| A02 | PASS_LIMITED_SCOPE | Root self detail was 404 and an Admin detail was 200. An Admin saw only ordinary-user rows; its own and Root details were 404, and an ordinary-user detail was 200. |
| A04 | PASS_LIMITED_SCOPE | Verified GUID exact search and the `total`/`items` shape, role/status/deleted filters, all supported sort families, literal percent/underscore search input, and invalid page rejection (400). |
| FE three roles | PASS_LIMITED_SCOPE | Ordinary user, Admin, and Root completed real Chrome login plus `/users` navigation. Root session survived a hard reload; the actual UI logout flow then sent direct `/users` back to login. |

The browser test prevented the shell from invoking the model-list endpoint; it did not invoke chat, model, or SSE upstream functionality. Credentials, tokens, cookies, complete connection URLs, account names, and response records were not written to this evidence.

Raw redacted result: `core-phase-results.json`.

Not executed in this phase: V01, V02, remaining regression/safety items, public-content acceptance, production HTTPS/release checks. Fixture containers and private material were retained; no cleanup ran.
