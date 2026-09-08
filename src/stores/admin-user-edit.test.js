import assert from 'node:assert/strict'
import test from 'node:test'
import { createPinia, setActivePinia } from 'pinia'
import { canOpenAdminUserEdit, createAdminUserEditCoordinator, useAdminUserEditStore } from './admin-user-edit.js'

const target = Object.freeze({ guid: '123456789012345678', username: 'alice', nickname: 'Alice', role: 'user', status: 'active', authVersion: 7 })
const mappedUser = Object.freeze({ ...target, email: null, group: 'default', planType: 'free', createdAt: '2026-09-08T00:00:00.000Z', lastLoginAt: null })
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
const ownership = Object.freeze({ actorRole: 'admin', actorGuid: '2', capabilities: ['users.edit'], target, routeGuid: target.guid, identityEpoch: 'epoch-1', permissionVersion: 1 })

test('edit eligibility fails closed for capability, hierarchy, self, Root, deletion, or invalid version', () => {
  assert.equal(canOpenAdminUserEdit({ actorRole: 'admin', actorGuid: '2', capabilities: ['users.edit'], target }), true)
  for (const context of [
    { actorRole: 'admin', actorGuid: '2', capabilities: [], target },
    { actorRole: 'admin', actorGuid: target.guid, capabilities: ['users.edit'], target },
    { actorRole: 'admin', actorGuid: '2', capabilities: ['users.edit'], target: { ...target, role: 'admin' } },
    { actorRole: 'root', actorGuid: '2', capabilities: ['users.edit'], target: { ...target, role: 'root' } },
    { actorRole: 'root', actorGuid: '2', capabilities: ['users.edit'], target: { ...target, status: 'deleted' } },
    { actorRole: 'root', actorGuid: '2', capabilities: ['users.edit'], target: { ...target, authVersion: 0 } },
  ]) assert.equal(canOpenAdminUserEdit(context), false)
})

test('open rejects an initial route that is not the owned canonical target GUID', () => {
  const coordinator = createAdminUserEditCoordinator({ api: { patchAdminUserEdit: async () => target } })
  for (const routeGuid of ['123456789012345679', '01']) {
    const token = coordinator.open({ ...ownership, routeGuid })
    assert.equal(token, null)
  }
  assert.equal(coordinator.state.open, false)
})

test('open rejects non-primitive or noncanonical ownership primitives', () => {
  const coordinator = createAdminUserEditCoordinator({ api: { patchAdminUserEdit: async () => mappedUser } })
  for (const next of [
    { actorGuid: '02' }, { actorGuid: { guid: '2' } }, { identityEpoch: '' }, { identityEpoch: [] },
    { identityEpoch: 'bad space' }, { permissionVersion: -1 }, { permissionVersion: 1.5 }, { permissionVersion: [] },
  ]) assert.equal(coordinator.open({ ...ownership, ...next }), null)
})

test('open copies mutable target and capability inputs into the owned request', async () => {
  const calls = []
  const capabilities = ['users.edit']
  const mutableTarget = { ...target }
  const coordinator = createAdminUserEditCoordinator({ api: { patchAdminUserEdit: async value => { calls.push(value); return mappedUser } } })
  const token = coordinator.open({ ...ownership, capabilities, target: mutableTarget })
  mutableTarget.authVersion = 8
  capabilities[0] = 'users.delete'
  await coordinator.submit(token, { nickname: 'Alice' })
  assert.deepEqual(calls, [{ targetGuid: target.guid, nickname: 'Alice', expectedAuthVersion: 7 }])
})

test('coordinator owns an immutable dialog snapshot and drops late route, identity, permission, dialog, or target settlements', async () => {
  const pending = deferred()
  const successes = []
  const coordinator = createAdminUserEditCoordinator({ api: { patchAdminUserEdit: async () => pending.promise }, onSucceeded: value => successes.push(value) })
  const token = coordinator.open(ownership)
  const running = coordinator.submit(token, { nickname: ' Alice ' })
  assert.equal(coordinator.submit(token, { nickname: 'Other' }), running)
  coordinator.updateContext(token, { routeGuid: '999', identityEpoch: 'epoch-2', permissionVersion: 2 })
  pending.resolve({ ...target, nickname: 'Alice' })
  assert.deepEqual(await running, { state: 'disposed', user: null, failureCode: 'workflow_disposed' })
  assert.deepEqual(successes, [])
  assert.equal(coordinator.state.open, false)
})

test('reopening for another target disposes the earlier dialog and drops its late settlement', async () => {
  const pending = deferred()
  const successes = []
  const coordinator = createAdminUserEditCoordinator({ api: { patchAdminUserEdit: async () => pending.promise }, onSucceeded: value => successes.push(value) })
  const first = coordinator.open(ownership)
  const running = coordinator.submit(first, { nickname: 'Alice' })
  const nextTarget = { ...target, guid: '123456789012345679', nickname: 'Bea' }
  const second = coordinator.open({ ...ownership, target: nextTarget, routeGuid: nextTarget.guid })
  pending.resolve({ ...target, nickname: 'Alice' })
  assert.deepEqual(await running, { state: 'disposed', user: null, failureCode: 'workflow_disposed' })
  assert.deepEqual(successes, [])
  assert.equal(coordinator.owns(first), false)
  assert.equal(coordinator.owns(second), true)
  assert.equal(coordinator.state.target.guid, nextTarget.guid)
})

test('same-GUID target version replacement invalidates a pending settlement', async () => {
  const pending = deferred()
  const successes = []
  const coordinator = createAdminUserEditCoordinator({ api: { patchAdminUserEdit: async () => pending.promise }, onSucceeded: value => successes.push(value) })
  const token = coordinator.open(ownership)
  const running = coordinator.submit(token, { nickname: 'Alice' })
  assert.equal(coordinator.updateContext(token, { target: { ...target, authVersion: 8 } }), true)
  pending.resolve({ ...target, nickname: 'Alice' })
  assert.deepEqual(await running, { state: 'disposed', user: null, failureCode: 'workflow_disposed' })
  assert.deepEqual(successes, [])
  assert.equal(coordinator.state.open, false)
  assert.equal(coordinator.submit(token, { nickname: 'retry' }), null)
})

test('a success DTO for another GUID fails closed before onSucceeded', async () => {
  const successes = []
  const coordinator = createAdminUserEditCoordinator({ api: { patchAdminUserEdit: async () => ({ ...mappedUser, guid: '123456789012345679' }) }, onSucceeded: value => successes.push(value) })
  const token = coordinator.open(ownership)
  const result = await coordinator.submit(token, { nickname: 'Alice' })
  assert.equal(result.state, 'failed')
  assert.equal(result.failureCode, 'request_failed')
  assert.deepEqual(successes, [])
})

test('a success DTO with an unexpected auth version fails closed before onSucceeded', async () => {
  const successes = []
  const coordinator = createAdminUserEditCoordinator({ api: { patchAdminUserEdit: async () => ({ ...mappedUser, authVersion: 8 }) }, onSucceeded: value => successes.push(value) })
  const token = coordinator.open(ownership)
  const result = await coordinator.submit(token, { nickname: 'Alice' })
  assert.deepEqual(result, { state: 'failed', user: null, failureCode: 'request_failed' })
  assert.equal(coordinator.state.state, 'failed')
  assert.deepEqual(successes, [])
})

test('a throwing onSucceeded callback becomes a stable failed settlement', async () => {
  let observedState = null
  let coordinator
  coordinator = createAdminUserEditCoordinator({ api: { patchAdminUserEdit: async () => mappedUser }, onSucceeded: () => {
    observedState = coordinator.state.state
    throw new Error('private callback failure')
  } })
  const token = coordinator.open(ownership)
  const result = await coordinator.submit(token, { nickname: 'Alice' })
  assert.deepEqual(result, { state: 'failed', user: null, failureCode: 'request_failed' })
  assert.equal(coordinator.state.state, 'failed')
  assert.equal(observedState, 'submitting')
  assert.doesNotMatch(JSON.stringify(result), /private/)
})

test('409 requires explicit target refresh and never replays PATCH', async () => {
  let calls = 0
  const refreshes = []
  const coordinator = createAdminUserEditCoordinator({ api: { patchAdminUserEdit: async () => { calls++; throw { code: 'auth_version_conflict', status: 409 } } } })
  const token = coordinator.open(ownership)
  const result = await coordinator.submit(token, { nickname: null })
  assert.equal(result.state, 'conflict')
  assert.equal(calls, 1)
  assert.equal(coordinator.state.requiresTargetRefresh, true)
  assert.equal(await coordinator.refreshConflict(token, async guid => { refreshes.push(guid); return { ...target, authVersion: 8 } }), true)
  assert.deepEqual(refreshes, [target.guid])
  assert.equal(calls, 1)
})

test('real Pinia store safely disposes ownership after a context change', () => {
  setActivePinia(createPinia())
  const store = useAdminUserEditStore()
  const token = store.open(ownership)
  assert.ok(token)
  assert.equal(store.isOpen, true)
  assert.equal(store.updateContext(token, { identityEpoch: 'epoch-2' }), true)
  assert.equal(store.isOpen, false)
  assert.equal(store.owns(token), false)
  assert.equal(store.submit(token, { nickname: 'Alice' }), null)
})
