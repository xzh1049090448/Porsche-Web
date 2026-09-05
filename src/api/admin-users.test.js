import test from 'node:test'
import assert from 'node:assert/strict'
import { buildAdminUsersQuery, mapUserReadDto, mapPermissionProjection, mapAuthzCatalog, mapUserPermissions, ADMIN_CAPABILITIES, ADMIN_CAPABILITY_DEFINITIONS } from './admin-users.js'
import { createAdminUsersState } from './admin-users-state.js'

test('builds the exact B1-D query and rejects invalid pagination', () => {
  assert.equal(buildAdminUsersQuery({ page: 1, pageSize: 20, q: '  alice  ', role: 'admin', status: 'disabled', sort: 'username', order: 'asc' }), 'page=1&page_size=20&q=alice&role=admin&status=disabled&sort=username&order=asc')
  assert.equal(buildAdminUsersQuery({ page: 2, pageSize: 50, q: 'a&b' }), 'page=2&page_size=50&q=a%26b&sort=guid&order=desc')
  assert.throws(() => buildAdminUsersQuery({ page: 0 }), /invalid_page/)
  assert.throws(() => buildAdminUsersQuery({ pageSize: 21 }), /invalid_page_size/)
  assert.throws(() => buildAdminUsersQuery({ role: 'owner' }), /invalid_role/)
})

test('omits the default active and disabled status and rejects an overlong search instead of truncating it', () => {
  assert.equal(buildAdminUsersQuery({ page: 1, pageSize: 20, status: 'active,disabled' }), 'page=1&page_size=20&sort=guid&order=desc')
  assert.throws(() => buildAdminUsersQuery({ q: '文'.repeat(129) }), /invalid_query/)
  assert.match(buildAdminUsersQuery({ q: '😀' }), /q=%F0%9F%98%80/)
  assert.throws(() => buildAdminUsersQuery({ q: '\uD83D' }), /invalid_query/)
  assert.throws(() => buildAdminUsersQuery({ q: '\uDE00' }), /invalid_query/)
})

test('maps UserReadDTO and rejects unsafe or incomplete values', () => {
  const dto = mapUserReadDto({ guid: '9223372036854775807', username: null, nickname: null, email: null, group: null, plan_type: 'free', role: 'user', status: 'active', created_at: '2026-09-03T00:00:00Z', last_login_at: null })
  assert.deepEqual(dto, { guid: '9223372036854775807', username: null, nickname: null, email: null, group: null, planType: 'free', role: 'user', status: 'active', createdAt: '2026-09-03T00:00:00Z', lastLoginAt: null })
  assert.throws(() => mapUserReadDto({ ...dto, guid: '01' }), /invalid_guid/)
  assert.throws(() => mapUserReadDto({ guid: '1', username: 'x', plan_type: 'hacked', role: 'user', status: 'active', created_at: 'bad', last_login_at: null }), /invalid_user/)
  assert.throws(() => mapUserReadDto({ guid: '1', username: 'x', nickname: null, email: null, group: null, plan_type: 'free', role: 'user', status: 'active', created_at: '2026-09-03T00:00:00+08:00', last_login_at: null }), /invalid_user/)
  assert.throws(() => mapUserReadDto({ guid: '1', username: 'x', nickname: null, email: null, group: null, plan_type: 'free', role: 'user', status: 'active', created_at: '2026-09-03T00:00:00Z', last_login_at: null, internal_id: 9 }), /invalid_user/)
})

test('permission projection fails closed for unknown or duplicate capabilities', () => {
  const valid = { admin_permissions: ['users.read', 'users.audit.read'], permissions_version: '12' }
  assert.deepEqual(mapPermissionProjection(valid), { capabilities: ['users.read', 'users.audit.read'], version: '12' })
  for (const bad of [{ admin_permissions: ['unknown'], permissions_version: '1' }, { admin_permissions: ['users.read', 'users.read'], permissions_version: '1' }, { admin_permissions: [], permissions_version: '-1' }, {}]) assert.equal(mapPermissionProjection(bad), null)
  assert.equal(ADMIN_CAPABILITIES.length, 24)
})

test('validates the fixed catalog including the unavailable quota capability', () => {
  const catalog = {
    catalog_version: 1,
    override_effects: ['inherit', 'allow', 'deny'],
    capabilities: ADMIN_CAPABILITY_DEFINITIONS.map(({ name, baseline, grantable, rootOnly, available }) => ({ name, admin_default: baseline, grantable, root_only: rootOnly, available })),
  }
  assert.equal(mapAuthzCatalog(catalog).capabilities[10].available, false)
  assert.throws(() => mapAuthzCatalog({ ...catalog, capabilities: catalog.capabilities.slice(1) }), /invalid_catalog/)
  assert.throws(() => mapAuthzCatalog({ ...catalog, extra: true }), /invalid_catalog/)
})

test('permission rows obey the fixed catalog semantics', () => {
  const row = definition => ({ name: definition.name, baseline: definition.baseline, override: 'inherit', policy_effective: definition.baseline, effective: definition.baseline })
  const capabilities = ADMIN_CAPABILITY_DEFINITIONS.map(row)
  capabilities[0] = { ...capabilities[0], override: 'deny', policy_effective: false, effective: false }
  capabilities[5] = { ...capabilities[5], override: 'allow', policy_effective: true, effective: true }
  capabilities[10] = { ...capabilities[10], policy_effective: false, effective: false }
  for (const index of [13, 14, 15, 18]) capabilities[index] = { ...capabilities[index], policy_effective: false, effective: false }
  const raw = { user_guid: '2', role: 'admin', status: 'active', catalog_version: 1, permissions_version: '1', capabilities }
  assert.equal(mapUserPermissions(raw, '2').capabilities[5].effective, true)
  assert.throws(() => mapUserPermissions({ ...raw, capabilities: capabilities.map((item, index) => index === 10 ? { ...item, override: 'allow' } : item) }, '2'), /invalid_permissions/)
  assert.throws(() => mapUserPermissions({ ...raw, status: 'disabled', capabilities: capabilities.map(item => ({ ...item, effective: item.policy_effective })) }, '2'), /invalid_permissions/)
})

function deferred() {
  let resolve; let reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

test('admin state ignores late list success, error, and finally after a newer filter request', async () => {
  const firstPending = deferred(); const secondPending = deferred(); const pending = [firstPending, secondPending]
  let capturedGeneration = 0
  const auth = {
    capture: () => ({ epoch: 'same', generation: capturedGeneration }),
    assertCurrent: context => { if (context.generation !== capturedGeneration) throw Object.assign(new Error('identity_changed'), { code: 'identity_changed' }) },
    onInvalidate: () => () => {},
  }
  const state = createAdminUsersState({ auth, api: { list: () => pending.shift().promise } })
  const first = state.loadList({ q: 'old' })
  const second = state.loadList({ q: 'new' })
  secondPending.resolve({ items: [], total: 1, page: 1, pageSize: 20 })
  await second
  firstPending.reject(new Error('obsolete'))
  await first
  assert.equal(state.value.loading, false)
  assert.equal(state.value.error, null)
  assert.equal(state.value.total, 1)
})

test('admin state announces the recovered page before requesting the last page', async () => {
  const calls = []
  const auth = { capture: () => ({ epoch: 'same', generation: 1 }), assertCurrent: () => {}, onInvalidate: () => () => {} }
  const state = createAdminUsersState({ auth, api: {
    list: async filters => {
      calls.push({ ...filters, recoveredPage: state.value.recoveredPage, recoveryRevision: state.value.recoveryRevision })
      if (filters.page === 2) return { items: [], total: 20, page: 2, pageSize: 20 }
      return { items: [{ guid: '1' }], total: 20, page: 1, pageSize: 20 }
    },
  } })
  const result = await state.loadList({ page: 2, pageSize: 20 })
  assert.equal(result.page, 1)
  assert.deepEqual(calls, [
    { page: 2, pageSize: 20, recoveredPage: null, recoveryRevision: 0 },
    { page: 1, pageSize: 20, recoveredPage: 1, recoveryRevision: 1 },
  ])
})

test('a stale A response cannot erase data loaded by B after authentication invalidation', async () => {
  const first = deferred(); const second = deferred(); const pending = [first, second]
  let invalidate
  let capturedGeneration = 1
  const auth = {
    capture: () => ({ epoch: 'same', generation: capturedGeneration }),
    assertCurrent: context => { if (context.generation !== capturedGeneration) throw Object.assign(new Error('identity_changed'), { code: 'identity_changed' }) },
    onSnapshotInvalidate: fn => { invalidate = fn; return () => {} },
  }
  const state = createAdminUsersState({ auth, api: { list: () => pending.shift().promise } })
  const oldRequest = state.loadList({ q: 'A' })
  capturedGeneration = 2
  invalidate()
  const newRequest = state.loadList({ q: 'B' })
  second.resolve({ items: [{ guid: '2' }], total: 1, page: 1, pageSize: 20 })
  await newRequest
  first.reject(new Error('late A failure'))
  await oldRequest
  assert.deepEqual(state.value.rows, [{ guid: '2' }])
  assert.equal(state.value.total, 1)
  assert.equal(state.value.error, null)
})

test('a stale A finally cannot clear B loading state after authentication invalidation', async () => {
  const first = deferred(); const second = deferred(); const pending = [first, second]
  let invalidate; let capturedGeneration = 1
  const auth = {
    capture: () => ({ epoch: 'same', generation: capturedGeneration }),
    assertCurrent: context => { if (context.generation !== capturedGeneration) throw Object.assign(new Error('identity_changed'), { code: 'identity_changed' }) },
    onSnapshotInvalidate: fn => { invalidate = fn; return () => {} },
  }
  const state = createAdminUsersState({ auth, api: { list: () => pending.shift().promise } })
  const oldRequest = state.loadList({ q: 'A' })
  capturedGeneration = 2; invalidate()
  const newRequest = state.loadList({ q: 'B' })
  first.resolve({ items: [{ guid: '1' }], total: 1, page: 1, pageSize: 20 })
  await oldRequest
  assert.equal(state.value.loading, true)
  second.resolve({ items: [{ guid: '2' }], total: 1, page: 1, pageSize: 20 })
  await newRequest
  assert.equal(state.value.loading, false)
})

test('admin detail waits for the target role before requesting Root-only permissions and clears a hidden target error', async () => {
  const calls = []
  let shouldFail = false
  const auth = { capture: () => ({ epoch: 'same', generation: 1 }), assertCurrent: () => {}, onInvalidate: () => () => {} }
  const state = createAdminUsersState({ auth, api: {
    detail: async () => { if (shouldFail) throw Object.assign(new Error('missing'), { response: { status: 404 } }); return { guid: '2', role: 'admin' } },
    permissions: async guid => { calls.push(`permissions:${guid}`); return { user_guid: guid } },
    catalog: async () => { calls.push('catalog'); return { catalog_version: 1 } },
  } })
  await state.loadDetail('2', { isRoot: true })
  assert.deepEqual(calls, ['permissions:2', 'catalog'])
  shouldFail = true
  await assert.rejects(() => state.loadDetail('2', { isRoot: true }))
  assert.equal(state.value.selected, null)
})
