# Open Issue resolution design

Approved by the user on 2026-09-02 after product-manager review.

## Scope and order

1. Porsche #2: verify the existing safe slash model-ID, query-detail and empty-array implementation on current main. Do not duplicate that implementation, broaden ACLs, change production configuration or call a paid upstream. Local isolated MySQL tests and fake-upstream protocol checks are allowed. Real upstream acceptance remains a separate authorization/environment gate.
2. Porsche-Web #3: load the initially selected conversation's historical messages without a second click. Preserve GUID strings, selection, empty-account behavior and streaming state. A slow response or 404 for a previously selected conversation must not remove or select another conversation. Failed detail loading must not be treated as successfully loaded history.
3. Porsche-Web #4: copy the once-displayed API key using native Clipboard first, with a compatibility fallback when unavailable/rejected. Only report success on confirmed copy. Preserve a selectable read-only secret when both fail, reject empty values, clean temporary DOM nodes and clear the secret when the dialog closes/unmounts. Do not log or store the secret, relax HTTPS/auth policy, or change unrelated copy buttons.

## Delivery boundaries

Work on `fix/open-issue-resolution` in isolated worktrees. One active task at a time per repository. Keep the old broad authentication tracking item pending rather than claiming that its entire scope was retested. Add issue-specific tracking for narrow fixes. Implement each frontend issue with regression-first tests, full tests/build, local browser probes and independent product/spec then security/quality review. Production browser/upstream acceptance is explicitly distinguished from local mocked API browser tests.

No push, merge, deployment, production account mutation, real API-key creation, or GitHub issue closure in this implementation turn. Local commits and an evidence-backed handoff are authorized. Preserve unrelated root-worktree modifications and backups.

## Acceptance

- #3: populated history on first visit and reload; no duplicate initial detail fetch; empty list retains new-conversation behavior; slow A response cannot steal B selection; failed/missing A cannot delete B or inject A into B; messages stay associated with the requested GUID.
- #4: native success, unavailable API, native rejection, fallback false/throw, empty secret, cleanup, manual selection and dialog clearing. Browser tests use dummy secrets only and do not touch the user's clipboard outside a dedicated test context.
- #2: safe slash catalog/detail; exact short-name mismatch denied; empty and fully filtered lists serialize as arrays; user/token ACL denial makes no upstream request; encoded/dot-segment IDs remain rejected. No skipped MySQL tests in the claimed isolated integration run.
