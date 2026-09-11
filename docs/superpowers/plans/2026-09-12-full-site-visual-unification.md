# Porsche-Web Full-Site Visual Unification Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use `subagent-driven-development` to execute this plan task-by-task when the user selects Subagent-Driven execution. Keep the coordinator, developer, spec reviewer, and quality gate roles distinct as required by `docs/agents/orchestration.md`.

**Goal:** Rebuild every Porsche-Web public, authenticated, and Root administration route on one responsive light/dark visual system derived from the five approved HTML prototypes, while preserving all existing API, authorization, publication, and error-state behavior.

**Architecture:** Introduce a semantic token layer and two shared shells: a public shell for landing/content/pricing routes and a console shell for authenticated routes. Add small reusable presentation components for page headings, toolbars, state badges, and data surfaces. Existing views continue to own stores, requests, permissions, and mutations; this work changes their structure and presentation only.

**Tech Stack:** Vue 3 SFCs, Vue Router, Pinia, Element Plus, SCSS/CSS custom properties, Node test runner, Vue Test Utils, Vite.

---

## Execution rules

- Work only in `/Users/xuzhihao/code/Porsche-Web/.worktrees/full-site-visual-unification` on `design/full-site-visual-unification` unless the coordinator creates a fresh implementation worktree from this branch.
- Before implementation, read `AGENTS.md`, `docs/agents/domain.md`, `docs/agents/orchestration.md`, `feature_list.json`, `progress.md`, and the design spec at `docs/superpowers/specs/2026-09-12-full-site-visual-unification-design.md`, then run `./init.sh` as the authorized writer.
- Treat the five prototype HTML files under `/Users/xuzhihao/Doubao/chats/2026-09-01/new-chat-1/` as visual references only. Do not copy prototype product names, model data, prices, metrics, or legal copy.
- Do not change stores, API contracts, router authorization metadata, backend code, database schemas, or `interface-contract.json` unless a failing preservation test proves an accidental visual coupling and the coordinator approves a separately documented contract change.
- Use test-driven development for every task: add the focused failing test, run it and record RED, implement the smallest change, rerun GREEN, then commit.
- After each batch, run the focused contract tests plus `git diff --check`. Run the full verification only after Task 12.

## Task 1: Freeze route, state, and authorization behavior

**Files:**
- Create: `src/layouts/visual-shell.contract.test.js`
- Modify: `src/router/public-routes.test.js`
- Modify: `src/views/public/public-pages.contract.test.js`
- Modify: `src/views/public/pricing.contract.test.js`
- Test: `src/layouts/visual-shell.contract.test.js`

**Step 1: Write failing preservation tests**

Add a source-level contract test that inventories every route family and asserts that the new shells expose stable landmarks without changing route metadata:

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const read = path => readFile(new URL(path, import.meta.url), 'utf8')

test('public and console shells expose stable accessible landmarks', async () => {
  const [publicLayout, mainLayout, router] = await Promise.all([
    read('./PublicLayout.vue'),
    read('./MainLayout.vue'),
    read('../router/index.js'),
  ])
  assert.match(publicLayout, /class="public-shell"/)
  assert.match(publicLayout, /id="public-content"/)
  assert.match(mainLayout, /class="console-shell"/)
  assert.match(mainLayout, /class="console-sidebar"/)
  assert.match(router, /rootOnly:\s*true/)
  assert.match(router, /requiresAuth:\s*true/)
})
```

Extend the public tests to enumerate loading, empty/preparing, ready, 404, 410, login-required, conflict, and unavailable state identifiers. Retain current stable `modelKey`, token-price, and published-snapshot assertions.

**Step 2: Run the focused tests and confirm RED**

Run: `node --test src/layouts/visual-shell.contract.test.js src/router/public-routes.test.js src/views/public/public-pages.contract.test.js src/views/public/pricing.contract.test.js`

Expected: FAIL because `public-shell` and `console-shell` landmarks do not exist yet; pre-existing route and state assertions remain green.

**Step 3: Record the behavioral baseline**

Document the current route list, auth/root metadata, public state vocabulary, and active test count in the task handoff. Do not change production code in this task.

**Step 4: Commit**

```bash
git add src/layouts/visual-shell.contract.test.js src/router/public-routes.test.js src/views/public/public-pages.contract.test.js src/views/public/pricing.contract.test.js
git commit -m "test: freeze full-site visual behavior contracts"
```

## Task 2: Create the semantic token and foundation layer

**Files:**
- Create: `src/styles/tokens.scss`
- Create: `src/styles/foundations.scss`
- Modify: `src/styles/global.scss`
- Modify: `src/styles/mobile.scss`
- Modify: `src/main.js`
- Modify: `src/layouts/visual-shell.contract.test.js`

**Step 1: Add failing token and accessibility assertions**

Assert that `main.js` imports the two new styles and that the token file contains semantic light/dark values, focus-visible treatment, 44px target size, and reduced-motion behavior. Assert semantic names such as `--color-brand`, `--surface-page`, `--surface-card`, `--text-primary`, `--border-default`, and `--state-success` rather than view-specific aliases.

**Step 2: Run the focused test and confirm RED**

Run: `node --test src/layouts/visual-shell.contract.test.js`

Expected: FAIL because the files and imports are absent.

**Step 3: Implement the tokens**

Use this shape and map Element Plus variables to it:

```scss
:root,
html[data-theme='light'] {
  --color-brand: #2563eb;
  --color-brand-hover: #1d4ed8;
  --surface-page: #f8fafc;
  --surface-card: #ffffff;
  --text-primary: #111827;
  --text-secondary: #4b5563;
  --text-muted: #9ca3af;
  --border-default: #e5e7eb;
  --state-success: #10b981;
  --control-min-size: 44px;
}

html[data-theme='dark'] {
  --color-brand: #3b82f6;
  --surface-page: #0f172a;
  --surface-card: #111827;
  --text-primary: #f8fafc;
  --text-secondary: #94a3b8;
  --border-default: #334155;
}
```

Keep the existing manual theme persistence and system fallback. Move resets, typography, links, `:focus-visible`, screen-reader utilities, and reduced-motion rules into `foundations.scss`. Reduce `global.scss` to imports and app-wide layout rules; remove duplicate public token definitions only after all consumers use the semantic names.

**Step 4: Run tests and commit**

Run: `node --test src/layouts/visual-shell.contract.test.js src/stores/settings.test.js src/stores/theme.test.js`

If a listed test file does not exist, run the existing theme/store tests returned by `rg --files src/stores | rg 'theme|settings'` and record the exact command.

```bash
git add src/styles/tokens.scss src/styles/foundations.scss src/styles/global.scss src/styles/mobile.scss src/main.js src/layouts/visual-shell.contract.test.js
git commit -m "feat: add shared visual design foundations"
```

## Task 3: Build the console shell and shared page primitives

**Files:**
- Create: `src/components/shell/AppBrand.vue`
- Create: `src/components/shell/ConsoleSidebar.vue`
- Create: `src/components/shell/PageHeader.vue`
- Create: `src/components/shell/SurfaceCard.vue`
- Create: `src/components/shell/StatusBadge.vue`
- Create: `src/styles/console-shell.scss`
- Modify: `src/layouts/MainLayout.vue`
- Modify: `src/main.js`
- Modify: `src/layouts/visual-shell.contract.test.js`

**Step 1: Write failing shell tests**

Test structural behavior rather than raw color strings: one topbar, one permission-filtered sidebar, a mobile drawer using the same navigation source, `main` content landmark, grouped Root navigation, and accessible active-item markup. Add a test ensuring Root links still use `v-if="isRoot"` and user management still uses `canManageUsers`.

**Step 2: Run and confirm RED**

Run: `node --test src/layouts/visual-shell.contract.test.js src/views/public-model-admin.contract.test.js src/views/root-notifications.contract.test.js`

**Step 3: Extract a single navigation model**

In `MainLayout.vue`, expose one computed list consumed by desktop sidebar and mobile drawer:

```js
const navigation = computed(() => [
  { to: '/chat', label: t('nav.chat'), group: 'workspace', visible: true },
  { to: '/billing', label: t('nav.billing'), group: 'workspace', visible: true },
  { to: '/users', label: t('nav.users'), group: 'administration', visible: canManageUsers.value },
  { to: '/admin/public-models', label: t('publicModelsAdmin.nav'), group: 'root', visible: isRoot.value },
].filter(item => item.visible))
```

Preserve all existing entries and commands. Render a 56px topbar, 240px desktop sidebar, mobile drawer, and scrollable workspace. Keep `AuthStatus`, account commands, Token/plan summaries, locale toggle, theme toggle, and route back behavior.

**Step 4: Add shared primitives**

`PageHeader` accepts eyebrow, title, description, and an actions slot. `SurfaceCard` provides consistent border/padding only. `StatusBadge` accepts a semantic status and renders text as well as color. Do not move request or mutation logic into these components.

**Step 5: Run tests and commit**

Run: `node --test src/layouts/visual-shell.contract.test.js src/views/public-model-admin.contract.test.js src/views/root-notifications.contract.test.js`

```bash
git add src/components/shell src/styles/console-shell.scss src/layouts/MainLayout.vue src/main.js src/layouts/visual-shell.contract.test.js
git commit -m "feat: rebuild authenticated console shell"
```

## Task 4: Rebuild the public shell

**Files:**
- Create: `src/styles/public-shell.scss`
- Modify: `src/layouts/PublicLayout.vue`
- Modify: `src/components/public/PublicHeader.vue`
- Modify: `src/components/public/PublicFooter.vue`
- Modify: `src/components/public/PublicContentState.vue`
- Modify: `src/main.js`
- Modify: `src/views/public/public-pages.contract.test.js`
- Modify: `src/layouts/visual-shell.contract.test.js`

**Step 1: Write failing public-shell tests**

Assert a 56px header, skip link, desktop navigation, mobile toggle with `aria-expanded`, locale/theme controls, console CTA, `main` landmark, and footer. Mount `PublicHeader` to verify opening the mobile menu updates `aria-expanded` and route selection closes it.

**Step 2: Run and confirm RED**

Run: `node --test src/layouts/visual-shell.contract.test.js src/views/public/public-pages.contract.test.js`

**Step 3: Implement the public shell**

Move all public shell CSS out of `PublicLayout.vue` and remove duplicate public rules from `global.scss`/`mobile.scss`. Use shared tokens and keep `createPublicLayoutPublication`, its provided publication lifecycle, and RouterView behavior unchanged.

Use the existing route/i18n data for labels. The mobile button must follow this contract:

```vue
<button
  class="public-nav-toggle"
  type="button"
  :aria-expanded="menuOpen"
  :aria-controls="navId"
  @click="menuOpen = !menuOpen"
>
  <span class="sr-only">{{ t('menu') }}</span>
</button>
```

**Step 4: Verify and commit**

Run: `node --test src/layouts/visual-shell.contract.test.js src/views/public/public-pages.contract.test.js src/i18n/public-runtime.test.js`

```bash
git add src/styles/public-shell.scss src/layouts/PublicLayout.vue src/components/public/PublicHeader.vue src/components/public/PublicFooter.vue src/components/public/PublicContentState.vue src/main.js src/views/public/public-pages.contract.test.js src/layouts/visual-shell.contract.test.js
git commit -m "feat: rebuild public site shell"
```

## Task 5: Recompose landing, about, legal, and error pages

**Files:**
- Create: `src/components/public/HeroPreview.vue`
- Create: `src/components/public/PublicSection.vue`
- Create: `src/styles/public-content.scss`
- Modify: `src/views/public/Home.vue`
- Modify: `src/views/public/About.vue`
- Modify: `src/views/public/LegalPage.vue`
- Modify: `src/views/PublicNotFound.vue`
- Modify: `src/views/PublicContentPreview.vue`
- Modify: `src/views/public/public-pages.contract.test.js`

**Step 1: Add failing content-composition tests**

Assert that the homepage uses published content injection and composes Hero, feature cards, model wall, announcement/FAQ, CTA, and footer-compatible sections. Assert the safe preview contains no real key/user/chat data. Assert About/Legal retain sanitized rich text and metadata, and preview shows a visible preview banner.

Add negative assertions for prototype-only strings:

```js
for (const forbidden of ['ModelHub', '40+', '100%', 'MIT License']) {
  assert.doesNotMatch(sourceBundle, new RegExp(forbidden.replace('+', '\\+')))
}
```

**Step 2: Run and confirm RED**

Run: `node --test src/views/public/public-pages.contract.test.js src/router/public-content-preview.contract.test.js`

**Step 3: Implement the approved landing system**

Build the dot-grid/glow Hero, two-column desktop composition, safe capability preview, three-column benefits, model wall, announcement/FAQ, CTA, and document layout. Continue rendering `preparing` when published content is missing. Use one-column mobile layouts and disable decorative motion under reduced-motion.

**Step 4: Verify and commit**

Run: `node --test src/views/public/public-pages.contract.test.js src/router/public-content-preview.contract.test.js src/i18n/public-runtime.test.js`

```bash
git add src/components/public/HeroPreview.vue src/components/public/PublicSection.vue src/styles/public-content.scss src/views/public/Home.vue src/views/public/About.vue src/views/public/LegalPage.vue src/views/PublicNotFound.vue src/views/PublicContentPreview.vue src/views/public/public-pages.contract.test.js
git commit -m "feat: align public content pages with approved prototype"
```

## Task 6: Rebuild public pricing and stable model detail

**Files:**
- Create: `src/styles/public-pricing.scss`
- Modify: `src/views/public/Pricing.vue`
- Modify: `src/views/public/ModelPricingDetail.vue`
- Modify: `src/components/public/PricingFilters.vue`
- Modify: `src/components/public/PricingTable.vue`
- Modify: `src/components/public/PricingCards.vue`
- Modify: `src/views/public/pricing.contract.test.js`
- Modify: `src/views/public/Pricing.mounted.test.js`

**Step 1: Write failing layout and behavior tests**

Mount the pricing page at desktop and mobile breakpoint states. Assert desktop has a 260px filter aside and table, mobile has filter drawer and cards, encoded `modelKey` links remain stable, numeric sort stays gated for anonymous hidden prices, and only input/output token prices are rendered.

Add negative assertions for per-call pricing labels and zero substitution of null prices.

**Step 2: Run and confirm RED**

Run: `node --test src/views/public/pricing.contract.test.js src/views/public/Pricing.mounted.test.js src/utils/public-pricing-query.test.js src/utils/public-catalog.test.js`

**Step 3: Implement pricing list and detail**

Use a maximum 1600px container, 260px filter rail, compact result toolbar/table, and the existing filters/query mapper. At widths below 768px, switch to cards and a filter drawer. Detail pages render back link, display name, stable key, two price cards, metadata list, disclaimer, and console CTA through existing contract state branches.

**Step 4: Verify and commit**

Run: `node --test src/views/public/pricing.contract.test.js src/views/public/Pricing.mounted.test.js src/utils/public-pricing-query.test.js src/utils/public-catalog.test.js src/api/public-content-pricing-contract.test.js`

```bash
git add src/styles/public-pricing.scss src/views/public/Pricing.vue src/views/public/ModelPricingDetail.vue src/components/public/PricingFilters.vue src/components/public/PricingTable.vue src/components/public/PricingCards.vue src/views/public/pricing.contract.test.js src/views/public/Pricing.mounted.test.js
git commit -m "feat: rebuild public pricing experience"
```

## Task 7: Align authentication, chat, billing, API keys, and profile

**Files:**
- Create: `src/styles/console-pages.scss`
- Modify: `src/views/Login.vue`
- Modify: `src/views/Register.vue`
- Modify: `src/views/Chat.vue`
- Modify: `src/views/Billing.vue`
- Modify: `src/views/ApiKeys.vue`
- Modify: `src/views/Profile.vue`
- Modify: `src/components/chat/ChatSidebar.vue`
- Modify: `src/components/chat/ChatMessageList.vue`
- Modify: `src/components/chat/ChatInput.vue`
- Modify: `src/components/chat/ModelPanel.vue`
- Create: `src/views/console-pages.visual.contract.test.js`

**Step 1: Add failing visual-preservation tests**

Assert all six pages use the shared page/surface classes. Preserve login redirect, auth status, API-key secret presentation, billing data mapping, chat streaming/cancel controls, and profile state identifiers. The tests must reject new hardcoded tokens or credentials.

**Step 2: Run and confirm RED**

Run: `node --test src/views/console-pages.visual.contract.test.js src/views/Login.redirect.test.js src/views/Login.auth-status.test.js src/stores/chat.test.js src/utils/gateway-token-presentation.test.js`

**Step 3: Implement page compositions**

- Login/Register: centered auth surface using the dashboard visual language, shared brand/theme/language behavior, existing validation and redirects.
- Chat: shared shell colors/controls while retaining long-form streaming workspace, conversation rail, model panel, abort, and error behavior.
- Billing/Profile: `PageHeader` plus section cards and semantic stat blocks.
- API keys: token-prototype toolbar/table/cards while retaining one-time secret display and copy behavior.

Do not alter component events, store calls, API modules, or success timing.

**Step 4: Run focused suites and commit**

Run: `node --test src/views/console-pages.visual.contract.test.js src/views/Login.redirect.test.js src/views/Login.auth-status.test.js src/stores/chat.test.js src/utils/gateway-token-presentation.test.js src/api/profile-state.test.js`

```bash
git add src/styles/console-pages.scss src/views/Login.vue src/views/Register.vue src/views/Chat.vue src/views/Billing.vue src/views/ApiKeys.vue src/views/Profile.vue src/components/chat src/views/console-pages.visual.contract.test.js
git commit -m "feat: unify core console pages"
```

## Task 8: Align user administration without weakening action safety

**Files:**
- Modify: `src/views/Users.vue`
- Modify: `src/views/UserDetail.vue`
- Create: `src/views/users.visual.contract.test.js`
- Test: `src/views/admin-user-status.contract.test.js`
- Test: `src/views/admin-user-delete.contract.test.js`
- Test: `src/views/UserDetail.roles-permissions.integration.test.js`
- Test: `src/views/UserDetail.entitlements.integration.test.js`

**Step 1: Add failing visual contract tests**

Assert the list follows the approved users prototype: shared page header, filter toolbar, readable table, pagination, mobile overflow/card fallback, semantic status badges, and visible action labels. Assert detail sections and mutation dialogs retain action ownership, confirmation, recovery, and focus restoration markers.

**Step 2: Run and confirm RED**

Run: `node --test src/views/users.visual.contract.test.js src/views/admin-user-status.contract.test.js src/views/admin-user-delete.contract.test.js src/views/UserDetail.roles-permissions.contract.test.js`

**Step 3: Recompose the views**

Replace page-local header/card/filter/table styling with shared primitives. Keep all `can*` predicates, verification tickets, action tokens, revision guards, soft-delete semantics, pending/failed states, and focus restoration unchanged.

**Step 4: Run the complete user-admin suite and commit**

Run: `node --test src/views/users.visual.contract.test.js src/views/admin-user-*.test.js src/views/UserDetail.*.test.js src/stores/admin-user-*.test.js src/api/admin-user-*.test.js`

Expected: all matching tests pass; shell glob expansion must be reviewed before execution and the exact resolved files recorded.

```bash
git add src/views/Users.vue src/views/UserDetail.vue src/views/users.visual.contract.test.js
git commit -m "feat: align user administration visuals"
```

## Task 9: Align public model and pricing administration

**Files:**
- Modify: `src/views/PublicModelsAdmin.vue`
- Modify: `src/views/PublicModelDetail.vue`
- Modify: `src/views/PublicPricingAdmin.vue`
- Modify: `src/components/public-admin/PublicModelForm.vue`
- Modify: `src/components/public-admin/MissingModelsPanel.vue`
- Modify: `src/components/public-admin/PriceSnapshotHistory.vue`
- Modify: `src/components/public-admin/PricingDiff.vue`
- Modify: `src/components/public-admin/PublicationChecks.vue`
- Modify: `src/views/public-model-admin.contract.test.js`
- Modify: `src/views/public-pricing-admin.contract.test.js`

**Step 1: Add failing shared-layout assertions**

Require PageHeader, toolbar, SurfaceCard, StatusBadge, table/pagination, responsive dialog/drawer classes, and text labels for state. Preserve Root-only navigation, immutable identifiers, nullable token prices, missing-model detection, inactive versus soft-deleted state, revision conflicts, publication checks, snapshot history, and no deleted-item filter.

**Step 2: Run and confirm RED**

Run: `node --test src/views/public-model-admin.contract.test.js src/views/public-pricing-admin.contract.test.js src/views/PublicModelDetail.mounted.test.js src/views/public-pricing-admin.mounted.test.js src/components/public-admin/PublicModelForm.mounted.test.js`

**Step 3: Recompose admin pages**

Apply the token-prototype hierarchy and shared primitives. Keep input/output price fields only. Do not introduce per-call price controls. Keep soft deletion separate from inactive status and do not expose deleted-item browsing.

**Step 4: Verify and commit**

Run the same command from Step 2 plus `node --test src/components/public-admin/pricing-diff.test.js src/utils/public-model-form.test.js src/utils/public-model-admin-route-query.test.js`.

```bash
git add src/views/PublicModelsAdmin.vue src/views/PublicModelDetail.vue src/views/PublicPricingAdmin.vue src/components/public-admin src/views/public-model-admin.contract.test.js src/views/public-pricing-admin.contract.test.js
git commit -m "feat: unify model and pricing administration"
```

## Task 10: Align public content administration and Root notifications

**Files:**
- Modify: `src/views/PublicContentAdmin.vue`
- Modify: `src/views/PublicContentPreview.vue`
- Modify: `src/views/RootNotifications.vue`
- Modify: `src/components/public-admin/SafeMarkdownEditor.vue`
- Modify: `src/components/public-admin/ContentReleaseHistory.vue`
- Modify: `src/components/RootNotificationBadge.vue`
- Modify: `src/views/public-content-admin.mounted.test.js`
- Modify: `src/views/root-notifications.contract.test.js`
- Modify: `src/views/root-notifications.mounted.test.js`

**Step 1: Write failing composition tests**

Assert draft editor, preview marker, validation, publish/restore controls, conflict state, release history, notification list, read/unread state, and future-email todo copy remain present. Require shared page primitives and responsive layout markers.

**Step 2: Run and confirm RED**

Run: `node --test src/views/public-content-admin.mounted.test.js src/router/public-content-preview.contract.test.js src/views/root-notifications.contract.test.js src/views/root-notifications.mounted.test.js src/utils/public-content-validation.test.js src/utils/public-document.test.js`

**Step 3: Implement the visual migration**

Use the token-prototype management layout for editor/history/notifications and the public shell for preview. Preserve sanitized rendering, dangerous URL rules, draft/revision tokens, atomic publication states, and server-confirmed success behavior. Leave P08 production copy pending and keep the email push item as a todo rather than simulating delivery.

**Step 4: Verify and commit**

Run the command from Step 2.

```bash
git add src/views/PublicContentAdmin.vue src/views/PublicContentPreview.vue src/views/RootNotifications.vue src/components/public-admin/SafeMarkdownEditor.vue src/components/public-admin/ContentReleaseHistory.vue src/components/RootNotificationBadge.vue src/views/public-content-admin.mounted.test.js src/views/root-notifications.contract.test.js src/views/root-notifications.mounted.test.js
git commit -m "feat: unify content and notification administration"
```

## Task 11: Browser visual and accessibility regression

**Files:**
- Create: `docs/agents/validation/2026-09-12-full-site-visual-browser-matrix.md`
- Modify: production files only if a concrete browser defect is reproduced with a failing test first

**Step 1: Start the local application with safe data**

Use the repository-supported mock or local API configuration documented by `./init.sh`. Never place credentials in commands or reports. Record the URL and exact revision.

**Step 2: Check the complete route matrix**

Use Playwright and the `playwright-skill` workflow to inspect at least 375x812, 768x1024, and 1440x900 in light and dark themes. Cover:

- `/`, `/about`, `/terms`, `/privacy`, public 404
- `/pricing`, one `/pricing/:modelKey` state
- `/login`, `/register`
- `/chat`, `/billing`, `/api-keys`, `/profile`
- `/users`, one `/users/:guid`
- all `/admin/public-*` routes and `/admin/notifications`

For each family, verify keyboard focus, mobile navigation/drawer, readable overflow, dialog bounds, loading/empty/error surfaces, and absence of prototype fixture content. Capture representative screenshots, but do not commit secrets or user data.

**Step 3: Fix only reproduced defects with TDD**

For each defect, add a focused contract or mounted test, demonstrate RED, implement, rerun GREEN, then repeat the affected browser case.

**Step 4: Write and commit the evidence report**

The report must identify tested revision, viewport/theme/language, route/state, result, and any skipped live-data state. Do not turn a skipped state into PASS.

```bash
git add docs/agents/validation/2026-09-12-full-site-visual-browser-matrix.md
git commit -m "test: record full-site visual browser regression"
```

## Task 12: Full verification, project records, and independent review gates

**Files:**
- Modify: `feature_list.json`
- Modify: `progress.md`
- Create: external private task files for scope/baseline/snapshot; do not store them inside the worktree
- Create or modify: validation report paths selected by the coordinator

**Step 1: Run repository verification**

```bash
npm test
VITE_USE_MOCK=false npm run build
git diff --check
```

Expected: all tests pass; production build succeeds; no whitespace errors. Record Rollup warnings accurately and distinguish warnings from failures.

**Step 2: Verify production-bundle exclusions**

Inspect the production bundle for prototype fixture strings, mock routes, secrets, and test-only content using the repository bundle checker plus focused `rg` against `dist`. Do not claim absence based only on build success.

**Step 3: Update project records**

Update `feature_list.json` with scope, status, and exact validation commands/results. Update `progress.md` with implementation revision, preserved boundaries, browser matrix, remaining P08 content work, future email notification todo, and the fact that deployment/live acceptance were not performed.

Validate JSON:

```bash
node -e "JSON.parse(require('node:fs').readFileSync('feature_list.json','utf8')); console.log('feature_list valid')"
```

**Step 4: Commit final implementation records**

```bash
git add feature_list.json progress.md
git commit -m "docs: record full-site visual verification"
```

**Step 5: Generate the canonical review snapshot**

The coordinator defines a non-overlapping scope JSON covering every modified implementation, test, and documentation path. The authorized writer persists baseline/snapshot bytes into a new private directory outside the worktree, following `docs/agents/orchestration.md` exactly:

```bash
python3 docs/agents/review_snapshot.py baseline --scope <scope.json> --contract interface-contract.json --output -
python3 docs/agents/review_snapshot.py snapshot --scope <scope.json> --baseline <private-task-dir>/baseline.json --contract interface-contract.json --output -
python3 docs/agents/review_snapshot.py verify --scope <scope.json> --baseline <private-task-dir>/baseline.json --snapshot <private-task-dir>/snapshot.json --contract interface-contract.json
```

Persist raw stdout bytes with exclusive file creation; do not redirect over existing files and do not place baseline/snapshot files in the worktree.

**Step 6: Run independent reviews in order**

1. `front_end_project_coordinator` publishes the Explorer handoff and exact snapshot ID.
2. `front_end_spec_compliance_reviewer` reviews the final implementation and unchanged `interface-contract.json`; require `SPEC_PASS` bound to the snapshot ID and revision.
3. `front_end_quality_gate` runs only after the bound `SPEC_PASS`; require the quality result to name the same snapshot ID and revision.
4. Any code, test, configuration, documentation, or contract diff invalidates both reviews. Return fixes to the original `front_end_developer`, regenerate the snapshot, and restart spec review before quality review.

**Step 7: Prepare integration without deploying**

Summarize commits, test/build/browser evidence, review results, known warnings, P08 content todo, email notification todo, and deployment boundary. Use `finishing-a-development-branch` only after all gates pass. Push, PR creation, merge, migration, deployment, and live acceptance require their own explicit execution step.

