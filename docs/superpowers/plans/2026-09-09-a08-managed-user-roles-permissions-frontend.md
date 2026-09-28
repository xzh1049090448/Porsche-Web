# A08 Managed-User Roles and Permissions Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add accessible Root-only promotion, demotion and permission-editor workflows with exact verified-action recovery and stale-result protection.

**Architecture:** A strict adapter validates all DTOs, headers and operation states. A memory-only attempt store owns secrets and recovery state, while `UserDetail` owns route/identity/version reconciliation. A controlled permission editor handles catalog display and canonical full-policy serialization.

**Tech Stack:** Vue 3.5, Pinia 2, Element Plus 2, JavaScript, Axios adapters, Node test runner, Vite 6, Playwright/Chrome.

---

### Task 1: Cross-copy and execute the frozen contract

**Files:**
- Create: `docs/agents/contracts/admin-user-roles-permissions-v1.json`
- Create: `src/api/admin-user-roles-permissions-contract.test.js`

- [ ] **Step 1: Write the failing parity test**

```js
test('A08 frontend contract is byte-identical to backend', () => {
  assert.deepEqual(readFrontendBytes(), readBackendBytes())
  assert.deepEqual(contract.scopes, ['users.promote', 'users.demote', 'users.permissions.write'])
})
```

- [ ] **Step 2: Run `node --test src/api/admin-user-roles-permissions-contract.test.js`**

Expected: FAIL because the frontend contract is absent.

- [ ] **Step 3: Copy reviewed backend bytes and assert every request/result/error scope**

Resolve the authoritative backend repository and recorded revision. Do not reformat the JSON. Assert strict requests, stable response fields, failure allowlists, exact scopes and memory-only secret rules.

- [ ] **Step 4: Rerun the test and commit**

Expected: PASS.

```bash
git add docs/agents/contracts/admin-user-roles-permissions-v1.json src/api/admin-user-roles-permissions-contract.test.js
git commit -m "docs: freeze A08 frontend contract"
```

### Task 2: Implement the exact API adapter

**Files:**
- Create: `src/api/admin-user-roles-permissions.js`
- Create: `src/api/admin-user-roles-permissions.test.js`
- Modify: `src/api/request.js`

- [ ] **Step 1: Write failing transport and validation tests**

Cover exact Issue, role Execute, permission PATCH and each Query URL/header/body. Reject extra/missing fields, invalid GUID/version/role/effect, bad no-store/request-ID, invalid Retry-After and error-envelope drift.

```js
test('permission replacement sends exact verified PATCH', async () => {
  const api = createRolePermissionApi(fakeTransport)
  await api.executePermissionWrite(input)
  assert.deepEqual(fakeTransport.last, {
    method: 'PATCH', path: `/admin/v2/users/${input.targetGuid}/permissions`,
    headers: { 'Idempotency-Key': input.idempotencyKey, 'X-Action-Ticket': input.ticket },
    body: { expected_auth_version: 7, expected_permissions_version: 3, catalog_version: 1,
      overrides: [{ capability: 'users.delete', effect: 'deny' }], reason: 'rotation' },
  })
})
```

- [ ] **Step 2: Run `node --test src/api/admin-user-roles-permissions.test.js`**

Expected: FAIL because the adapter is absent.

- [ ] **Step 3: Implement typed methods and canonical serialization**

```js
export function createRolePermissionApi({ post, patch, get }) {
  return Object.freeze({
    issuePromote: input => issue('users.promote', promoteIntent(input), input.currentPassword, post),
    executePromote: input => executeRole('promote', input, post),
    issueDemote: input => issue('users.demote', demoteIntent(input), input.currentPassword, post),
    executeDemote: input => executeRole('demote', input, post),
    issuePermissionWrite: input => issue('users.permissions.write', permissionIntent(input), input.currentPassword, post),
    executePermissionWrite: input => executePermissions(input, patch),
    query: input => queryOperation(input.scope, input.idempotencyKey, get),
  })
}
```

Keep inherit in editor state and omit it from sorted wire overrides.

- [ ] **Step 4: Rerun adapter/contract tests and commit**

Expected: PASS.

```bash
git add src/api/admin-user-roles-permissions.js src/api/admin-user-roles-permissions.test.js src/api/request.js
git commit -m "feat(admin): add A08 role permission API"
```

### Task 3: Build the memory-only attempt state machine

**Files:**
- Create: `src/api/admin-user-roles-permissions-state.js`
- Create: `src/api/admin-user-roles-permissions-state.test.js`
- Create: `src/stores/admin-user-role-permissions.js`
- Create: `src/stores/admin-user-role-permissions.test.js`

- [ ] **Step 1: Write failing lifecycle tests**

Cover idle, verifying, executing, querying, succeeded, conflict, failed and pending recovery. Prove singleflight, no mutation replay, original-key Query, Retry-After, secret clearing and late-owner rejection.

```js
test('commit unknown queries with the original key', async () => {
  const store = createAttemptStore(deps)
  await store.submit(validInput)
  assert.equal(deps.execute.calls, 1)
  assert.equal(deps.query.calls, 1)
  assert.equal(deps.query.args[0].idempotencyKey, deps.execute.args[0].idempotencyKey)
})
```

- [ ] **Step 2: Run the two focused state/store test files**

Expected: FAIL because the state machine is absent.

- [ ] **Step 3: Implement one mutually exclusive typed owner**

```js
const terminal = new Set(['succeeded', 'conflict', 'failed'])
export function ownsAttempt(state, token, context) {
  return state.token === token && state.context === context && !terminal.has(state.phase)
}
```

Expose `openPromote`, `openDemote`, `openPermissions`, `submit`, `close` and `dispose`. Hold password, ticket and key in closure-private variables, never serializable Pinia state.

- [ ] **Step 4: Rerun focused tests and commit**

Expected: PASS.

```bash
git add src/api/admin-user-roles-permissions-state.js src/api/admin-user-roles-permissions-state.test.js src/stores/admin-user-role-permissions.js src/stores/admin-user-role-permissions.test.js
git commit -m "feat(admin): coordinate A08 verified attempts"
```

### Task 4: Add the controlled permission editor

**Files:**
- Create: `src/components/admin/UserPermissionEditor.vue`
- Create: `src/components/admin/UserPermissionEditor.contract.test.js`
- Create: `src/components/admin/UserPermissionEditor.element-plus.test.js`

- [ ] **Step 1: Write failing catalog/serialization tests**

Prove 24-capability order, stable module groups, baseline/override/effective/source display, locked Root-only/unavailable rows, unknown/duplicate fail-closed behavior and sorted allow/deny emission.

- [ ] **Step 2: Run `node --test src/components/admin/UserPermissionEditor*.test.js`**

Expected: FAIL because the component is absent.

- [ ] **Step 3: Implement the controlled editor**

```vue
<el-radio-group :model-value="row.override" :disabled="!row.grantable || !row.available"
  @update:model-value="effect => update(row.name, effect)">
  <el-radio-button value="inherit">继承</el-radio-button>
  <el-radio-button value="allow">允许</el-radio-button>
  <el-radio-button value="deny">拒绝</el-radio-button>
</el-radio-group>
```

Accept immutable catalog/policy props and emit a newly allocated canonical policy. Do not call APIs or decide actor authorization here.

- [ ] **Step 4: Rerun component tests and commit**

Expected: PASS.

```bash
git add src/components/admin/UserPermissionEditor.vue src/components/admin/UserPermissionEditor.contract.test.js src/components/admin/UserPermissionEditor.element-plus.test.js
git commit -m "feat(admin): add permission override editor"
```

### Task 5: Add accessible action dialogs

**Files:**
- Create: `src/components/admin/UserPromoteDialog.vue`
- Create: `src/components/admin/UserDemoteDialog.vue`
- Create: `src/components/admin/UserPermissionsDialog.vue`
- Create: `src/components/admin/UserRolePermissionDialogs.contract.test.js`
- Create: `src/components/admin/UserRolePermissionDialogs.element-plus.test.js`

- [ ] **Step 1: Write failing dialog tests**

Test native form submit, normalized reason/password, baseline promote default, optional editor, session warnings, pending-recovery text, error focus, focus trap, trigger restoration, singleflight and secret clearing.

- [ ] **Step 2: Run `node --test src/components/admin/UserRolePermissionDialogs*.test.js`**

Expected: FAIL because the dialogs are absent.

- [ ] **Step 3: Implement narrow dialogs with one event contract**

Each dialog emits `succeeded(result, token)`, `conflict(token)`, `failed(code, token)` and `closed(token)`. Promotion and permission dialogs mount `UserPermissionEditor`; demotion accepts no overrides. Submit calls only the active owner's store command.

- [ ] **Step 4: Rerun dialog tests and commit**

Expected: PASS.

```bash
git add src/components/admin/UserPromoteDialog.vue src/components/admin/UserDemoteDialog.vue src/components/admin/UserPermissionsDialog.vue src/components/admin/UserRolePermissionDialogs.contract.test.js src/components/admin/UserRolePermissionDialogs.element-plus.test.js
git commit -m "feat(admin): add A08 role permission dialogs"
```

### Task 6: Wire UserDetail eligibility and owned reconciliation

**Files:**
- Modify: `src/views/UserDetail.vue`
- Create: `src/views/UserDetail.roles-permissions.contract.test.js`
- Create: `src/views/UserDetail.roles-permissions.integration.test.js`
- Modify: `src/stores/admin-users.js`
- Modify: `src/api/admin-users.js`

- [ ] **Step 1: Write failing mounted tests**

Prove Root/User shows promote; Root/Admin shows permissions/demote; Admin actor, self, Root/deleted target and stale route show none. Prove one owned refresh on trusted success and drop on route/identity/capability/version/owner drift.

```js
export function canOpenPromote({ actorRole, actorGuid, capabilities, target }) {
  return actorRole === 'root' && actorGuid !== target?.guid && target?.role === 'user'
    && ['active', 'disabled'].includes(target?.status) && capabilities?.includes('users.promote')
}
```

- [ ] **Step 2: Run `node --test src/views/UserDetail.roles-permissions*.test.js`**

Expected: FAIL because A08 controls are not mounted.

- [ ] **Step 3: Mount controls/dialogs and refresh guards**

Make A08 mutually exclusive with edit/status/delete/A07 dialogs. On success require stable target/role/auth/policy values before one fresh detail/permission GET. On 409 perform at most one owned refresh and require a new gesture. Never apply optimistic role/policy changes.

- [ ] **Step 4: Rerun view/store/API tests and commit**

Expected: PASS.

```bash
git add src/views/UserDetail.vue src/views/UserDetail.roles-permissions.contract.test.js src/views/UserDetail.roles-permissions.integration.test.js src/stores/admin-users.js src/api/admin-users.js
git commit -m "feat(admin): mount A08 role permission workflows"
```

### Task 7: Run frontend and joint acceptance gates

**Files:**
- Create: `docs/agents/validation/a08-managed-user-roles-permissions-20260909/manifest.json`
- Create: `docs/agents/validation/a08-managed-user-roles-permissions-20260909/report.md`
- Modify: `feature_list.json`
- Modify: `progress.md`

- [ ] **Step 1: Run focused/full/build gates**

```bash
node --test src/api/admin-user-roles-permissions*.test.js src/stores/admin-user-role-permissions.test.js src/components/admin/UserPermissionEditor*.test.js src/components/admin/UserRolePermissionDialogs*.test.js src/views/UserDetail.roles-permissions*.test.js
npm test
env VITE_USE_MOCK=false npm run build
git diff --check
```

Expected: all tests pass; build may retain only previously recorded Rollup warnings.

- [ ] **Step 2: Run visible browser acceptance**

Use disposable User/Admin fixtures. Verify baseline and override promotion, permission save, demotion, 409 refresh, commit-unknown Query, disabled targets, keyboard/focus and 375px/390px layouts. Capture exact network counts and cleanup.

- [ ] **Step 3: Run real cross-stack checks**

Against the paired backend candidate with isolated MySQL 8/Redis 7, prove old Access/Refresh rejection, current Gateway Key authorization, no residual demoted policy, safe later promotion and exact database/audit terminal facts. Mock evidence cannot satisfy this step.

- [ ] **Step 4: Obtain independent specification, security and visible-UX reviews**

Resolve material findings and rerun affected focused/full gates.

- [ ] **Step 5: Update bounded status and commit**

Set A08 inside `web-012` to `PASS_LIMITED_SCOPE` only with complete evidence. Preserve unrelated blockers, production migration/deployment/acceptance and external PM confirmation.

```bash
git add docs/agents/validation/a08-managed-user-roles-permissions-20260909 feature_list.json progress.md
git commit -m "docs: record A08 joint acceptance"
```
