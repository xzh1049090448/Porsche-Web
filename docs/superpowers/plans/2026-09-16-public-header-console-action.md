# Public Header Console Action Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the desktop console CTA to the right of the theme control, preserve the mobile drawer CTA, reuse the console brand on public pages, and restore the homepage proof strip outer border.

**Architecture:** `PublicHeader.vue` will render the shared `AppBrand` component and two responsive console links whose visibility is controlled by `public-shell.scss`. Public brand copy will come from the existing public locale runtime. Shared `AppBrand` presentation rules will move to the globally loaded foundations stylesheet, while the homepage proof strip receives a complete outer border in its existing feature stylesheet.

**Tech Stack:** Vue 3 render functions and SFCs, Vue Router, SCSS, Node.js test runner, JSDOM, Vite.

---

### Task 1: Freeze the responsive header, brand, and proof-border contracts

**Files:**
- Modify: `src/layouts/visual-shell.contract.test.js`
- Modify: `src/views/public/public-pages.contract.test.js`
- Modify: `src/i18n/public-runtime.test.js`

- [ ] **Step 1: Write failing header placement assertions**

Extend the mounted `PublicHeader` test so it requires two responsive CTA nodes, the desktop node inside `.public-header__actions` after `.public-theme`, and the mobile node inside `#public-mobile-nav`:

```js
const desktopCta = wrapper.element.querySelector('.public-console-cta--desktop')
const mobileCta = wrapper.element.querySelector('.public-console-cta--mobile')
assert.equal(desktopCta?.closest('.public-header__actions')?.className, 'public-header__actions')
assert.ok(wrapper.element.querySelector('.public-theme').compareDocumentPosition(desktopCta) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING)
assert.equal(mobileCta?.closest('#public-mobile-nav')?.id, 'public-mobile-nav')
assert.equal(desktopCta?.getAttribute('href'), '/chat')
assert.equal(mobileCta?.getAttribute('href'), '/chat')
```

Also require `PublicHeader.vue` to import and render `AppBrand`, and reject the old `public-brand__mark` implementation.

- [ ] **Step 2: Write failing shared-brand and proof-border assertions**

Require the public locale runtime to return the application title and subtitle:

```js
assert.equal(publicAppText('zh', 'title'), '中国大模型聚合平台')
assert.equal(publicAppText('zh', 'subtitle'), '智谱 GLM / DeepSeek')
assert.equal(publicAppText('en', 'title'), 'China LLM Hub')
assert.equal(publicAppText('en', 'subtitle'), 'Zhipu GLM / DeepSeek')
```

Update the public page contract to require a complete proof border:

```js
assert.match(publicContent, /\.public-proof\s*\{[^}]*border:\s*1px solid var\(--border-subtle\)/s)
```

- [ ] **Step 3: Run focused tests and verify RED**

Run:

```bash
node --test \
  src/layouts/visual-shell.contract.test.js \
  src/views/public/public-pages.contract.test.js \
  src/i18n/public-runtime.test.js
```

Expected: FAIL because the desktop CTA classes, shared `AppBrand`, public subtitle accessor, and complete proof border do not exist yet.

- [ ] **Step 4: Commit the failing contracts**

```bash
git add src/layouts/visual-shell.contract.test.js src/views/public/public-pages.contract.test.js src/i18n/public-runtime.test.js
git commit -m "test: define public header visual contract"
```

### Task 2: Reuse the console brand and expose localized brand copy

**Files:**
- Modify: `src/components/public/PublicHeader.vue`
- Modify: `src/i18n/public-messages.js`
- Modify: `src/i18n/public-runtime.js`
- Modify: `src/styles/foundations.scss`
- Modify: `src/styles/console-shell.scss`
- Modify: `src/styles/public-shell.scss`

- [ ] **Step 1: Add public application copy access**

Add `subtitle` beside each public `app.title`, export a narrow accessor, and expose it from `usePublicI18n`:

```js
export function publicAppText(locale, key, params) {
  return translate(locale, `app.${key}`, params)
}

export function usePublicI18n() {
  const locale = sharedLocale
  const t = (key, params) => publicText(locale.value, key, params)
  const app = (key, params) => publicAppText(locale.value, key, params)
  // existing locale application and toggle logic
  return { locale, t, app, toggle }
}
```

- [ ] **Step 2: Render the shared brand in the public header**

Import `AppBrand`, read `app` from `usePublicI18n`, and replace the custom public brand link:

```js
import AppBrand from '@/components/shell/AppBrand.vue'

const { t, app, toggle } = usePublicI18n()

h(AppBrand, { title: app('title'), subtitle: app('subtitle') })
```

- [ ] **Step 3: Share the brand styles**

Move the following rules from `console-shell.scss` into `foundations.scss`, preserving their declarations exactly so both boot paths render the same component:

```scss
.app-brand { display: flex; min-width: 0; align-items: center; gap: 10px; color: var(--text-primary); text-decoration: none; }
.app-brand__icon { width: 32px; height: 32px; object-fit: contain; }
.app-brand__copy { display: grid; min-width: 0; }
.app-brand__copy strong { font-size: var(--font-size-subtitle); line-height: 20px; }
.app-brand__copy small { color: var(--text-secondary); font-size: var(--font-size-xs); }
```

Remove the obsolete `.public-brand` and `.public-brand__mark` header rules from `public-shell.scss`. Keep footer-specific brand styling unchanged.

- [ ] **Step 4: Run focused tests**

Run the Task 1 command. Expected: brand and locale assertions PASS; CTA and proof-border assertions remain RED.

- [ ] **Step 5: Commit the shared brand change**

```bash
git add src/components/public/PublicHeader.vue src/i18n/public-messages.js src/i18n/public-runtime.js src/styles/foundations.scss src/styles/console-shell.scss src/styles/public-shell.scss
git commit -m "fix: share console brand with public header"
```

### Task 3: Move the desktop CTA and preserve the mobile drawer CTA

**Files:**
- Modify: `src/components/public/PublicHeader.vue`
- Modify: `src/styles/public-shell.scss`
- Test: `src/layouts/visual-shell.contract.test.js`

- [ ] **Step 1: Split the responsive CTA render locations**

Remove the existing generic CTA from `navLinks`. Add a mobile CTA as the final nav child and a desktop CTA after the theme button:

```js
const mobileConsoleLink = link('/chat', t('console'), {
  class: 'public-button public-button--small public-console-cta public-console-cta--mobile',
})
const desktopConsoleLink = link('/chat', t('console'), {
  class: 'public-button public-button--small public-console-cta public-console-cta--desktop',
})
```

Render `mobileConsoleLink` inside `.public-nav` and `desktopConsoleLink` as the last child of `.public-header__actions`.

- [ ] **Step 2: Add responsive visibility rules**

```scss
.public-console-cta--mobile { display: none; }

@media (max-width: 767px) {
  .public-console-cta--desktop { display: none; }
  .public-nav .public-console-cta--mobile { display: flex; }
}
```

- [ ] **Step 3: Run the mounted header test and verify GREEN**

```bash
node --test src/layouts/visual-shell.contract.test.js
```

Expected: PASS, including route `/chat`, desktop DOM order, mobile menu focus, Escape behavior, and breakpoint closure.

- [ ] **Step 4: Commit the header placement change**

```bash
git add src/components/public/PublicHeader.vue src/styles/public-shell.scss src/layouts/visual-shell.contract.test.js
git commit -m "fix: move public console action to header controls"
```

### Task 4: Restore the homepage proof-strip outer border

**Files:**
- Modify: `src/styles/public-content.scss`
- Test: `src/views/public/public-pages.contract.test.js`

- [ ] **Step 1: Replace the partial border with a complete border**

In `.public-proof`, replace the separate top and bottom declarations with:

```scss
border: 1px solid var(--border-subtle);
```

Keep the existing desktop `article` right borders and mobile bottom borders unchanged.

- [ ] **Step 2: Run the public page contract and verify GREEN**

```bash
node --test src/views/public/public-pages.contract.test.js
```

Expected: PASS with the complete outer border and existing responsive separators.

- [ ] **Step 3: Commit the proof-border fix**

```bash
git add src/styles/public-content.scss src/views/public/public-pages.contract.test.js
git commit -m "fix: restore homepage proof strip border"
```

### Task 5: Verify the complete public-header change

**Files:**
- Verify only; no expected source changes.

- [ ] **Step 1: Run the focused contract suite**

```bash
node --test \
  src/components/shell/AppBrand.contract.test.js \
  src/i18n/public-runtime.test.js \
  src/layouts/visual-shell.contract.test.js \
  src/views/public/public-pages.contract.test.js
```

Expected: all tests PASS with zero failures and skips.

- [ ] **Step 2: Run the production build**

```bash
VITE_USE_MOCK=false npm run build
node scripts/check-public-route-chunks.mjs
```

Expected: build PASS and public route chunk checker PASS.

- [ ] **Step 3: Check repository integrity**

```bash
git diff --check
git status --short
```

Expected: no whitespace errors and no uncommitted files.
