# Prototype-Faithful Home, Pricing, Motion, and Typography Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the public home and pricing pages from the approved local prototypes, add consistent full-site route transitions, and reduce typography across every page while preserving real data, permissions, failures, and production-bundle boundaries.

**Architecture:** Keep the existing published-content and public-pricing state machines intact and replace only their presentation structure. Introduce semantic type tokens and a shared opacity-only route outlet, then compose them at the public, guest, and authenticated router outlets. Cross-bootstrap navigation uses the same handoff timing without bypassing route guards; reduced-motion users receive immediate navigation.

**Tech Stack:** Vue 3 SFCs, Vue Router 4, Pinia, Element Plus, SCSS design tokens, Node test runner, JSDOM, Vite 6, Playwright/Chromium browser verification.

---

## References and fixed boundaries

- Design: `docs/superpowers/specs/2026-09-13-home-pricing-prototype-reuse-design.md`
- Home reference: `/Users/xuzhihao/Doubao/chats/2026-09-01/new-chat-1/landing-prototype.html`
- Pricing reference: `/Users/xuzhihao/Doubao/chats/2026-09-01/new-chat-1/pricing.html`
- Shared visual references: the other HTML files in `/Users/xuzhihao/Doubao/chats/2026-09-01/new-chat-1/`
- Interface contract: `interface-contract.json`; it must remain unchanged unless the frontend and backend coordinators explicitly approve a versioned change.
- Do not copy `ModelHub`, `40+`, `100%`, `MIT License`, prototype provider counts, group multipliers, per-request prices, demo credentials, prototype links, or Tailwind CDN code.
- Keep `web-012` in progress, P08 blocked on product content, future email delivery pending, public pricing empty unproven, and live acceptance unperformed unless new evidence changes those facts.

The authoritative backend contract paths for the final suite are:

```text
A03_BACKEND_CONTRACT=/Users/xuzhihao/code/Porsche/.worktrees/platform-compare-stream-v2/docs/agents/contracts/admin-user-create-v1.json
A05_BACKEND_CONTRACT=/Users/xuzhihao/code/Porsche/.worktrees/platform-compare-stream-v2/docs/agents/contracts/admin-user-edit-v1.json
A06_BACKEND_CONTRACT=/Users/xuzhihao/code/Porsche/.worktrees/platform-compare-stream-v2/docs/agents/contracts/admin-user-status-v1.json
A08_BACKEND_CONTRACT=/Users/xuzhihao/code/Porsche/.worktrees/platform-compare-stream-v2/docs/agents/contracts/admin-user-roles-permissions-v1.json
A14_BACKEND_CONTRACT=/Users/xuzhihao/code/Porsche/.worktrees/platform-compare-stream-v2/docs/agents/contracts/admin-action-future-contract.json
PUBLIC_PRICING_BACKEND_CONTRACT=/Users/xuzhihao/code/Porsche/.worktrees/platform-compare-stream-v2/docs/agents/contracts/public-content-pricing-v1.json
```

## Task 1: Freeze the approved presentation and behavior boundaries

**Files:**
- Modify: `src/views/public/public-pages.contract.test.js`
- Modify: `src/views/public/pricing.contract.test.js`
- Create: `src/styles/typography.contract.test.js`
- Create: `src/router/route-transition.contract.test.js`

- [ ] **Step 1: Extend the home contract with the exact prototype section order**

Add assertions that require `hero`, `proof`, `advantages`, `models`, `announcements-faq`, and `cta`, real Vue links, the existing publication injection, and absence of forbidden prototype claims:

```js
assert.deepEqual(
  [...home.matchAll(/data-section="([^"]+)"/g)].map(match => match[1]),
  ['hero', 'proof', 'advantages', 'models', 'announcements-faq', 'cta'],
)
for (const forbidden of ['ModelHub', '40+', '100%', 'MIT License', 'tailwindcss.com']) {
  assert.doesNotMatch(`${home}\n${header}\n${footer}`, new RegExp(forbidden.replace('+', '\\+')))
}
assert.match(home, /inject\(['"]public-home-publication['"]\)/)
assert.match(home, /to=["']\/chat["']/)
assert.match(home, /to=["']\/pricing["']/)
```

- [ ] **Step 2: Extend the pricing contract with prototype structure and current data rules**

Require a 260px filter rail, compact toolbar/table, mobile drawer/cards, input/output token prices, and reject per-request pricing and hard-coded counts:

```js
assert.match(page, /class="pricing-layout"/)
assert.match(page, /class="pricing-sidebar"/)
assert.match(page, /class="pricing-toolbar"/)
assert.match(styles, /grid-template-columns:\s*260px\s+minmax\(0,\s*1fr\)/)
assert.match(table, /pricingCatalog\.inputPrice/)
assert.match(table, /pricingCatalog\.outputPrice/)
assert.doesNotMatch(`${page}\n${filters}\n${table}`, /单次调用价|每请求|x(?:0\.\d+|\d+\.\d+)/)
```

- [ ] **Step 3: Add typography and route-transition contract tests**

The typography test must read `tokens.scss`, `foundations.scss`, `global.scss`, `public-shell.scss`, `public-content.scss`, and `console-shell.scss` and require the agreed token values. The transition test must require a shared component, `mode="out-in"`, opacity-only CSS, reduced-motion handling, route leaf keys, identity epoch composition, and a guarded cross-bootstrap handoff.

```js
assert.match(tokens, /--font-size-xs:\s*11px/)
assert.match(tokens, /--font-size-sm:\s*12px/)
assert.match(tokens, /--font-size-body:\s*14px/)
assert.match(tokens, /--font-size-page-title:\s*20px/)
assert.match(tokens, /--font-size-hero:\s*44px/)
assert.doesNotMatch(styles, /\bzoom\s*:|transform:\s*scale\(/)

assert.match(component, /<Transition[^>]*mode="out-in"/)
assert.match(component, /route\.fullPath/)
assert.match(component, /prefers-reduced-motion/)
assert.doesNotMatch(componentStyle, /translate|scale|rotate/)
```

- [ ] **Step 4: Run the tests and confirm RED**

Run:

```bash
node --test \
  src/views/public/public-pages.contract.test.js \
  src/views/public/pricing.contract.test.js \
  src/styles/typography.contract.test.js \
  src/router/route-transition.contract.test.js
```

Expected: existing preservation assertions pass; new prototype-order, typography-token, and transition-component assertions fail for the missing implementation.

- [ ] **Step 5: Commit the red contracts**

```bash
git add src/views/public/public-pages.contract.test.js src/views/public/pricing.contract.test.js src/styles/typography.contract.test.js src/router/route-transition.contract.test.js
git commit -m "test: freeze prototype-faithful public experience"
```

## Task 2: Introduce the compact full-site typography scale

**Files:**
- Modify: `src/styles/tokens.scss`
- Modify: `src/styles/foundations.scss`
- Modify: `src/styles/global.scss`
- Modify: `src/styles/console-shell.scss`
- Modify: `src/styles/console-pages.scss`
- Modify: `src/styles/public-shell.scss`
- Modify: `src/styles/public-content.scss`
- Modify: `src/styles/public-pricing.scss`
- Test: `src/styles/typography.contract.test.js`
- Test: `src/views/console-pages.visual.contract.test.js`

- [ ] **Step 1: Add the semantic type tokens**

Add these values to the light token source so the dark theme inherits the same scale:

```scss
--font-size-xs: 11px;
--font-size-sm: 12px;
--font-size-body: 14px;
--font-size-subtitle: 16px;
--font-size-page-title: 20px;
--font-size-section-title: 30px;
--font-size-hero: 44px;
--font-size-hero-mobile: 34px;
```

- [ ] **Step 2: Apply the body and Element Plus mappings**

In `foundations.scss`, set the inherited body/control size to `var(--font-size-body)`. In `global.scss`, map Element Plus base, dialog, form, table, button, tag, and message sizes without changing control heights:

```scss
body,
button,
input,
select,
textarea { font-size: var(--font-size-body); }

:root {
  --el-font-size-base: var(--font-size-body);
  --el-font-size-small: var(--font-size-sm);
  --el-font-size-large: var(--font-size-subtitle);
  --el-dialog-title-font-size: var(--font-size-subtitle);
}
```

- [ ] **Step 3: Replace large shared headings with semantic tokens**

Set `.page-header h1`, `.page-title`, `.auth-brand h1`, public document headings, section headings, pricing headings, and metadata to the agreed scale. Keep only `.public-hero h1` at `--font-size-hero`, with the mobile override `--font-size-hero-mobile`.

- [ ] **Step 4: Run focused typography regressions**

```bash
node --test src/styles/typography.contract.test.js src/views/console-pages.visual.contract.test.js src/layouts/visual-shell.contract.test.js
```

Expected: all tests pass; no `zoom` or `transform: scale` appears in the typography surfaces; 44px control-size assertions remain green.

- [ ] **Step 5: Commit**

```bash
git add src/styles
git commit -m "feat: compact the full-site typography scale"
```

## Task 3: Add the shared opacity-only route transition

**Files:**
- Create: `src/components/shell/RouteViewTransition.vue`
- Create: `src/router/page-transition.js`
- Modify: `src/App.vue`
- Modify: `src/bootstrap/AuthApp.vue`
- Modify: `src/layouts/PublicLayout.vue`
- Modify: `src/layouts/MainLayout.vue`
- Modify: `src/router/index.js`
- Modify: `src/styles/foundations.scss`
- Test: `src/router/route-transition.contract.test.js`
- Test: `src/router/public-routes.test.js`
- Test: `src/layouts/visual-shell.contract.test.js`
- Test: `src/bootstrap/bootstrap.test.js`

- [ ] **Step 1: Implement the route-view wrapper**

The component owns only presentation and post-enter focus. It combines `route.fullPath` with the optional identity epoch and emits no data mutations:

```vue
<script setup>
import { nextTick } from 'vue'
defineProps({ identityKey: { type: [String, Number], default: '' }, focusTarget: { type: String, required: true } })
async function restoreFocus(selector) {
  await nextTick()
  document.querySelector(selector)?.focus({ preventScroll: true })
}
</script>
<template>
  <RouterView v-slot="{ Component, route }">
    <Transition name="route-fade" mode="out-in" @after-enter="restoreFocus(focusTarget)">
      <component :is="Component" :key="`${identityKey}:${route.fullPath}`" />
    </Transition>
  </RouterView>
</template>
```

- [ ] **Step 2: Add the exact motion CSS**

```scss
.route-fade-leave-active { transition: opacity 200ms ease; }
.route-fade-enter-active { transition: opacity 350ms ease; }
.route-fade-enter-from,
.route-fade-leave-to { opacity: 0; }

@media (prefers-reduced-motion: reduce) {
  .route-fade-enter-active,
  .route-fade-leave-active { transition-duration: 0.01ms; }
}
```

- [ ] **Step 3: Compose the wrapper at each router outlet**

Use it in `App.vue`, `AuthApp.vue`, `PublicLayout.vue`, and the `#console-content` slot in `MainLayout.vue`. In the console outlet pass `userStore.identityEpoch`; preserve the existing auth status and shell outside the animated subtree.

- [ ] **Step 4: Add guarded cross-bootstrap handoff**

Implement `createPageHandoff` in `src/router/page-transition.js`. It must call `location.assign(path)` immediately for reduced-motion users and after 200ms otherwise, coalesce repeated calls to the latest path, and never alter guard results:

```js
export function createPageHandoff({ document, location, matchMedia, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let timer = null
  return path => {
    if (timer) clearTimer(timer)
    if (matchMedia?.('(prefers-reduced-motion: reduce)').matches) return location.assign(path)
    document.documentElement.classList.add('route-handoff-leaving')
    timer = setTimer(() => location.assign(path), 200)
  }
}
```

Wire the function only as the existing `installBootstrapHandoff` callback. Keep the guard return value `false` and all auth/root checks unchanged.

- [ ] **Step 5: Add router scroll behavior**

Set `scrollBehavior` on `createRouter`: hashes return `{ el: to.hash, behavior: reduced ? 'auto' : 'smooth' }`; browser pop restores `savedPosition`; new routes return `{ top: 0 }`. Focus restoration stays in the route outlet and never focuses hidden content.

- [ ] **Step 6: Run focused transition tests**

```bash
node --test src/router/route-transition.contract.test.js src/router/public-routes.test.js src/layouts/visual-shell.contract.test.js src/bootstrap/bootstrap.test.js
```

Expected: pass, including reduced motion, repeated handoff, route guard preservation, identity epoch, hash scrolling, pop-state restoration, and focus targets.

- [ ] **Step 7: Commit**

```bash
git add src/App.vue src/bootstrap/AuthApp.vue src/components/shell/RouteViewTransition.vue src/layouts/PublicLayout.vue src/layouts/MainLayout.vue src/router/index.js src/router/page-transition.js src/router/route-transition.contract.test.js src/styles/foundations.scss
git commit -m "feat: add consistent route content transitions"
```

## Task 4: Rebuild the public home from the landing prototype

**Files:**
- Modify: `src/views/public/Home.vue`
- Modify: `src/components/public/HeroPreview.vue`
- Modify: `src/components/public/PublicHeader.vue`
- Modify: `src/components/public/PublicFooter.vue`
- Modify: `src/components/public/PublicSection.vue`
- Modify: `src/styles/public-shell.scss`
- Modify: `src/styles/public-content.scss`
- Modify: `src/views/public/public-pages.contract.test.js`
- Test: `src/stores/publicHomePublication.test.js`

- [ ] **Step 1: Recompose the home template in the approved order**

Keep all existing computed state, publication injection, announcements, focus restoration, and retries. Rebuild only the ready-state markup with these six `data-section` values:

```vue
<section data-section="hero" class="public-hero">...</section>
<section data-section="proof" class="public-proof" aria-label="平台能力">...</section>
<PublicSection id="advantages" data-section="advantages" ...>...</PublicSection>
<PublicSection id="models" data-section="models" ...>...</PublicSection>
<PublicSection data-section="announcements-faq" ...>...</PublicSection>
<section data-section="cta" class="public-cta">...</section>
```

The proof row uses three truthful capability labels such as “统一接入”, “OpenAI 兼容”, and “按 Token 计价”; it contains no numeric performance or licensing claim.

- [ ] **Step 2: Match the prototype header and footer**

Add the square `AI` brand mark, desktop nav rhythm, compact console CTA, scroll shadow, dark footer, and real links. Keep locale/theme controls, mobile menu Escape behavior, route-close hook, and external-link `rel` behavior.

- [ ] **Step 3: Match the Hero and section visuals**

Port the dot grid, decorative color fields, 44px heading, white browser card, traffic-light chrome, floating provider labels, three-column advantage cards, model hover states, blue CTA, and responsive breakpoints into SCSS. Use existing variables for light/dark values; do not import Tailwind.

- [ ] **Step 4: Preserve safe content states**

Run the current publication tests and confirm that loading, preparing, error, retry, empty models, announcements, local read state, sanitized HTML, Escape, focus containment, and focus restoration still work.

- [ ] **Step 5: Run the home suite**

```bash
node --test src/views/public/public-pages.contract.test.js src/stores/publicHomePublication.test.js src/stores/publicContent.test.js src/utils/public-document.test.js
```

Expected: all tests pass and no forbidden prototype claim or fixture appears.

- [ ] **Step 6: Commit**

```bash
git add src/views/public/Home.vue src/components/public/HeroPreview.vue src/components/public/PublicHeader.vue src/components/public/PublicFooter.vue src/components/public/PublicSection.vue src/styles/public-shell.scss src/styles/public-content.scss src/views/public/public-pages.contract.test.js
git commit -m "feat: rebuild the public home from the approved prototype"
```

## Task 5: Rebuild public pricing from the pricing prototype

**Files:**
- Modify: `src/views/public/Pricing.vue`
- Modify: `src/components/public/PricingFilters.vue`
- Modify: `src/components/public/PricingTable.vue`
- Modify: `src/components/public/PricingCards.vue`
- Modify: `src/styles/public-pricing.scss`
- Modify: `src/views/public/pricing.contract.test.js`
- Modify: `src/views/public/Pricing.mounted.test.js`
- Test: `src/utils/public-pricing-query.test.js`
- Test: `src/utils/public-catalog.test.js`

- [ ] **Step 1: Recompose the desktop pricing workspace**

Move search into the right toolbar while keeping the same debounced canonical query update. Render providers, groups, capabilities, endpoints, sort, and direction from existing facets in the 260px sticky rail. Keep the result count and use the current `PricingTable` rows.

- [ ] **Step 2: Compact the table and filter presentation**

Match the prototype’s 12–14px labels, 9–12px cell padding, 10px card radius, subtle row hover, monospace prices/model keys, and 1600px workspace. Do not reduce interactive controls below 44px.

- [ ] **Step 3: Preserve the mobile drawer and cards**

At 767px and below, hide the desktop rail/table, show the filter trigger/cards, constrain the drawer to `min(340px, 90vw)`, retain focus trapping, Escape, breakpoint close, and focus return.

- [ ] **Step 4: Strengthen mounted behavior coverage**

Assert search debounce, canonical query replacement, protected-price login upgrade, price-sort blocking, drawer focus loop, Escape, desktop breakpoint close, stale-request cancellation, and unmount cleanup after the template move.

- [ ] **Step 5: Run the full pricing suite**

```bash
PUBLIC_PRICING_BACKEND_CONTRACT=/Users/xuzhihao/code/Porsche/.worktrees/platform-compare-stream-v2/docs/agents/contracts/public-content-pricing-v1.json \
node --test \
  src/api/public-content-pricing-contract.test.js \
  src/views/public/pricing.contract.test.js \
  src/views/public/Pricing.mounted.test.js \
  src/utils/public-pricing-query.test.js \
  src/utils/public-catalog.test.js
```

Expected: all tests pass with no skip; only input/output USD-per-million-token pricing remains.

- [ ] **Step 6: Commit**

```bash
git add src/views/public/Pricing.vue src/components/public/PricingFilters.vue src/components/public/PricingTable.vue src/components/public/PricingCards.vue src/styles/public-pricing.scss src/views/public/pricing.contract.test.js src/views/public/Pricing.mounted.test.js
git commit -m "feat: rebuild public pricing from the approved prototype"
```

## Task 6: Audit every page family against the compact type scale

**Files:**
- Modify only when a failing test or browser reproduction proves a remaining oversized shared rule: `src/views/*.vue`, `src/components/**/*.vue`, `src/styles/*.scss`
- Modify: `src/styles/typography.contract.test.js`
- Create: `src/views/full-site-typography.visual.contract.test.js`

- [ ] **Step 1: Add representative page-family assertions**

Cover login/register, chat, billing, API keys, profile, users/detail, public model/pricing/content administration, notifications, dialogs, tables, badges, and mobile drawers. Assert they inherit semantic tokens or use values within the approved scale; allow 28–36px only for monetary emphasis and public detail prices.

- [ ] **Step 2: Run and record RED for any oversized shared rule**

```bash
node --test src/styles/typography.contract.test.js src/views/full-site-typography.visual.contract.test.js src/views/console-pages.visual.contract.test.js src/views/users.visual.contract.test.js
```

Expected: fail only on specific remaining rules above the approved scale; record every failing selector before editing it.

- [ ] **Step 3: Make only the proven typography corrections**

Replace the failing literal sizes with semantic tokens. Keep price emphasis, charts, code samples, touch sizes, dialog widths, responsive overflow, and destructive-action copy intact.

- [ ] **Step 4: Run the focused suite again**

Run the Step 2 command. Expected: all tests pass and the exceptions are explicitly limited to home Hero and numeric price emphasis.

- [ ] **Step 5: Commit**

```bash
git add src/styles/typography.contract.test.js src/views/full-site-typography.visual.contract.test.js src/views src/components src/styles
git commit -m "fix: align remaining pages to the compact type scale"
```

Before committing, inspect `git diff --name-only` and unstage any file without a test-proven typography change.

## Task 7: Run full verification and production-bundle gates

**Files:**
- Modify: `scripts/check-production-bundle.test.js` only if the new negative tests expose a checker gap
- Modify: `scripts/check-production-bundle.mjs` only if that failing test proves the gap
- Create: external temporary adversarial bundle fixtures under `/private/tmp`; do not commit them

- [ ] **Step 1: Run the authoritative full suite**

```bash
A03_BACKEND_CONTRACT=/Users/xuzhihao/code/Porsche/.worktrees/platform-compare-stream-v2/docs/agents/contracts/admin-user-create-v1.json \
A05_BACKEND_CONTRACT=/Users/xuzhihao/code/Porsche/.worktrees/platform-compare-stream-v2/docs/agents/contracts/admin-user-edit-v1.json \
A06_BACKEND_CONTRACT=/Users/xuzhihao/code/Porsche/.worktrees/platform-compare-stream-v2/docs/agents/contracts/admin-user-status-v1.json \
A08_BACKEND_CONTRACT=/Users/xuzhihao/code/Porsche/.worktrees/platform-compare-stream-v2/docs/agents/contracts/admin-user-roles-permissions-v1.json \
A14_BACKEND_CONTRACT=/Users/xuzhihao/code/Porsche/.worktrees/platform-compare-stream-v2/docs/agents/contracts/admin-action-future-contract.json \
PUBLIC_PRICING_BACKEND_CONTRACT=/Users/xuzhihao/code/Porsche/.worktrees/platform-compare-stream-v2/docs/agents/contracts/public-content-pricing-v1.json \
VITE_USE_MOCK=false npm test
```

Expected: every test passes with zero skip, fail, cancelled, or todo.

- [ ] **Step 2: Build the production bundle**

```bash
VITE_USE_MOCK=false npm run build
node scripts/check-public-route-chunks.mjs dist
git diff --check origin/main...HEAD
```

Expected: build and both gates pass. Record third-party PURE annotation, mixed static/dynamic import, and large-chunk warnings as warnings rather than failures.

- [ ] **Step 3: Scan the complete bundle**

```bash
rg -n "ModelHub|40\\+|100%|MIT License|tailwindcss\\.com|dashboard-prototype|tokens-prototype|users-prototype|pricing\\.html|13800138000|Porsche@2026|mock_token_|demo-chat" dist
```

Expected: exit 1 with no matches. Then inspect `dist/.vite/manifest.json` and `dist/public-module-graph.json` to confirm no prototype, general mock, or test module enters a production chunk.

- [ ] **Step 4: Adversarially test the checker**

In `/private/tmp`, copy the clean bundle metadata and add an ordinarily named hashed JS chunk containing `ModelHub` plus `mock_token_`. Run the production checker against that fixture and require exit 1. Run the same checker against a clean sentinel fixture and require exit 0.

- [ ] **Step 5: Fix only a reproduced gate weakness**

If Step 4 is incorrectly accepted, add the failing case to `scripts/check-production-bundle.test.js`, update the checker to scan all emitted text assets, rerun the test, and commit:

```bash
git add scripts/check-production-bundle.mjs scripts/check-production-bundle.test.js
git commit -m "test: reject prototype fixtures in production bundles"
```

If the checker already rejects it, make no checker commit.

## Task 8: Run the browser visual, motion, and accessibility matrix

**Files:**
- Create: `docs/agents/validation/2026-09-13-home-pricing-motion-typography-browser.md`
- Modify production files only after a concrete browser defect has a focused RED test
- Create external scripts/results/screenshots under `/private/tmp`; do not commit them

- [ ] **Step 1: Follow the Playwright skill setup**

From `/Users/xuzhihao/.codex/skills/playwright-skill`, detect existing dev servers first. Start a `VITE_USE_MOCK=false` production preview only when no suitable server exists. Write parameterized visible-Chromium scripts to `/private/tmp`.

- [ ] **Step 2: Test the approved viewport/theme matrix**

Run 375×812, 768×1024, and 1440×900 in light and dark themes. Use anonymous contexts for public/guest routes and synthetic Root fixtures only for protected pages. Every case must assert final pathname/query and a route-specific landmark.

- [ ] **Step 3: Verify the home and pricing references**

For `/`, verify section order, 56px header, 44/34px Hero, dot-grid/color fields, preview card, proof row, three-column/stacked advantages, model wall, CTA, dark footer, anchors, and no forbidden prototype text. For `/pricing`, verify the 260px desktop rail, compact toolbar/table, mobile drawer/cards, 12–14px information density, input/output prices, pagination, loading/error, and explicit SKIP for any unproven empty/ready state.

- [ ] **Step 4: Verify route motion and reduced motion**

Record computed transition properties and timestamps for public-public, guest-console, and console-console navigation. Require opacity-only leave/enter near 200/350ms, unchanged fixed shell geometry, final focus on the new main heading/content, and immediate switching under reduced motion. Exercise rapid double navigation and browser back/forward as adversarial cases.

- [ ] **Step 5: Audit the type scale across all page families**

Check login, register, chat, billing, API keys, profile, users/detail, public model/pricing/content administration, and Root notifications. Assert body/control text 14px, metadata/badges 11–12px, ordinary titles 18–20px, no viewport overflow, visible focus, bounded dialogs, and preserved 44px touch targets.

- [ ] **Step 6: Write the evidence report**

Record exact tested revision, URL, auth fixture class, viewport, theme, language, route/state, final URL, landmark, computed type/motion values, result, screenshot path, expected injected errors, unexpected console/page errors, and every skipped live-data state. Do not count a loading state as ready or a synthetic state as live acceptance.

- [ ] **Step 7: Commit the report**

```bash
git add docs/agents/validation/2026-09-13-home-pricing-motion-typography-browser.md
git commit -m "test: record prototype-faithful browser regression"
```

## Task 9: Update project records and run the canonical review chain

**Files:**
- Modify: `feature_list.json`
- Modify: `progress.md`
- Create external canonical scope/baseline/snapshot files under a new `/private/tmp` directory

- [ ] **Step 1: Update records without broadening status**

Record exact commits, full test/build/bundle results, browser matrix, route-motion timings, type scale, preserved behaviors, warnings, and skipped states. Keep `web-012` in progress, P08 blocked, email delivery pending, pricing empty/ready claims limited to observed states, and deployment/live acceptance unperformed.

- [ ] **Step 2: Validate records and commit**

```bash
node -e "JSON.parse(require('node:fs').readFileSync('feature_list.json','utf8')); console.log('feature_list valid')"
git diff --check
git add feature_list.json progress.md
git commit -m "docs: record prototype-faithful visual verification"
```

- [ ] **Step 3: Generate a canonical whole-feature snapshot**

Create a non-overlapping scope covering every path changed from `origin/main`. Because the feature implementation has already changed the current worktree, create a separate final-review worktree: check out `origin/main`, generate the canonical baseline there, fast-forward to the exact final commit without rewriting commits, generate `snapshot-final.json`, and run `verify`. Persist raw stdout bytes exclusively in `/private/tmp/porsche-web-home-pricing-final-review-20260913-01`; fail before writing if that directory already exists, and update this plan in a new commit with the next numeric suffix before retrying. Never overwrite or reuse an earlier snapshot.

```bash
review_dir=/private/tmp/porsche-web-home-pricing-final-review-20260913-01
test ! -e "$review_dir"
mkdir -m 700 "$review_dir"
python3 docs/agents/review_snapshot.py baseline --scope "$review_dir/scope.json" --contract interface-contract.json --output - > "$review_dir/baseline.json"
python3 docs/agents/review_snapshot.py snapshot --scope "$review_dir/scope.json" --baseline "$review_dir/baseline.json" --contract interface-contract.json --output - > "$review_dir/snapshot-final.json"
python3 docs/agents/review_snapshot.py verify --scope "$review_dir/scope.json" --baseline "$review_dir/baseline.json" --snapshot "$review_dir/snapshot-final.json" --contract interface-contract.json
```

Create `scope.json` in that directory from the exact `git diff --name-only origin/main...HEAD` list before the baseline step, and verify that every changed path appears exactly once. Record the directory verbatim in `progress.md` only after verification succeeds.

- [ ] **Step 4: Run independent reviews in order**

1. The coordinator publishes the exact final revision, contract SHA/version/status, scope, baseline, snapshot path, and snapshot ID.
2. The specification reviewer independently runs canonical verify and checks every design/plan requirement. Require `SPEC_PASS` bound to the exact snapshot, revision, and contract.
3. Only after `SPEC_PASS`, the quality reviewer independently reruns the authoritative test/build/bundle gates and adversarial browser/checker probes. Require `QUALITY_PASS` and `VERDICT: PASS` bound to the same snapshot, revision, and contract.
4. Any code, test, document, record, or contract change invalidates both reviews. Return it to the original developer, generate a new whole snapshot, and restart from specification review.

- [ ] **Step 5: Prepare integration without performing it**

Summarize commits, tests, build warnings, browser evidence, review results, P08/email/pricing/live boundaries, and the exact feature branch/worktree. Push, PR creation, merge, deployment, and live acceptance remain separate user-authorized actions.
