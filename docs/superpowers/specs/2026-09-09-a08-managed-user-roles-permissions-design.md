# A08 managed-user role and permission writes frontend design

Status: `AGREED_FOR_IMPLEMENTATION`

Chosen approach: mixed endpoint contract (user selection `1`, 2026-09-09)

Contract revision: `2026-09-09-a08-v1`

The canonical cross-stack design is maintained in the paired Porsche backend repository at `docs/superpowers/specs/2026-09-09-a08-managed-user-roles-permissions-design.md`. This companion freezes the frontend boundary that must match that revision. It does not mark A08, `web-012`, the 26-case joint matrix or deployment complete.

## Scope

A08 adds mounted Root-only controls for User-to-Admin promotion, Admin-to-User demotion and complete Admin permission-override replacement. It excludes arbitrary role creation, Root mutation, self-role changes, amount/quota Mock work, public content, model ACL editing, session-management UI, deployment and production acceptance.

## API lifecycle

Promote and demote use:

- `POST /admin/v2/action-verifications`
- `POST /admin/v2/users/{guid}/actions`
- exact-scope `GET /admin/v2/operations?scope=users.promote`
- exact-scope `GET /admin/v2/operations?scope=users.demote`

Permission replacement uses:

- existing catalog and target-permission GETs;
- `POST /admin/v2/action-verifications`;
- verified and idempotent `PATCH /admin/v2/users/{guid}/permissions`;
- exact-scope `GET /admin/v2/operations?scope=users.permissions.write`.

All three mutations require one original `Idempotency-Key`, one single-use `X-Action-Ticket`, strict request DTOs and the expected auth/policy/catalog versions defined by contract revision `2026-09-09-a08-v1`. Neither Issue nor mutation is automatically replayed.

## Mounted controls and dialogs

- Root viewing a User sees “提升为管理员”.
- Root viewing an Admin sees “权限设置” and “降级为普通用户”.
- Self and Root targets expose none of these controls.
- Capability-driven visibility never substitutes for backend authorization.

Promotion defaults to the Admin baseline and may expand a permission editor. The editor groups capabilities and displays the three input states `inherit`, `allow`, `deny`, final effective value and source. Unknown, unavailable and Root-only grants cannot be serialized.

Demotion warns that Admin permissions stop applying and all sessions become invalid. Permission save carries the same session-invalidating warning. Each dialog requires a normalized reason and the Root actor's current password for ticket issuance.

Dialogs support keyboard submission only through their owned form, focus trapping, focus restoration, field-specific validation, disabled in-flight submission and narrow viewport layout. Failures keep nonsecret policy/reason input while clearing password and ticket material.

## State ownership and recovery

Password, ticket and idempotency key remain memory-only. They never enter Pinia persistence, `localStorage`, `sessionStorage`, URL state, analytics or ordinary logs. Closing, superseding or completing a dialog clears them.

A response without a trusted terminal result moves to “结果待确认”. The client performs only the allowed Query with the original key and exact scope; it does not repeat Issue or mutation. Processing obeys `Retry-After`. Pending recovery stops polling. A trusted succeeded result supplies target GUID, resulting role, auth version and permissions version.

After trusted success, the page performs one owned detail/permissions refresh. A late result applies only when route, target GUID, identity epoch, capability revision, expected versions and dialog owner still match. A 409 performs at most one owned refresh, displays the conflict and requires a new gesture. The UI never changes role or policy optimistically.

## Client decomposition

- Add a contract adapter for role and permission actions; reuse shared ticket, idempotency and operation-query primitives without weakening existing A14/A07 exact scopes.
- Keep catalog normalization and permission serialization in API/domain utilities, not Vue templates.
- Implement separate promote, demote and permission dialogs with a shared permission editor where behavior is truly identical.
- Let the user-detail page own target identity and refresh epochs; dialogs own only their current attempt.
- Refresh actor capabilities only if a future contract allows self-target changes; A08 forbids self-target changes.

## Acceptance boundary

Frontend acceptance covers exact DTO/header/query mapping, Root-only eligibility, locked Root-only capability rows, full-policy serialization, browser-visible success/conflict/commit-unknown states, no automatic mutation replay, stale-result rejection, secret scans, keyboard/focus behavior, 375px/390px layouts, full tests and production build. Real MySQL/Redis role/policy transitions, old credential rejection and Gateway Key current-owner authorization are cross-stack acceptance requirements and cannot be replaced with frontend Mock evidence.

The user approved this written specification on 2026-09-09. Implementation must follow the paired TDD plan and exact backend contract revision; final cross-stack evidence and external backend `project_manager` confirmation remain separately pending.
