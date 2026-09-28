# Public Content and Pricing Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add PRD-aligned anonymous public pages plus a Root-only model-pricing, content-publication, snapshot-history, and notification interface backed exclusively by the frozen backend contract.

**Architecture:** Split anonymous pages into a lazy `PublicLayout` and move authenticated chat to `/chat` under `MainLayout`. Keep API projection, URL state, pricing formatting, draft state, and admin components in focused modules. The client never invents model or price data and never exposes deleted models.

**Tech Stack:** Vue 3, Vue Router, Pinia, Element Plus, Axios, DOMPurify, Marked, Vite, Node test runner.

---

### Task 1: Import and enforce the backend contract

**Files:**
- Create: `src/api/public-content-pricing-contract.test.js`
- Modify: `interface-contract.json`

- [ ] **Step 1: Write a failing explicit-path contract test**

Require `PUBLIC_PRICING_BACKEND_CONTRACT`, compare every public/admin route and DTO, assert USD/million-token input/output only, Root-only mutations, no deleted-list endpoint, and stable 404/410 codes.

```js
test('frontend public pricing contract matches backend', () => {
  const path = process.env.PUBLIC_PRICING_BACKEND_CONTRACT
  assert.ok(path, 'missing_PUBLIC_PRICING_BACKEND_CONTRACT')
  assert.deepEqual(readBackend(path).interfaces, readFrontend().interfaces)
})
```

- [ ] **Step 2: Run RED**

Run: `PUBLIC_PRICING_BACKEND_CONTRACT=/Users/xuzhihao/code/Porsche/.worktrees/public-content-pricing/docs/agents/contracts/public-content-pricing-v1.json node --test src/api/public-content-pricing-contract.test.js`  
Expected: FAIL until frontend contract entries exist.

- [ ] **Step 3: Add exact frontend contract entries**

Do not infer a sibling checkout. The environment path is mandatory in the contract test.

- [ ] **Step 4: Run GREEN and commit**

```bash
PUBLIC_PRICING_BACKEND_CONTRACT=/Users/xuzhihao/code/Porsche/.worktrees/public-content-pricing/docs/agents/contracts/public-content-pricing-v1.json node --test src/api/public-content-pricing-contract.test.js
git add interface-contract.json src/api/public-content-pricing-contract.test.js
git commit -m "docs: align public pricing contract"
```

### Task 2: Establish public/authenticated route boundaries

**Files:**
- Create: `src/layouts/PublicLayout.vue`
- Create: `src/views/PublicNotFound.vue`
- Create: `src/router/public-routes.test.js`
- Modify: `src/router/index.js`
- Modify: `src/layouts/MainLayout.vue`
- Modify: `src/utils/auth-redirect.js`
- Modify: `src/utils/auth-redirect.test.js`

- [ ] **Step 1: Write RED route tests**

Assert `/` is public, chat is `/chat`, public 404 does not redirect, existing authenticated routes remain, login defaults to `/chat`, and unsafe external/protocol-relative/encoded redirects are rejected.

- [ ] **Step 2: Run RED**

Run: `node --test src/router/public-routes.test.js src/utils/auth-redirect.test.js`  
Expected: FAIL on current root-chat and wildcard redirect behavior.

- [ ] **Step 3: Implement lazy route/layout split**

Add named public routes before the catch-all. Change MainLayout chat menu/back fallback to `/chat`. Preserve `/profile`, `/billing`, `/api-keys`, and `/users` behavior.

- [ ] **Step 4: Run GREEN and commit**

```bash
node --test src/router/public-routes.test.js src/utils/auth-redirect.test.js
git add src/router src/layouts/PublicLayout.vue src/layouts/MainLayout.vue src/views/PublicNotFound.vue src/utils/auth-redirect*
git commit -m "feat: add public route boundary"
```

### Task 3: Add public API and projection utilities

**Files:**
- Create: `src/api/publicContent.js`
- Create: `src/api/publicContent.test.js`
- Create: `src/utils/public-catalog.js`
- Create: `src/utils/public-catalog.test.js`
- Create: `src/stores/publicContent.js`

- [ ] **Step 1: Write RED mapper/API tests**

Cover safe DTO projection, ETag/version retention, exact decimal strings, missing prices, reference disclaimer, stable model keys, 404/410, no internal/upstream routing fields, request cancellation, and distinct loading/empty/error states.

- [ ] **Step 2: Run RED**

Run: `node --test src/api/publicContent.test.js src/utils/public-catalog.test.js`  
Expected: module-not-found failure.

- [ ] **Step 3: Implement API, mapper, and Pinia store**

Use the existing request client. Do not import chat catalog constants or mock data. Store one publication generation and reject mixed-generation page/model data.

- [ ] **Step 4: Run GREEN and commit**

```bash
node --test src/api/publicContent.test.js src/utils/public-catalog.test.js
git add src/api/publicContent* src/utils/public-catalog* src/stores/publicContent.js
git commit -m "feat: load published public content"
```

### Task 4: Build homepage and legal/about pages

**Files:**
- Create: `src/views/public/Home.vue`
- Create: `src/views/public/About.vue`
- Create: `src/views/public/LegalPage.vue`
- Create: `src/components/public/PublicHeader.vue`
- Create: `src/components/public/PublicFooter.vue`
- Create: `src/components/public/PublicContentState.vue`
- Create: `src/views/public/public-pages.contract.test.js`
- Modify: `src/i18n/messages.js`
- Modify: `src/styles/global.scss`
- Modify: `src/styles/mobile.scss`

- [ ] **Step 1: Write RED component-source contracts**

Require PRD section order, safe missing-link omission, explicit demo labels, console CTA behavior, published announcements/version read-state, legal version/effective date, preparation/empty/error/retry states, semantic headings, and no prototype claims.

- [ ] **Step 2: Run RED**

Run: `node --test src/views/public/public-pages.contract.test.js`  
Expected: FAIL because components are absent.

- [ ] **Step 3: Implement public shell and pages**

Use `#2563EB`, `#F8FAFC`, white 16px cards, accessible status text, configured links only, and lazy imports. Do not use `href="#"`.

- [ ] **Step 4: Run GREEN and production build**

Run: `node --test src/views/public/public-pages.contract.test.js`  
Run: `VITE_USE_MOCK=false npm run build`  
Expected: PASS; public entry does not eagerly import management modules.

- [ ] **Step 5: Commit**

```bash
git add src/views/public src/components/public src/i18n/messages.js src/styles
git commit -m "feat: build public site pages"
```

### Task 5: Build pricing list and stable detail

**Files:**
- Create: `src/views/public/Pricing.vue`
- Create: `src/views/public/ModelPricingDetail.vue`
- Create: `src/components/public/PricingFilters.vue`
- Create: `src/components/public/PricingTable.vue`
- Create: `src/components/public/PricingCards.vue`
- Create: `src/utils/public-pricing-query.js`
- Create: `src/utils/public-pricing-query.test.js`
- Create: `src/views/public/pricing.contract.test.js`

- [ ] **Step 1: Write RED query and page tests**

Cover URL search/provider/capability/endpoint/page/page-size/sort, 20/50/100 bounds, same-unit numeric sorting, missing-price labels, USD/million-token text, reference disclaimer, modelKey routing with slash-containing upstream ID, and 404/410 states.

- [ ] **Step 2: Run RED**

Run: `node --test src/utils/public-pricing-query.test.js src/views/public/pricing.contract.test.js`  
Expected: FAIL because modules are absent.

- [ ] **Step 3: Implement responsive pricing pages**

Render a 260px desktop filter/table and mobile drawer/cards. Update URL with router replacement and cancel stale list requests. Never display missing price as zero/free.

- [ ] **Step 4: Run GREEN and commit**

```bash
node --test src/utils/public-pricing-query.test.js src/views/public/pricing.contract.test.js
git add src/views/public src/components/public/Pricing* src/utils/public-pricing-query*
git commit -m "feat: add public model pricing catalog"
```

### Task 6: Add Root model administration API/store

**Files:**
- Create: `src/api/publicModelAdmin.js`
- Create: `src/api/publicModelAdmin.test.js`
- Create: `src/stores/publicModelAdmin.js`
- Create: `src/utils/public-model-form.js`
- Create: `src/utils/public-model-form.test.js`

- [ ] **Step 1: Write RED tests**

Cover list/search/filter query encoding, create/update revision, activate/inactivate, soft delete, missing/sync endpoints, fixed USD/unit, input/output-only form validation, and absence of deleted browsing/restoration.

- [ ] **Step 2: Run RED**

Run: `node --test src/api/publicModelAdmin.test.js src/utils/public-model-form.test.js`  
Expected: module-not-found failure.

- [ ] **Step 3: Implement API/store/form helpers**

Keep decimal inputs as strings. Generate idempotency keys client-side only for mutation attempts and never persist action tickets.

- [ ] **Step 4: Run GREEN and commit**

```bash
node --test src/api/publicModelAdmin.test.js src/utils/public-model-form.test.js
git add src/api/publicModelAdmin* src/stores/publicModelAdmin.js src/utils/public-model-form*
git commit -m "feat: add root pricing client"
```

### Task 7: Build Root model CRUD and missing detection UI

**Files:**
- Create: `src/views/PublicModelsAdmin.vue`
- Create: `src/views/PublicModelDetail.vue`
- Create: `src/components/public-admin/PublicModelForm.vue`
- Create: `src/components/public-admin/MissingModelsPanel.vue`
- Create: `src/views/public-model-admin.contract.test.js`
- Modify: `src/router/index.js`
- Modify: `src/layouts/MainLayout.vue`
- Modify: `src/i18n/messages.js`

- [ ] **Step 1: Write RED access/UI contracts**

Require Root-only nav and route metadata, direct-access rejection, search/status/completeness/upstream filters, create from observed model, immutable `modelKey`, detail/update, activate/inactivate, permanent soft-delete warning, missing sets, and conflict refresh flow.

- [ ] **Step 2: Run RED**

Run: `node --test src/views/public-model-admin.contract.test.js`  
Expected: FAIL because views/routes are absent.

- [ ] **Step 3: Implement pages and dialogs**

Put destructive operations in an overflow menu, request current-password action verification for delete, and remove a successful deletion from active UI without offering deleted filters.

- [ ] **Step 4: Run GREEN and commit**

```bash
node --test src/views/public-model-admin.contract.test.js
git add src/views/PublicModel* src/components/public-admin src/router/index.js src/layouts/MainLayout.vue src/i18n/messages.js
git commit -m "feat: manage root model pricing"
```

### Task 8: Build pricing publication and history UI

**Files:**
- Create: `src/api/publicPricingAdmin.js`
- Create: `src/api/publicPricingAdmin.test.js`
- Create: `src/views/PublicPricingAdmin.vue`
- Create: `src/components/public-admin/PricingDiff.vue`
- Create: `src/components/public-admin/PublicationChecks.vue`
- Create: `src/components/public-admin/PriceSnapshotHistory.vue`
- Create: `src/views/public-pricing-admin.contract.test.js`

- [ ] **Step 1: Write RED tests**

Cover draft/live diff, validation issue paths, explicit publish, single submit, action ticket held only in memory, idempotent timeout recovery, revision conflict, immutable history, and restore-as-new-version.

- [ ] **Step 2: Run RED**

Run: `node --test src/api/publicPricingAdmin.test.js src/views/public-pricing-admin.contract.test.js`  
Expected: FAIL because modules are absent.

- [ ] **Step 3: Implement publication workflow**

Do not call publish from ordinary model save. Show automatic safety snapshots as system-generated history entries.

- [ ] **Step 4: Run GREEN and commit**

```bash
node --test src/api/publicPricingAdmin.test.js src/views/public-pricing-admin.contract.test.js
git add src/api/publicPricingAdmin* src/views/PublicPricingAdmin.vue src/components/public-admin/PricingDiff.vue src/components/public-admin/PublicationChecks.vue src/components/public-admin/PriceSnapshotHistory.vue src/views/public-pricing-admin.contract.test.js
git commit -m "feat: publish price snapshots"
```

### Task 9: Build public-content administration

**Files:**
- Create: `src/api/publicContentAdmin.js`
- Create: `src/api/publicContentAdmin.test.js`
- Create: `src/views/PublicContentAdmin.vue`
- Create: `src/views/PublicContentPreview.vue`
- Create: `src/components/public-admin/SafeMarkdownEditor.vue`
- Create: `src/components/public-admin/ContentReleaseHistory.vue`
- Create: `src/utils/public-content-validation.js`
- Create: `src/utils/public-content-validation.test.js`

- [ ] **Step 1: Write RED tests**

Cover safe draft shape, optimistic revision, local early validation matching backend codes, authenticated preview, no-store/noindex expectations, reviewed legal fields, exact model references, unsafe URL/HTML rejection, publish/history/restore, and no prototype fallback.

- [ ] **Step 2: Run RED**

Run: `node --test src/api/publicContentAdmin.test.js src/utils/public-content-validation.test.js`  
Expected: FAIL because modules are absent.

- [ ] **Step 3: Implement content workflow**

Use the existing DOMPurify/Marked stack with a stricter allowlist. Backend validation remains authoritative. Never fetch remote image URLs.

- [ ] **Step 4: Run GREEN and commit**

```bash
node --test src/api/publicContentAdmin.test.js src/utils/public-content-validation.test.js
git add src/api/publicContentAdmin* src/views/PublicContent* src/components/public-admin/SafeMarkdownEditor.vue src/components/public-admin/ContentReleaseHistory.vue src/utils/public-content-validation*
git commit -m "feat: manage public content releases"
```

### Task 10: Add Root notification center

**Files:**
- Create: `src/api/rootNotifications.js`
- Create: `src/api/rootNotifications.test.js`
- Create: `src/stores/rootNotifications.js`
- Create: `src/views/RootNotifications.vue`
- Create: `src/components/RootNotificationBadge.vue`
- Create: `src/views/root-notifications.contract.test.js`
- Modify: `src/layouts/MainLayout.vue`

- [ ] **Step 1: Write RED tests**

Cover Root-only unread polling, active/resolved grouping, type-safe alert presentation, read/ack actions, independent receipt semantics, no secret/raw response rendering, and no email toggle.

- [ ] **Step 2: Run RED**

Run: `node --test src/api/rootNotifications.test.js src/views/root-notifications.contract.test.js`  
Expected: FAIL because modules are absent.

- [ ] **Step 3: Implement store, badge, and inbox**

Poll only while an authenticated Root session exists; stop and clear state on logout. Use concise localized messages derived from safe structured fields.

- [ ] **Step 4: Run GREEN and commit**

```bash
node --test src/api/rootNotifications.test.js src/views/root-notifications.contract.test.js
git add src/api/rootNotifications* src/stores/rootNotifications.js src/views/RootNotifications.vue src/components/RootNotificationBadge.vue src/views/root-notifications.contract.test.js src/layouts/MainLayout.vue
git commit -m "feat: add root pricing notifications"
```

### Task 11: Frontend integration and evidence

**Files:**
- Modify: `feature_list.json`
- Modify: `progress.md`
- Create: `docs/agents/validation/2026-09-09-public-content-pricing/frontend-report.md`

- [ ] **Step 1: Run full tests with explicit backend contract**

```bash
PUBLIC_PRICING_BACKEND_CONTRACT=/Users/xuzhihao/code/Porsche/.worktrees/public-content-pricing/docs/agents/contracts/public-content-pricing-v1.json npm test
```

Expected: all tests PASS, zero contract skips.

- [ ] **Step 2: Run production build and source gates**

```bash
VITE_USE_MOCK=false npm run build
git diff --check
```

Expected: PASS; build contains no enabled mock pricing route or prototype claims.

- [ ] **Step 3: Run browser acceptance**

Use isolated test accounts/data. Verify anonymous and Root flows at 375/768/1440, keyboard focus, route refresh/share, safe redirect, 404/410, CRUD/lifecycle, missing detection, publication/history, and notifications. Clean all mutable fixture data exactly.

- [ ] **Step 4: Record bounded status and commit**

```bash
git add feature_list.json progress.md docs/agents/validation/2026-09-09-public-content-pricing/frontend-report.md
git commit -m "docs: record public pricing frontend evidence"
```

Do not mark approved production content or deployment as passed while the safe draft lacks reviewed prices, terms, privacy, and brand content.
