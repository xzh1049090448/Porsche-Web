import assert from 'node:assert/strict'
import test from 'node:test'
import { createPinia, setActivePinia } from 'pinia'
import { canOpenAdminUserStatus, createAdminUserStatusCoordinator, useAdminUserStatusStore } from './admin-user-status.js'

const target = Object.freeze({ guid: '123456789012345678', username: 'alice', nickname: 'Alice', role: 'user', status: 'active', authVersion: 7 })
const mappedUser = Object.freeze({ ...target, status: 'disabled', authVersion: 8, email: null, group: 'default', planType: 'free', createdAt: '2026-09-08T00:00:00.000Z', lastLoginAt: null })
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
const ownership = Object.freeze({ actorRole: 'admin', actorGuid: '2', capabilities: ['users.disable'], target, routeGuid: target.guid, identityEpoch: 'epoch-1', permissionVersion: 1, status: 'disabled' })

test('status eligibility binds exact transition capability and fails closed for hierarchy, self, deleted, or version overflow', () => {
  assert.equal(canOpenAdminUserStatus(ownership), true)
  assert.equal(canOpenAdminUserStatus({ ...ownership, target: { ...target, status: 'disabled' }, status: 'active', capabilities: ['users.enable'] }), true)
  for (const context of [
    { ...ownership, capabilities: [] },
    { ...ownership, capabilities: ['users.enable'] },
    { ...ownership, status: 'active' },
    { ...ownership, actorGuid: target.guid },
    { ...ownership, actorGuid: '02' },
    { ...ownership, actorGuid: 2 },
    { ...ownership, target: Object.assign([], target) },
    { ...ownership, target: { ...target, role: 'admin' } },
    { ...ownership, actorRole: 'root', target: { ...target, role: 'root' } },
    { ...ownership, actorRole: 'root', target: { ...target, status: 'deleted' } },
    { ...ownership, target: { ...target, authVersion: 2147483647 } },
  ]) assert.equal(canOpenAdminUserStatus(context), false)
})

test('open requires canonical route and primitive ownership context', () => {
  const coordinator = createAdminUserStatusCoordinator({ api: { patchAdminUserStatus: async () => mappedUser } })
  for (const next of [
    { routeGuid: '01' }, { routeGuid: '123456789012345679' }, { identityEpoch: '' }, { identityEpoch: [] },
    { permissionVersion: -1 }, { permissionVersion: 1.5 }, { actorGuid: { guid: '2' } },
  ]) assert.equal(coordinator.open({ ...ownership, ...next }), null)
  assert.equal(coordinator.state.open, false)
})

test('open copies mutable target and capabilities and submit binds status/version while sharing duplicates', async () => {
  const calls = []
  const pending = deferred()
  const capabilities = ['users.disable']
  const mutableTarget = { ...target }
  const coordinator = createAdminUserStatusCoordinator({ api: { patchAdminUserStatus: async value => { calls.push(value); return pending.promise } } })
  const token = coordinator.open({ ...ownership, capabilities, target: mutableTarget })
  mutableTarget.status = 'disabled'; mutableTarget.authVersion = 99; capabilities[0] = 'users.enable'
  const first = coordinator.submit(token, { reason: '  private reason  ' })
  const second = coordinator.submit(token, { reason: 'different' })
  assert.equal(first, second)
  assert.equal(coordinator.reset(token), false)
  assert.doesNotMatch(JSON.stringify(coordinator.state), /reason|private/)
  pending.resolve(mappedUser)
  assert.equal((await first).state, 'succeeded')
  assert.deepEqual(calls, [{ targetGuid: target.guid, status: 'disabled', reason: 'private reason', expectedAuthVersion: 7 }])
})

test('full ownership changes and reopen dispose pending work and drop every late success callback', async () => {
  for (const next of [
    { routeGuid: '123456789012345679' }, { identityEpoch: 'epoch-2' }, { permissionVersion: 2 },
    { target: { ...target, authVersion: 8 } }, { target: { ...target, status: 'disabled' } },
  ]) {
    const pending = deferred(); const successes = []
    const coordinator = createAdminUserStatusCoordinator({ api: { patchAdminUserStatus: async () => pending.promise }, onSucceeded: value => successes.push(value) })
    const token = coordinator.open(ownership)
    const running = coordinator.submit(token, { reason: 'reason' })
    assert.equal(coordinator.updateContext(token, next), false)
    pending.resolve(mappedUser)
    assert.deepEqual(await running, { state: 'disposed', user: null, failureCode: 'workflow_disposed' })
    assert.deepEqual(successes, [])
    assert.equal(coordinator.state.open, false)
  }

  const pending = deferred(); const successes = []
  const coordinator = createAdminUserStatusCoordinator({ api: { patchAdminUserStatus: async () => pending.promise }, onSucceeded: value => successes.push(value) })
  const first = coordinator.open(ownership)
  const running = coordinator.submit(first, { reason: 'reason' })
  const nextTarget = { ...target, guid: '123456789012345679' }
  const second = coordinator.open({ ...ownership, target: nextTarget, routeGuid: nextTarget.guid })
  pending.resolve(mappedUser)
  assert.deepEqual(await running, { state: 'disposed', user: null, failureCode: 'workflow_disposed' })
  assert.equal(coordinator.owns(first), false)
  assert.equal(coordinator.owns(second), true)
  assert.deepEqual(successes, [])
})

test('success reconciles only matching guid, desired status, and old auth version plus one', async () => {
  for (const changed of [
    { guid: '123456789012345679' }, { status: 'active' }, { authVersion: 7 }, { authVersion: 9 },
  ]) {
    const successes = []
    const coordinator = createAdminUserStatusCoordinator({ api: { patchAdminUserStatus: async () => ({ ...mappedUser, ...changed }) }, onSucceeded: value => successes.push(value) })
    const token = coordinator.open(ownership)
    const result = await coordinator.submit(token, { reason: 'reason' })
    assert.deepEqual(result, { state: 'failed', user: null, failureCode: 'request_failed' })
    assert.deepEqual(successes, [])
  }
  const successes = []
  const coordinator = createAdminUserStatusCoordinator({ api: { patchAdminUserStatus: async () => mappedUser }, onSucceeded: value => successes.push(value) })
  const token = coordinator.open(ownership)
  assert.equal((await coordinator.submit(token, { reason: 'reason' })).state, 'succeeded')
  assert.deepEqual(successes, [mappedUser])
})

test('only current owner resets a settled failure and close/dispose clear all owned state', async () => {
  const coordinator = createAdminUserStatusCoordinator({ api: { patchAdminUserStatus: async () => { throw { code: 'unavailable' } } } })
  const token = coordinator.open(ownership)
  assert.equal((await coordinator.submit(token, { reason: 'private reason' })).failureCode, 'unavailable')
  assert.equal(coordinator.reset({ statusDialog: 999 }), false)
  assert.equal(coordinator.reset(token), true)
  assert.equal(coordinator.state.state, 'idle')
  assert.equal(coordinator.state.open, true)
  assert.doesNotMatch(JSON.stringify(coordinator.state), /reason|private/)
  assert.equal(coordinator.dispose(token), true)
  assert.deepEqual(coordinator.state, { open: false, dialogRevision: 1, target: null, intendedStatus: null, state: 'idle', user: null, failureCode: null, requiresTargetRefresh: false })
})

test('409 refresh is one bounded shared GET, never replays PATCH, and rebinds only a still-valid transition', async () => {
  for (const conflictCode of ['auth_version_conflict', 'user_status_conflict']) {
    let patches = 0; let gets = 0
    const pending = deferred()
    const coordinator = createAdminUserStatusCoordinator({ api: { patchAdminUserStatus: async () => { patches++; throw { code: conflictCode, status: 409 } } } })
    const token = coordinator.open(ownership)
    assert.equal((await coordinator.submit(token, { reason: 'reason' })).state, 'conflict')
    const first = coordinator.refreshConflict(token, async () => { gets++; return pending.promise })
    const second = coordinator.refreshConflict(token, async () => { gets++; return { ...target, authVersion: 10 } })
    assert.equal(first, second)
    pending.resolve({ ...target, authVersion: 8 })
    assert.equal(await first, true)
    assert.equal(await coordinator.refreshConflict(token, async () => { gets++; return { ...target, authVersion: 9 } }), false)
    assert.equal(gets, 1)
    assert.equal(patches, 1)
    assert.equal(coordinator.state.target.authVersion, 8)
    assert.equal(coordinator.state.state, 'idle')
  }
})

test('conflict refresh drops a late result after ownership changes and closes if transition is no longer eligible', async () => {
  const pending = deferred(); let patches = 0
  const coordinator = createAdminUserStatusCoordinator({ api: { patchAdminUserStatus: async () => { patches++; throw { code: 'auth_version_conflict' } } } })
  const token = coordinator.open(ownership)
  await coordinator.submit(token, { reason: 'reason' })
  const refresh = coordinator.refreshConflict(token, async () => pending.promise)
  coordinator.updateContext(token, { identityEpoch: 'epoch-2' })
  pending.resolve({ ...target, authVersion: 8 })
  assert.equal(await refresh, false)
  assert.equal(coordinator.state.open, false)
  assert.equal(patches, 1)

  const second = createAdminUserStatusCoordinator({ api: { patchAdminUserStatus: async () => { throw { code: 'user_status_conflict' } } } })
  const owner = second.open(ownership)
  await second.submit(owner, { reason: 'reason' })
  assert.equal(await second.refreshConflict(owner, async () => ({ ...target, status: 'disabled', authVersion: 8 })), false)
  assert.equal(second.state.open, false)
})

test('real Pinia store exposes the coordinator and invalidates ownership on context drift', () => {
  setActivePinia(createPinia())
  const store = useAdminUserStatusStore()
  const token = store.open(ownership)
  assert.ok(token)
  assert.equal(store.isOpen, true)
  assert.equal(store.intendedStatus, 'disabled')
  assert.equal(store.updateContext(token, { permissionVersion: 2 }), false)
  assert.equal(store.isOpen, false)
  assert.equal(store.owns(token), false)
  assert.equal(store.submit(token, { reason: 'reason' }), null)
})
