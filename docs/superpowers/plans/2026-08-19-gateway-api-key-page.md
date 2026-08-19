# Gateway API Key Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a secure, responsive API Key management page for the existing Gateway Token CRUD API.

**Architecture:** Use a thin `/api/v1/tokens` adapter, pure secret-redaction/summary helpers, and one routed Vue view using existing Element Plus patterns. A full Token is only transient component state in the post-create confirmation dialog.

**Tech Stack:** Vue 3, Vue Router, Axios, Element Plus, SCSS, Node built-in test runner, Vite.

---

## File structure

- Create `llm-platform/src/api/gatewayTokens.js`: API adapter.
- Create `llm-platform/src/utils/gateway-token-presentation.js`: redaction and summary helpers.
- Create `llm-platform/src/utils/gateway-token-presentation.test.js`: Node-native helper tests.
- Create `llm-platform/src/views/ApiKeys.vue`: overview, table, drawer, one-time secret dialog and revoke confirmation.
- Modify `llm-platform/src/router/index.js`, `llm-platform/src/layouts/MainLayout.vue`, `llm-platform/src/i18n/messages.js`, `llm-platform/package.json`, `feature_list.json`, and `progress.md`.

### Task 1: Test and implement safe presentation helpers

**Files:** Create `llm-platform/src/utils/gateway-token-presentation.{js,test.js}`; modify `llm-platform/package.json`.

- [ ] **Step 1: Write the failing test**

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { apiKeySummary, tokenRows } from './gateway-token-presentation.js'

test('tokenRows strips secrets and counts expiring active tokens', () => {
  const rows = tokenRows([{ token: 'secret', token_hash: 'hash', token_prefix: 'sk-gw-abc', status: 'active', expires_at: '2026-08-20T00:00:00Z' }])
  assert.equal(rows[0].token, undefined)
  assert.equal(rows[0].token_hash, undefined)
  assert.deepEqual(apiKeySummary(rows, new Date('2026-08-19T00:00:00Z')), { active: 1, revoked: 0, expiring: 1 })
})
```

- [ ] **Step 2: Verify red**

Run: `npm test -- gateway-token-presentation.test.js`

Expected: FAIL because the helper module is absent.

- [ ] **Step 3: Implement the smallest helper**

```js
export function tokenRows(tokens = []) {
  return tokens.map(({ token, token_hash, ...item }) => ({
    ...item, tokenPrefix: item.token_prefix || '',
    allowedModels: Array.isArray(item.allowed_models) ? item.allowed_models : [],
    ipAllowlist: Array.isArray(item.ip_allowlist) ? item.ip_allowlist : [],
  }))
}
export function apiKeySummary(rows, now = new Date()) {
  const deadline = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
  return {
    active: rows.filter((row) => row.status === 'active').length,
    revoked: rows.filter((row) => row.status === 'revoked').length,
    expiring: rows.filter((row) => row.status === 'active' && row.expires_at && new Date(row.expires_at) > now && new Date(row.expires_at) <= deadline).length,
  }
}
```

Add `"test": "node --test"` to package scripts, plus empty-list and revoked-token tests.

- [ ] **Step 4: Verify green and commit**

Run: `npm test && npm run build`

Expected: PASS.

```bash
git add llm-platform/package.json llm-platform/src/utils/gateway-token-presentation.js llm-platform/src/utils/gateway-token-presentation.test.js
git commit -m "test(llm-platform): cover gateway token presentation"
```

### Task 2: Add the Gateway Token API adapter

**Files:** Create `llm-platform/src/api/gatewayTokens.js`.

- [ ] **Step 1: Preserve Task 1 redaction tests as the API boundary**

Run: `npm test -- gateway-token-presentation.test.js`

Expected: PASS; callers must convert list data with `tokenRows` before rendering.

- [ ] **Step 2: Implement the adapter**

```js
import request from './request'
const PREFIX = '/api/v1/tokens'
export const listGatewayTokens = () => request.get(PREFIX)
export const getGatewayToken = (id) => request.get(PREFIX + '/' + id)
export const createGatewayToken = (body) => request.post(PREFIX, body)
export const updateGatewayToken = (id, body) => request.patch(PREFIX + '/' + id, body)
export const revokeGatewayToken = (id) => request.post(PREFIX + '/' + id + '/revoke')
```

Never place a returned `token` in storage, Pinia, URL, log or error message.

- [ ] **Step 3: Verify and commit**

Run: `npm test && npm run build`

Expected: PASS.

```bash
git add llm-platform/src/api/gatewayTokens.js
git commit -m "feat(llm-platform): add gateway token API client"
```

### Task 3: Route, navigation, translations and view shell

**Files:** Modify router, `MainLayout.vue`, messages; create `ApiKeys.vue`.

- [ ] **Step 1: Add authenticated route and navigation**

Add `{ path: 'api-keys', name: 'ApiKeys', component: () => import('@/views/ApiKeys.vue') }` to authenticated children. Add `/api-keys` to desktop menu, mobile drawer and user menu without changing existing paths.

- [ ] **Step 2: Add both locales**

Add `nav.apiKeys` and `apiKeys.*` labels in Chinese and English for page title, description, status cards, permissions, create/edit/revoke, copy and safe-secret confirmation.

- [ ] **Step 3: Add the view shell and verify**

```vue
<template><div class="api-keys-page page-container"><div class="page-heading"><div><h1>{{ t('apiKeys.title') }}</h1><p>{{ t('apiKeys.description') }}</p></div><el-button type="primary" @click="openCreate">{{ t('apiKeys.create') }}</el-button></div><el-empty v-if="!loading && !rows.length" :description="t('apiKeys.empty')" /></div></template>
```

Run: `npm test && npm run build`

Expected: PASS with no unresolved translation keys or lazy imports.

### Task 4: Complete management interactions

**Files:** Modify `llm-platform/src/views/ApiKeys.vue`; extend helper test.

- [ ] **Step 1: Write the revoked-token summary test**

```js
test('revoked tokens never count as expiring', () => {
  const rows = tokenRows([{ status: 'revoked', expires_at: '2026-08-20T00:00:00Z' }])
  assert.deepEqual(apiKeySummary(rows, new Date('2026-08-19T00:00:00Z')), { active: 0, revoked: 1, expiring: 0 })
})
```

- [ ] **Step 2: Verify the test and helper are green**

Run: `npm test -- gateway-token-presentation.test.js`

Expected: PASS only when expiring requires `status === 'active'`.

- [ ] **Step 3: Implement table, cards and retry**

On mount call `listGatewayTokens`, convert through `tokenRows`, and derive enabled/revoked/expiring cards via `apiKeySummary`. Render name, prefix, model/IP ACL summary, status, expiry, creation time and actions only. Show retry on load error.

- [ ] **Step 4: Implement create/edit/revoke safely**

Use one drawer for name, models, literal IP allowlist and optional expiry. The allowlist accepts one IPv4 or IPv6 literal per line; reject CIDR and host names before submission while retaining server-side validation as the authority. Successful create may set `createdSecret` only in the component, open a one-time dialog, copy via `navigator.clipboard.writeText`, then clear on confirm and close. Use GET/PATCH for non-secret edits; use confirmed revoke. Never show re-enable for revoked rows.

- [ ] **Step 5: Verify and commit**

Run: `npm test && npm run build`

Expected: PASS.

```bash
git add llm-platform/src/views/ApiKeys.vue llm-platform/src/utils/gateway-token-presentation.js llm-platform/src/utils/gateway-token-presentation.test.js
git commit -m "feat(llm-platform): manage gateway API keys"
```

### Task 5: Evidence and acceptance

**Files:** Modify `feature_list.json`, `progress.md`.

- [ ] **Step 1: Add `web-007` as the sole in-progress feature**

Record `npm test`, `npm run build`, `/api-keys` route smoke and pending authenticated live-Go API checks.

- [ ] **Step 2: Run final local checks**

Run: `npm test && npm run build && git diff --check`

Expected: all commands exit 0.

- [ ] **Step 3: Browser smoke and evidence**

Run: `npm run dev -- --host 127.0.0.1`

Expected: after authentication, desktop/mobile navigation reach `/api-keys`; no full Token appears in the table. Record only observed checks and state that live create/revoke requires a deployed authenticated Go gateway.

## Self-review

- Tasks 1–4 cover the approved independent route, overview, safe list, CRUD, ACL/IP/expiry, one-time Token, responsive navigation and error behavior.
- Every implementation step identifies exact files and verification commands.
- Payload names match the Go API: `allowed_models`, `ip_allowlist`, and `expires_at`; only view helpers use derived camel-case fields.
