# A05 Task7 r6 frontend joint-acceptance status

**Status: BLOCKED.** r6 supersedes r1–r5 and is not release approval.

r5 provides the independent backend foundation: separate test/runtime stores; A05 service 40 records and DTO/handler/router 71 records passed with zero failures or skips; the fresh runtime had exactly one Root and the real ten-operation HTTP matrix passed, including the exact two-key PATCH/no-replay rule.

r6 created new runtime-only MySQL/Redis resources, applied migrations 0001–0010, bootstrapped Root=1/Admin=1/User=1, and passed private login/detail smoke. Visible local Chrome initially found the login disabled because cross-origin refresh put auth into `uncertain`; a temporary uncommitted same-origin Vite proxy corrected that fixture and login succeeded.

The direct-detail browser gate then failed. Read-only diagnostics found a Root actor with `users.edit` (23 capabilities), active User target at auth version 1, and `canOpenAdminUserEdit=true`. A direct load of `/users/<guid>` still fully reloaded the application, received 403 on `/api/v1/auth/refresh`, and redirected to `/login?redirect=/users/<guid>`. The detail component never rendered, so no A05 PATCH or mutation scenario is claimed. The blocker is session continuity on direct detail refresh, not seed authorization, API projection, target state, or the edit predicate.

No Root/Admin UI mutation, conflict/no-replay, keyboard/focus, responsive width, race, clean-console, adversarial, or browser privacy PASS is claimed. No secrets or user content are recorded. r6 resources and temporary proxy are removed after evidence capture.
