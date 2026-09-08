import assert from 'node:assert/strict'
import test from 'node:test'
import { canOpenAdminUserEdit, createAdminUserEditCoordinator } from './admin-user-edit.js'

const target = Object.freeze({ guid: '123456789012345678', username: 'alice', nickname: 'Alice', role: 'user', status: 'active', authVersion: 7 })
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }

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

test('coordinator owns an immutable dialog snapshot and drops late route, identity, permission, dialog, or target settlements', async () => {
  const pending = deferred()
  const successes = []
  const coordinator = createAdminUserEditCoordinator({ api: { patchAdminUserEdit: async () => pending.promise }, onSucceeded: value => successes.push(value) })
  const token = coordinator.open({ actorRole: 'admin', actorGuid: '2', capabilities: ['users.edit'], target, routeGuid: target.guid, identityEpoch: 1, permissionVersion: '1' })
  const running = coordinator.submit(token, { nickname: ' Alice ' })
  assert.equal(coordinator.submit(token, { nickname: 'Other' }), running)
  coordinator.updateContext(token, { routeGuid: '999', identityEpoch: 2, permissionVersion: '2' })
  pending.resolve({ ...target, nickname: 'Alice' })
  await running
  assert.deepEqual(successes, [])
  assert.equal(coordinator.state.open, true)
})

test('reopening for another target disposes the earlier dialog and drops its late settlement', async () => {
  const pending = deferred()
  const successes = []
  const coordinator = createAdminUserEditCoordinator({ api: { patchAdminUserEdit: async () => pending.promise }, onSucceeded: value => successes.push(value) })
  const first = coordinator.open({ actorRole: 'admin', actorGuid: '2', capabilities: ['users.edit'], target, routeGuid: target.guid, identityEpoch: 1, permissionVersion: '1' })
  const running = coordinator.submit(first, { nickname: 'Alice' })
  const nextTarget = { ...target, guid: '123456789012345679', nickname: 'Bea' }
  const second = coordinator.open({ actorRole: 'admin', actorGuid: '2', capabilities: ['users.edit'], target: nextTarget, routeGuid: nextTarget.guid, identityEpoch: 1, permissionVersion: '1' })
  pending.resolve({ ...target, nickname: 'Alice' })
  assert.deepEqual(await running, { state: 'disposed', user: null, failureCode: 'workflow_disposed' })
  assert.deepEqual(successes, [])
  assert.equal(coordinator.owns(first), false)
  assert.equal(coordinator.owns(second), true)
  assert.equal(coordinator.state.target.guid, nextTarget.guid)
})

test('409 requires explicit target refresh and never replays PATCH', async () => {
  let calls = 0
  const refreshes = []
  const coordinator = createAdminUserEditCoordinator({ api: { patchAdminUserEdit: async () => { calls++; throw { code: 'auth_version_conflict', status: 409 } } } })
  const token = coordinator.open({ actorRole: 'admin', actorGuid: '2', capabilities: ['users.edit'], target, routeGuid: target.guid, identityEpoch: 1, permissionVersion: '1' })
  const result = await coordinator.submit(token, { nickname: null })
  assert.equal(result.state, 'conflict')
  assert.equal(calls, 1)
  assert.equal(coordinator.state.requiresTargetRefresh, true)
  assert.equal(await coordinator.refreshConflict(token, async guid => { refreshes.push(guid); return { ...target, authVersion: 8 } }), true)
  assert.deepEqual(refreshes, [target.guid])
  assert.equal(calls, 1)
})
