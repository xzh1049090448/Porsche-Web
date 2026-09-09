import assert from 'node:assert/strict'
import test from 'node:test'
import { createPinia, setActivePinia } from 'pinia'

import { createAdminUserRolePermissionsCoordinator, createAdminUserRolePermissionsStore } from './admin-user-role-permissions.js'

const target = Object.freeze({ guid: '9', username: 'target', role: 'user', status: 'active', authVersion: 7 })
const context = Object.freeze({
  target,
  routeGuid: '9',
  identityEpoch: 'identity-1',
  capabilityRevision: 4,
  permissionsVersion: 3,
  catalogVersion: 1,
})
const tick = () => new Promise(resolve => setImmediate(resolve))

function scriptedWorkflow() {
  let listener = () => {}
  let resolve
  const promise = new Promise(done => { resolve = done })
  return {
    startCalls: [],
    start(scope, input) { this.startCalls.push({ scope, input }); listener({ phase: 'verifying', failureCode: null, operationRef: null }); return promise },
    subscribe(next) { listener = next; next({ phase: 'idle', failureCode: null, operationRef: null }); return () => { listener = () => {} } },
    settle(result) { listener(result); resolve(result) },
    dispose() { resolve({ phase: 'failed', failureCode: 'workflow_disposed', operationRef: null }) },
  }
}

test('three action opens are mutually exclusive and stale owners or contexts cannot settle', async () => {
  const workflows = []
  const state = {}
  const coordinator = createAdminUserRolePermissionsCoordinator({
    state,
    createWorkflow: () => { const workflow = scriptedWorkflow(); workflows.push(workflow); return workflow },
  })
  const promote = coordinator.openPromote(context)
  assert.equal(state.action, 'users.promote')
  const demote = coordinator.openDemote({ ...context, target: { ...target, role: 'admin' } })
  assert.equal(coordinator.owns(promote), false)
  assert.equal(coordinator.submit(promote, () => ({ reason: 'old', currentPassword: 'Old1!!' })), null)
  assert.equal(state.action, 'users.demote')

  const running = coordinator.submit(demote, () => ({ reason: 'demote', currentPassword: 'Root1!!' }))
  assert.equal(coordinator.submit(demote, () => ({ reason: 'again', currentPassword: 'Other1!!' })), running)
  assert.equal(workflows[1].startCalls.length, 1)
  assert.doesNotMatch(JSON.stringify(state), /Root1!!|Other1!!|av_|ik_/)
  assert.equal(coordinator.updateContext(demote, { identityEpoch: 'identity-2' }), false)
  workflows[1].settle({ phase: 'succeeded', operationRef: 'op_late' })
  await running
  assert.equal(state.open, false)
  assert.equal(state.phase, 'idle')
  assert.equal(state.operationRef, null)
})

test('Pinia state and action instrumentation never receive password ticket or key values', async () => {
  setActivePinia(createPinia())
  const workflows = []
  const useStore = createAdminUserRolePermissionsStore('a08-secret-test', {
    createWorkflow: () => { const workflow = scriptedWorkflow(); workflows.push(workflow); return workflow },
  })
  const store = useStore()
  const actionArgs = []
  store.$onAction(({ args }) => { actionArgs.push(JSON.stringify(args)) })
  const token = store.openPermissions({ ...context, target: { ...target, role: 'admin' } })
  const running = store.submit(token, () => ({ reason: 'save', currentPassword: 'Root1!!', overrides: [{ capability: 'users.read', effect: 'deny' }] }))
  await tick()
  assert.doesNotMatch(JSON.stringify(store.$state), /Root1!!|av_|ik_/)
  assert.doesNotMatch(actionArgs.join(''), /Root1!!|av_|ik_/)
  workflows[0].settle({ phase: 'pending_recovery', failureCode: null, operationRef: 'op_safe' })
  assert.equal((await running).phase, 'pending_recovery')
  assert.equal(store.phase, 'pending_recovery')
  assert.equal(store.close(token), true)
  assert.equal(store.phase, 'idle')
  store.dispose()
})
