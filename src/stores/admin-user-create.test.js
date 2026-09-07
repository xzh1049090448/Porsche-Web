import test from 'node:test'
import assert from 'node:assert/strict'
import { createPinia, setActivePinia } from 'pinia'
import {
  availableAdminUserCreateRoles,
  buildAdminPermissionOverrides,
  canChooseAdminUserCreateGroup,
  canChooseAdminUserCreatePlan,
  canOpenAdminUserCreate,
  canSubmitAdminUserCreate,
  clearAdminUserCreateSecrets,
  createAdminUserCreateCoordinator,
  focusAdminUserCreateInvalidField,
  normalizeAdminUserCreateFormAuthorization,
  reconcileAdminUserCreateConflict,
  restoreAdminUserCreateTriggerFocus,
  settleAdminUserCreateDialog,
  useAdminUserCreateStore,
} from './admin-user-create.js'
import { DEFAULT_ADMIN_GROUP_CHOICE } from '../api/admin-groups.js'
import { reconcileCreatedAdminUser } from './admin-users.js'

const createdUser = Object.freeze({
  guid: '123456789012345678', username: 'alice', nickname: 'Alice', email: null, group: 'default',
  planType: 'free', role: 'user', status: 'active', authVersion: 1,
  createdAt: '2026-09-06T00:00:00.000Z', lastLoginAt: null,
})

function deferred() {
  let resolve
  let reject
  const promise = new Promise((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}

function workflowFactory(terminals = [{ state: 'succeeded', operationRef: 'op_safe', failureCode: null, createdUser }]) {
  const workflows = []
  const starts = []
  const createWorkflow = () => {
    let snapshot = { state: 'idle', operationRef: null, failureCode: null, createdUser: null }
    const listeners = new Set()
    const workflow = {
      async start(input) {
        starts.push(structuredClone(input))
        const terminal = terminals.shift()
        if (terminal?.promise) return terminal.promise
        snapshot = terminal
        listeners.forEach(listener => listener(snapshot))
        return terminal
      },
      reset() {
        snapshot = { state: 'idle', operationRef: null, failureCode: null, createdUser: null }
        listeners.forEach(listener => listener(snapshot))
        return true
      },
      unmount() { workflow.unmounted = true },
      subscribe(listener) { listeners.add(listener); listener(snapshot); return () => listeners.delete(listener) },
    }
    workflows.push(workflow)
    return workflow
  }
  return { createWorkflow, workflows, starts }
}

function coordinatorFixture(overrides = {}) {
  const workflow = workflowFactory(overrides.terminals)
  const succeeded = []
  const conflicts = []
  let unauthorized = 0
  const coordinator = createAdminUserCreateCoordinator({
    api: {}, createWorkflow: workflow.createWorkflow, randomBytes: () => new Uint8Array(32), schedule: () => () => {},
    loadGroups: overrides.loadGroups ?? (async () => [DEFAULT_ADMIN_GROUP_CHOICE]),
    loadCatalog: overrides.loadCatalog ?? (async () => ({ catalog_version: 1, override_effects: ['inherit', 'allow', 'deny'], capabilities: [] })),
    onSucceeded: value => succeeded.push(value),
    onConflict: value => { conflicts.push(value); return true },
    onUnauthorized: () => { unauthorized++ },
  })
  return { coordinator, succeeded, conflicts, workflow, get unauthorized() { return unauthorized } }
}

test('Pinia exposes dialog visibility separately from open and close actions', () => {
  setActivePinia(createPinia())
  const store = useAdminUserCreateStore()
  assert.equal(store.isOpen, false)
  assert.equal(typeof store.openDialog, 'function')
  assert.equal(typeof store.closeDialog, 'function')

  const token = store.openDialog({ actorRole: 'admin', capabilities: ['users.create'] })
  assert.ok(token)
  assert.equal(store.isOpen, true)
  assert.equal(store.closeDialog(token), true)
  assert.equal(store.isOpen, false)
})

test('entry, roles, plans, and groups fail closed against the current projection', () => {
  assert.equal(canOpenAdminUserCreate({ actorRole: 'admin', capabilities: ['users.create'] }), true)
  assert.equal(canOpenAdminUserCreate({ actorRole: 'root', capabilities: ['users.create'] }), true)
  for (const input of [
    { actorRole: 'admin', capabilities: undefined },
    { actorRole: 'admin', capabilities: [] },
    { actorRole: 'user', capabilities: ['users.create'] },
  ]) assert.equal(canOpenAdminUserCreate(input), false)

  assert.deepEqual(availableAdminUserCreateRoles('admin'), ['user'])
  assert.deepEqual(availableAdminUserCreateRoles('root'), ['user', 'admin'])
  assert.deepEqual(availableAdminUserCreateRoles('user'), [])
  assert.equal(canChooseAdminUserCreatePlan(['users.create'], 'free'), true)
  assert.equal(canChooseAdminUserCreatePlan(['users.create'], 'professional'), false)
  assert.equal(canChooseAdminUserCreatePlan(['users.create', 'users.plan.change'], 'enterprise'), true)
  assert.equal(canChooseAdminUserCreateGroup(['users.create'], DEFAULT_ADMIN_GROUP_CHOICE), true)
  assert.equal(canChooseAdminUserCreateGroup(['users.create', 'groups.read'], { guid: '41', key: 'default', displayName: 'Default' }), true)
  assert.equal(canChooseAdminUserCreateGroup(['users.create', 'groups.read'], { guid: '42', key: 'team', displayName: 'Team' }), false)
  assert.equal(canChooseAdminUserCreateGroup(['users.create', 'groups.read', 'users.group.change'], { guid: '42', key: 'team', displayName: 'Team' }), true)
})

test('permission overrides exist only for administrator creation and omit inherit', () => {
  const catalog = { capabilities: [
    { name: 'users.read', grantable: true, root_only: false, available: true },
    { name: 'users.quota.adjust', grantable: false, root_only: false, available: false },
    { name: 'users.promote', grantable: false, root_only: true, available: true },
    { name: 'groups.read', grantable: true, root_only: false, available: true },
  ] }
  assert.deepEqual(buildAdminPermissionOverrides({ role: 'user', catalog: null, effects: {} }), [])
  assert.deepEqual(buildAdminPermissionOverrides({ role: 'admin', catalog, effects: {
    'users.read': 'deny', 'groups.read': 'inherit',
  } }), [{ capability: 'users.read', effect: 'deny' }])
  assert.throws(() => buildAdminPermissionOverrides({ role: 'admin', catalog, effects: { 'users.promote': 'allow' } }), /invalid_permission_override/)
  assert.throws(() => buildAdminPermissionOverrides({ role: 'admin', catalog, effects: { unknown: 'allow' } }), /invalid_permission_override/)
})

test('Admin stays on user while Root administrator selection alone loads the authz catalog', async () => {
  const groupCalls = []
  const catalogCalls = []
  const f = coordinatorFixture({
    loadGroups: async capabilities => { groupCalls.push([...capabilities]); return [DEFAULT_ADMIN_GROUP_CHOICE] },
    loadCatalog: async () => { catalogCalls.push(true); return { capabilities: [] } },
  })
  const adminToken = f.coordinator.open({ actorRole: 'admin', capabilities: ['users.create'] })
  await f.coordinator.whenPrepared(adminToken)
  assert.equal(f.coordinator.state.role, 'user')
  assert.equal(await f.coordinator.setRole(adminToken, 'admin'), false)
  assert.equal(catalogCalls.length, 0)
  f.coordinator.close(adminToken)

  const rootToken = f.coordinator.open({ actorRole: 'root', capabilities: ['users.create', 'groups.read'] })
  await f.coordinator.whenPrepared(rootToken)
  assert.equal(await f.coordinator.setRole(rootToken, 'admin'), true)
  assert.equal(catalogCalls.length, 1)
  assert.equal(f.coordinator.state.catalog != null, true)
  assert.deepEqual(groupCalls, [['users.create', 'groups.read']])
})

test('missing groups.read never calls the directory and keeps the immutable omitted default', async () => {
  let groupCalls = 0
  const f = coordinatorFixture({ loadGroups: async () => { groupCalls++; return [] } })
  const token = f.coordinator.open({ actorRole: 'admin', capabilities: ['users.create'] })
  await f.coordinator.whenPrepared(token)
  assert.equal(groupCalls, 0)
  assert.deepEqual(f.coordinator.state.groups, [DEFAULT_ADMIN_GROUP_CHOICE])
  assert.equal(Object.isFrozen(f.coordinator.state.groups), true)
})

test('groups.read fails closed while the directory is pending, failed, empty, or has no selected active item', async () => {
  const base = {
    state: 'idle', role: 'user', catalog: null, authorizing: false,
    capabilities: ['users.create', 'groups.read'], groupsLoading: false, groupsError: false,
    groups: [{ guid: '41', key: 'default', displayName: 'Default' }], groupGuid: '41',
  }
  assert.equal(canSubmitAdminUserCreate(base), true)
  for (const change of [
    { groupsLoading: true },
    { groupsError: true },
    { groups: [] },
    { groupGuid: null },
    { groupGuid: '42' },
  ]) assert.equal(canSubmitAdminUserCreate({ ...base, ...change }), false)

  assert.equal(canSubmitAdminUserCreate({
    ...base, capabilities: ['users.create'], groups: Object.freeze([DEFAULT_ADMIN_GROUP_CHOICE]), groupGuid: null,
  }), true, 'without groups.read the immutable omitted default remains submit-safe')
})

test('group directory failure and pending state start zero create or verification requests', async () => {
  const pendingGroups = deferred()
  const pending = coordinatorFixture({ loadGroups: async () => pendingGroups.promise })
  const pendingToken = pending.coordinator.open({ actorRole: 'admin', capabilities: ['users.create', 'groups.read'] })
  const input = { username: 'alice', password: 'Str0ng!Pass', role: 'user', groupGuid: null, planType: 'free', permissionOverrides: [] }
  assert.equal(pending.coordinator.submit(pendingToken, { ...input }), null)
  assert.equal(pending.workflow.starts.length, 0)
  pendingGroups.resolve([])
  assert.equal(await pending.coordinator.whenPrepared(pendingToken), false)
  assert.equal(pending.coordinator.submit(pendingToken, { ...input }), null)
  assert.equal(pending.workflow.starts.length, 0)

  const selected = coordinatorFixture({ loadGroups: async () => [{ guid: '41', key: 'default', displayName: 'Default' }] })
  const selectedToken = selected.coordinator.open({ actorRole: 'admin', capabilities: ['users.create', 'groups.read'] })
  await selected.coordinator.whenPrepared(selectedToken)
  assert.equal(selected.coordinator.submit(selectedToken, { ...input, groupGuid: null }), null)
  assert.equal(selected.coordinator.submit(selectedToken, { ...input, groupGuid: '42' }), null)
  assert.equal(selected.workflow.starts.length, 0)
})

test('policy conflict refreshes identity, current capabilities, groups, and the applicable catalog once', async () => {
  let identityCalls = 0
  let groupCalls = 0
  let catalogCalls = 0
  const nextGroups = deferred()
  const nextCatalog = deferred()
  const f = coordinatorFixture({
    loadGroups: async () => ++groupCalls === 1
      ? [{ guid: '41', key: 'old-default', displayName: 'Old default' }]
      : nextGroups.promise,
    loadCatalog: async () => ++catalogCalls === 1
      ? { capabilities: [{ name: 'old.permission', grantable: true, root_only: false, available: true }] }
      : nextCatalog.promise,
  })
  const token = f.coordinator.open({ actorRole: 'root', capabilities: ['users.create', 'groups.read'] })
  await f.coordinator.whenPrepared(token)
  await f.coordinator.setRole(token, 'admin')
  assert.equal(f.coordinator.state.groups[0].key, 'old-default')
  assert.equal(f.coordinator.state.catalog.capabilities[0].name, 'old.permission')

  const refreshing = reconcileAdminUserCreateConflict({
    code: 'policy_version_conflict',
    token,
    createStore: f.coordinator,
    refreshIdentity: async () => { identityCalls++ },
    currentContext: () => ({ actorRole: 'root', capabilities: ['users.create', 'groups.read', 'users.plan.change'] }),
  })
  assert.deepEqual(f.coordinator.state.groups, [], 'stale group directory must be cleared before refresh settles')
  assert.equal(f.coordinator.state.catalog, null, 'stale authz catalog must be cleared before refresh settles')
  nextGroups.resolve([{ guid: '42', key: 'new-default', displayName: 'New default' }])
  nextCatalog.resolve({ capabilities: [{ name: 'users.read', grantable: true, root_only: false, available: true }] })
  assert.equal(await refreshing, true)
  assert.equal(identityCalls, 1)
  assert.equal(groupCalls, 2)
  assert.equal(catalogCalls, 2)
  assert.deepEqual(f.coordinator.state.capabilities, ['users.create', 'groups.read', 'users.plan.change'])
  assert.equal(f.coordinator.state.groups[0].key, 'new-default')
  assert.equal(f.coordinator.state.catalog.capabilities[0].name, 'users.read')
})

test('group-not-found refreshes active groups once and makes zero directory requests without groups.read', async () => {
  let groupCalls = 0
  let identityCalls = 0
  const nextGroups = deferred()
  const withDirectory = coordinatorFixture({
    loadGroups: async () => ++groupCalls === 1
      ? [{ guid: '41', key: 'old-default', displayName: 'Old default' }]
      : nextGroups.promise,
  })
  const directoryToken = withDirectory.coordinator.open({ actorRole: 'admin', capabilities: ['users.create', 'groups.read'] })
  await withDirectory.coordinator.whenPrepared(directoryToken)
  const refreshing = reconcileAdminUserCreateConflict({
    code: 'action_group_not_found', token: directoryToken, createStore: withDirectory.coordinator,
    refreshIdentity: async () => { identityCalls++ }, currentContext: () => assert.fail('group refresh does not need identity context'),
  })
  assert.deepEqual(withDirectory.coordinator.state.groups, [])
  nextGroups.resolve([{ guid: '42', key: 'new-default', displayName: 'New default' }])
  assert.equal(await refreshing, true)
  assert.equal(groupCalls, 2)
  assert.equal(identityCalls, 0)
  assert.equal(withDirectory.coordinator.state.groups[0].key, 'new-default')

  let forbiddenCalls = 0
  const withoutDirectory = coordinatorFixture({ loadGroups: async () => { forbiddenCalls++; return [] } })
  const defaultToken = withoutDirectory.coordinator.open({ actorRole: 'admin', capabilities: ['users.create'] })
  await withoutDirectory.coordinator.whenPrepared(defaultToken)
  assert.equal(await reconcileAdminUserCreateConflict({
    code: 'action_group_not_found', token: defaultToken, createStore: withoutDirectory.coordinator,
    refreshIdentity: async () => { identityCalls++ }, currentContext: () => assert.fail('group refresh does not need identity context'),
  }), true)
  assert.equal(forbiddenCalls, 0)
  assert.equal(identityCalls, 0)
  assert.deepEqual(withoutDirectory.coordinator.state.groups, [DEFAULT_ADMIN_GROUP_CHOICE])
  assert.equal(Object.isFrozen(withoutDirectory.coordinator.state.groups), true)
})

test('policy refresh makes zero forbidden group or catalog requests after a capability downgrade', async () => {
  let groupCalls = 0
  let catalogCalls = 0
  const f = coordinatorFixture({
    loadGroups: async () => { groupCalls++; return [{ guid: '41', key: 'old-default', displayName: 'Old default' }] },
    loadCatalog: async () => { catalogCalls++; return { capabilities: [] } },
  })
  const token = f.coordinator.open({ actorRole: 'root', capabilities: ['users.create', 'groups.read'] })
  await f.coordinator.whenPrepared(token)
  await f.coordinator.setRole(token, 'admin')
  assert.deepEqual([groupCalls, catalogCalls], [1, 1])

  assert.equal(await reconcileAdminUserCreateConflict({
    code: 'policy_version_conflict', token, createStore: f.coordinator,
    refreshIdentity: async () => {},
    currentContext: () => ({ actorRole: 'admin', capabilities: ['users.create'] }),
  }), true)
  assert.deepEqual([groupCalls, catalogCalls], [1, 1])
  assert.equal(f.coordinator.state.role, 'user')
  assert.equal(f.coordinator.state.catalog, null)
  assert.deepEqual(f.coordinator.state.groups, [DEFAULT_ADMIN_GROUP_CHOICE])
})

test('permission rejection blocks old Root actions and normalizes a downgraded Admin actor before retry', async () => {
  let groupCalls = 0
  let catalogCalls = 0
  const identity = deferred()
  const f = coordinatorFixture({
    loadGroups: async () => { groupCalls++; return [{ guid: '41', key: 'default', displayName: 'Default' }] },
    loadCatalog: async () => { catalogCalls++; return { capabilities: [] } },
  })
  const token = f.coordinator.open({
    actorRole: 'root',
    capabilities: ['users.create', 'users.plan.change', 'users.group.change', 'groups.read'],
  })
  await f.coordinator.whenPrepared(token)
  await f.coordinator.setRole(token, 'admin')
  const refreshing = reconcileAdminUserCreateConflict({
    code: 'action_operation_rejected', token, createStore: f.coordinator,
    refreshIdentity: () => identity.promise,
    currentContext: () => ({ actorRole: 'admin', capabilities: ['users.create'] }),
  })
  assert.equal(f.coordinator.state.authorizing, true)
  assert.deepEqual(f.coordinator.state.groups, [])
  assert.equal(f.coordinator.state.catalog, null)
  assert.equal(f.coordinator.submit(token, {
    username: 'alice', password: 'Str0ng!Pass', role: 'admin', groupGuid: '41', planType: 'professional', permissionOverrides: [], currentPassword: 'Actor!Pass9',
  }), null)
  assert.equal(f.workflow.starts.length, 0, 'old Root permissions must issue no verification or create request')
  identity.resolve()
  assert.equal(await refreshing, true)
  assert.equal(f.coordinator.state.authorizing, false)
  assert.equal(f.coordinator.state.actorRole, 'admin')
  assert.equal(f.coordinator.state.role, 'user')
  assert.deepEqual(f.coordinator.state.capabilities, ['users.create'])
  assert.deepEqual(f.coordinator.state.groups, [DEFAULT_ADMIN_GROUP_CHOICE])
  assert.equal(f.coordinator.state.catalog, null)
  assert.deepEqual([groupCalls, catalogCalls], [1, 1], 'downgraded projection must issue no forbidden directory request')
})

test('authorization refresh closes for lost create capability or actor eligibility without issuing stale requests', async () => {
  for (const currentContext of [
    { actorRole: 'admin', capabilities: [] },
    { actorRole: 'user', capabilities: ['users.create'] },
  ]) {
    let groupCalls = 0
    let catalogCalls = 0
    const identity = deferred()
    const f = coordinatorFixture({
      loadGroups: async () => { groupCalls++; return [{ guid: '41', key: 'default', displayName: 'Default' }] },
      loadCatalog: async () => { catalogCalls++; return { capabilities: [] } },
    })
    const token = f.coordinator.open({ actorRole: 'root', capabilities: ['users.create', 'groups.read'] })
    await f.coordinator.whenPrepared(token)
    await f.coordinator.setRole(token, 'admin')
    assert.deepEqual([groupCalls, catalogCalls], [1, 1])

    const refreshing = reconcileAdminUserCreateConflict({
      code: 'action_verification_rejected', token, createStore: f.coordinator,
      refreshIdentity: () => identity.promise, currentContext: () => currentContext,
    })
    assert.equal(f.coordinator.submit(token, {
      username: 'alice', password: 'Str0ng!Pass', role: 'admin', groupGuid: '41', planType: 'free', permissionOverrides: [], currentPassword: 'Actor!Pass9',
    }), null)
    assert.equal(f.workflow.starts.length, 0, 'the stale projection must issue no verification or create request')
    identity.resolve()
    assert.equal(await refreshing, false)
    assert.equal(f.coordinator.state.open, false)
    assert.equal(f.coordinator.captureOwnership(), null)
    assert.deepEqual([groupCalls, catalogCalls], [1, 1], 'an ineligible identity must issue no directory request')
  }
})

test('permission revision and a racing 403 serialize identity refresh and only the newest generation may load directories', async () => {
  const identityA = deferred()
  const identityB = deferred()
  let identityCalls = 0
  let groupCalls = 0
  const contexts = [
    { actorRole: 'root', capabilities: ['users.create', 'groups.read', 'users.plan.change'] },
    { actorRole: 'admin', capabilities: ['users.create'] },
  ]
  const f = coordinatorFixture({
    loadGroups: async () => { groupCalls++; return [{ guid: '41', key: 'default', displayName: 'Default' }] },
  })
  const token = f.coordinator.open({ actorRole: 'root', capabilities: ['users.create', 'groups.read'] })
  await f.coordinator.whenPrepared(token)
  const first = reconcileAdminUserCreateConflict({
    code: 'permission_revision', token, createStore: f.coordinator,
    refreshIdentity: () => { identityCalls++; return identityA.promise }, currentContext: () => contexts[0],
  })
  const second = reconcileAdminUserCreateConflict({
    code: 'action_verification_rejected', token, createStore: f.coordinator,
    refreshIdentity: () => { identityCalls++; return identityB.promise }, currentContext: () => contexts[1],
  })
  assert.equal(identityCalls, 1, 'the racing 403 must queue behind the active self refresh')
  identityA.resolve()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(identityCalls, 2)
  assert.equal(await first, false, 'the older generation must not publish authorization state')
  assert.equal(groupCalls, 1, 'the older generation must not load a directory')
  identityB.resolve()
  assert.equal(await second, true)
  assert.equal(f.coordinator.state.actorRole, 'admin')
  assert.deepEqual(f.coordinator.state.capabilities, ['users.create'])
  assert.deepEqual(f.coordinator.state.groups, [DEFAULT_ADMIN_GROUP_CHOICE])
  assert.equal(groupCalls, 1, 'the newest projection lacks groups.read and must issue zero new directory requests')
})

test('authorization normalization removes plan, group, role, and override choices revoked by the fresh projection', () => {
  const form = { role: 'admin', planType: 'professional', groupGuid: '42' }
  const effects = { 'users.read': 'allow', 'groups.read': 'deny' }
  normalizeAdminUserCreateFormAuthorization({
    form,
    permissionEffects: effects,
    actorRole: 'admin',
    role: 'user',
    capabilities: ['users.create'],
    groups: [DEFAULT_ADMIN_GROUP_CHOICE],
    catalog: null,
  })
  assert.deepEqual(form, { role: 'user', planType: 'free', groupGuid: null })
  assert.deepEqual(effects, {})

  const groupForm = { role: 'user', planType: 'free', groupGuid: '42' }
  normalizeAdminUserCreateFormAuthorization({
    form: groupForm,
    permissionEffects: effects,
    actorRole: 'admin',
    role: 'user',
    capabilities: ['users.create', 'groups.read'],
    groups: [
      { guid: '41', key: 'default', displayName: 'Default' },
      { guid: '42', key: 'team', displayName: 'Team' },
    ],
    catalog: null,
  })
  assert.equal(groupForm.groupGuid, '41', 'a non-default group is revoked without users.group.change')
})

test('late group and catalog responses cannot cross dialog ownership or role selection', async () => {
  const groupsA = deferred()
  const catalogA = deferred()
  let groupCall = 0
  const f = coordinatorFixture({
    loadGroups: async () => ++groupCall === 1 ? groupsA.promise : [DEFAULT_ADMIN_GROUP_CHOICE],
    loadCatalog: async () => catalogA.promise,
  })
  const tokenA = f.coordinator.open({ actorRole: 'root', capabilities: ['users.create', 'groups.read'] })
  void f.coordinator.setRole(tokenA, 'admin')
  f.coordinator.close(tokenA)
  const tokenB = f.coordinator.open({ actorRole: 'root', capabilities: ['users.create', 'groups.read'] })
  groupsA.resolve([{ guid: '42', key: 'old', displayName: 'Old' }])
  catalogA.resolve({ capabilities: [{ name: 'users.read' }] })
  await Promise.all([f.coordinator.whenPrepared(tokenB), new Promise(resolve => setImmediate(resolve))])
  assert.equal(f.coordinator.owns(tokenB), true)
  assert.deepEqual(f.coordinator.state.groups, [DEFAULT_ADMIN_GROUP_CHOICE])
  assert.equal(f.coordinator.state.catalog, null)
})

test('one logical submit suppresses double clicks and reports direct created identity', async () => {
  const pending = deferred()
  const f = coordinatorFixture({ terminals: [{ promise: pending.promise }] })
  const token = f.coordinator.open({ actorRole: 'admin', capabilities: ['users.create'] })
  await f.coordinator.whenPrepared(token)
  const input = { username: 'alice', nickname: 'Alice', password: 'Str0ng!Pass', role: 'user', groupGuid: null, planType: 'free', permissionOverrides: [], currentPassword: null }
  const first = f.coordinator.submit(token, input)
  const second = f.coordinator.submit(token, input)
  assert.equal(first, second)
  assert.equal(f.workflow.starts.length, 1)
  pending.resolve({ state: 'succeeded', operationRef: 'op_safe', failureCode: null, createdUser })
  await first
  assert.deepEqual(f.succeeded, [{ createdUser, operationRef: 'op_safe' }])
})

test('recovered success without a user closes through the same callback without inventing identity', async () => {
  const f = coordinatorFixture({ terminals: [{ state: 'succeeded', operationRef: 'op_recovered', failureCode: null, createdUser: null }] })
  const token = f.coordinator.open({ actorRole: 'admin', capabilities: ['users.create'] })
  await f.coordinator.whenPrepared(token)
  await f.coordinator.submit(token, { username: 'alice', password: 'Str0ng!Pass', role: 'user', groupGuid: null, planType: 'free', permissionOverrides: [] })
  assert.deepEqual(f.succeeded, [{ createdUser: null, operationRef: 'op_recovered' }])
})

test('conflict clears every browser secret and workflow-owned ticket/key before retry', async () => {
  const f = coordinatorFixture({ terminals: [
    { state: 'failed', operationRef: null, failureCode: 'username_conflict', createdUser: null },
    { state: 'succeeded', operationRef: 'op_safe', failureCode: null, createdUser },
  ] })
  const token = f.coordinator.open({ actorRole: 'root', capabilities: ['users.create'] })
  await f.coordinator.whenPrepared(token)
  await f.coordinator.setRole(token, 'admin')
  await f.coordinator.submit(token, { username: 'alice', password: 'First!Pass9', role: 'admin', groupGuid: null, planType: 'free', permissionOverrides: [], currentPassword: 'Actor!Pass9' })
  assert.equal(f.coordinator.state.failureCode, 'username_conflict')
  assert.doesNotMatch(JSON.stringify(f.coordinator.state), /First!Pass9|Actor!Pass9|ticket|idempotency/i)

  const form = { password: 'First!Pass9', confirmPassword: 'First!Pass9', currentPassword: 'Actor!Pass9' }
  const native = [{ value: 'First!Pass9' }, { value: 'First!Pass9' }, { value: 'Actor!Pass9' }]
  clearAdminUserCreateSecrets({ form, passwordInputs: native.map(input => ({ value: { input } })) })
  assert.deepEqual(form, { password: '', confirmPassword: '', currentPassword: '' })
  assert.deepEqual(native.map(input => input.value), ['', '', ''])
})

test('store retains only safe deleted replay state while browser secrets are cleared', async () => {
  const f = coordinatorFixture({ terminals: [{
    state: 'failed', operationRef: `op_${'A'.repeat(43)}`, failureCode: 'created_user_deleted', createdUser: null,
  }] })
  const token = f.coordinator.open({ actorRole: 'admin', capabilities: ['users.create'] })
  await f.coordinator.whenPrepared(token)
  const form = { password: 'First!Pass9', confirmPassword: 'First!Pass9', currentPassword: 'Actor!Pass9' }
  const native = [{ value: form.password }, { value: form.confirmPassword }, { value: form.currentPassword }]
  const result = await f.coordinator.submit(token, {
    username: 'alice', password: form.password, role: 'user', groupGuid: null, planType: 'free', permissionOverrides: [], currentPassword: null,
  })
  clearAdminUserCreateSecrets({ form, passwordInputs: native.map(input => ({ value: { input } })) })
  assert.deepEqual(result, {
    state: 'failed', operationRef: `op_${'A'.repeat(43)}`, failureCode: 'created_user_deleted', createdUser: null,
  })
  assert.equal(f.coordinator.state.failureCode, 'created_user_deleted')
  assert.equal(f.coordinator.state.operationRef, `op_${'A'.repeat(43)}`)
  assert.deepEqual(form, { password: '', confirmPassword: '', currentPassword: '' })
  assert.deepEqual(native.map(input => input.value), ['', '', ''])
  assert.doesNotMatch(JSON.stringify(f.coordinator.state), /First!Pass9|Actor!Pass9|av_private|ik_private/)
})

test('store fails closed when an injected workflow omits the deleted replay operation ref', async () => {
  const f = coordinatorFixture({ terminals: [{ state: 'failed', operationRef: null, failureCode: 'created_user_deleted', createdUser: null }] })
  const token = f.coordinator.open({ actorRole: 'admin', capabilities: ['users.create'] })
  await f.coordinator.whenPrepared(token)
  await f.coordinator.submit(token, {
    username: 'alice', password: 'First!Pass9', role: 'user', groupGuid: null, planType: 'free', permissionOverrides: [], currentPassword: null,
  })
  assert.equal(f.coordinator.state.failureCode, 'request_failed')
  assert.equal(f.coordinator.state.operationRef, null)
})

test('coordinator scrubs its handoff object as soon as the workflow takes ownership', async () => {
  const pending = deferred()
  let handedOff
  const coordinator = createAdminUserCreateCoordinator({
    api: {}, randomBytes: () => new Uint8Array(32), schedule: () => () => {},
    loadGroups: async () => [DEFAULT_ADMIN_GROUP_CHOICE], loadCatalog: async () => ({ capabilities: [] }),
    createWorkflow: () => ({
      start(input) { handedOff = input; return pending.promise }, reset: () => true, unmount() {},
      subscribe(listener) { listener({ state: 'idle', operationRef: null, failureCode: null, createdUser: null }); return () => {} },
    }),
  })
  const token = coordinator.open({ actorRole: 'admin', capabilities: ['users.create'] })
  await coordinator.whenPrepared(token)
  const running = coordinator.submit(token, { username: 'alice', password: 'Str0ng!Pass', role: 'user', groupGuid: null, planType: 'free', permissionOverrides: [], currentPassword: null })
  assert.equal(handedOff.password, null)
  assert.equal(handedOff.currentPassword, null)
  pending.resolve({ state: 'failed', operationRef: null, failureCode: 'username_conflict', createdUser: null })
  await running
})

test('stale success and unmount cannot reconcile a reopened dialog', async () => {
  const pending = deferred()
  const f = coordinatorFixture({ terminals: [{ promise: pending.promise }, { promise: new Promise(() => {}) }] })
  const tokenA = f.coordinator.open({ actorRole: 'admin', capabilities: ['users.create'] })
  await f.coordinator.whenPrepared(tokenA)
  const runningA = f.coordinator.submit(tokenA, { username: 'alice', password: 'Str0ng!Pass', role: 'user', groupGuid: null, planType: 'free', permissionOverrides: [] })
  f.coordinator.close(tokenA)
  const tokenB = f.coordinator.open({ actorRole: 'admin', capabilities: ['users.create'] })
  pending.resolve({ state: 'succeeded', operationRef: 'op_old', failureCode: null, createdUser })
  await runningA
  assert.equal(f.coordinator.owns(tokenB), true)
  assert.deepEqual(f.succeeded, [])
  f.coordinator.dispose(tokenB)
  assert.equal(f.workflow.workflows[1].unmounted, true)
  assert.equal(f.coordinator.state.open, false)
})

test('success inserts a known user then reloads page one; recovered success only reloads', async () => {
  const rows = [{ ...createdUser, guid: '99', username: 'old' }]
  const state = { rows, total: 3 }
  const filters = { page: 4, pageSize: 20, q: 'alice', sort: 'username', order: 'asc' }
  const reloads = []
  await reconcileCreatedAdminUser({ state, filters, createdUser, reload: () => reloads.push({ ...filters }) })
  assert.deepEqual(state.rows.map(user => user.guid), [createdUser.guid, '99'])
  assert.equal(state.total, 4)
  assert.equal(filters.page, 1)
  assert.deepEqual(reloads, [{ page: 1, pageSize: 20, q: 'alice', sort: 'username', order: 'asc' }])

  const recoveredState = { rows: [...rows], total: 3 }
  await reconcileCreatedAdminUser({ state: recoveredState, filters: { ...filters, page: 3 }, createdUser: null, reload: () => reloads.push('recovered') })
  assert.deepEqual(recoveredState, { rows, total: 3 })
  assert.equal(reloads.at(-1), 'recovered')
})

test('known and recovered successes both close without deriving a missing identity', () => {
  const closes = []
  for (const result of [
    { state: 'succeeded', createdUser },
    { state: 'succeeded', createdUser: null },
  ]) {
    settleAdminUserCreateDialog({ token: 'dialog', result, owns: token => token === 'dialog', close: token => closes.push(token), focusError: () => assert.fail('success must not focus an error') })
  }
  assert.deepEqual(closes, ['dialog', 'dialog'])
})

test('focus restoration is ownership checked at the next tick', () => {
  const calls = []
  const queue = []
  let owner = 'a'
  restoreAdminUserCreateTriggerFocus({ token: 'a', canRestore: token => token === owner,
    trigger: { isConnected: true, focus: () => calls.push('trigger') }, fallback: { focus: () => calls.push('fallback') }, nextTick: callback => queue.push(callback) })
  owner = 'b'
  queue.forEach(callback => callback())
  assert.deepEqual(calls, [])

  owner = 'a'
  restoreAdminUserCreateTriggerFocus({ token: 'a', canRestore: token => token === owner,
    trigger: { isConnected: true, focus: () => calls.push('trigger') }, fallback: { focus: () => calls.push('fallback') }, nextTick: callback => callback() })
  restoreAdminUserCreateTriggerFocus({ token: 'a', canRestore: token => token === owner,
    trigger: { isConnected: false, focus: () => calls.push('detached') }, fallback: { focus: () => calls.push('fallback') }, nextTick: callback => callback() })
  assert.deepEqual(calls, ['trigger', 'fallback'])
})

test('Element Plus invalid fields scroll and focus the first failing confirmation or actor-password control', () => {
  for (const field of ['confirmPassword', 'currentPassword']) {
    const calls = []
    const queue = []
    const controls = {
      username: { value: { focus: () => calls.push('username') } },
      [field]: { value: { focus: () => calls.push(field) } },
    }
    assert.equal(focusAdminUserCreateInvalidField({
      token: 'dialog',
      owns: token => token === 'dialog',
      invalidFields: { [field]: [{ field }], username: [{ field: 'username' }] },
      formRef: { value: { scrollToField: value => calls.push(`scroll:${value}`) } },
      controls,
      nextTick: callback => queue.push(callback),
    }), true)
    queue.forEach(callback => callback())
    assert.deepEqual(calls, [`scroll:${field}`, field])
  }
})
