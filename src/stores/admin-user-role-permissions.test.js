import assert from 'node:assert/strict'
import test from 'node:test'
import { createPinia, setActivePinia } from 'pinia'

import { createAdminUserRolePermissionsCoordinator, createAdminUserRolePermissionsStore } from './admin-user-role-permissions.js'

const target = Object.freeze({ guid: '9', username: 'target', role: 'user', status: 'active', authVersion: 7 })
const ticket = 'av_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
const operation = 'op_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
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
  const submitArguments = []
  store.$onAction(({ name, args }) => {
    if (name === 'submit') submitArguments.push(args)
  })
  const token = store.openPermissions({ ...context, target: { ...target, role: 'admin' } })
  const running = store.submit(token, () => ({ reason: 'save', currentPassword: 'Root1!!', overrides: [{ capability: 'users.read', effect: 'deny' }] }))
  await tick()
  assert.doesNotMatch(JSON.stringify(store.$state), /Root1!!|av_|ik_/)
  assert.equal(submitArguments.length, 1)
  assert.equal(submitArguments[0][0], token)
  assert.equal(typeof submitArguments[0][1], 'function')
  workflows[0].settle({ phase: 'pending_recovery', failureCode: null, operationRef: 'op_safe' })
  assert.equal((await running).phase, 'pending_recovery')
  assert.equal(store.phase, 'pending_recovery')
  assert.equal(store.close(token), true)
  assert.equal(store.phase, 'idle')
  store.dispose()
})

test('Pinia submit consumes unsafe readers once and reports only safe terminal results', async () => {
  setActivePinia(createPinia())
  const useStore = createAdminUserRolePermissionsStore('a08-reader-failure-test', {
    createWorkflow: () => scriptedWorkflow(),
  })
  const store = useStore()
  const afterValues = []
  const errorValues = []
  const argumentShapes = []
  store.$onAction(({ name, args, after, onError }) => {
    if (name !== 'submit') return
    argumentShapes.push(args.map(value => typeof value))
    after(value => { afterValues.push(value) })
    onError(error => { errorValues.push(error) })
  })

  let reads = 0
  const rawMarker = 'raw-error-RootSecret1!!'
  const token = store.openDemote({ ...context, target: { ...target, role: 'admin' } })
  const throwingReader = () => { reads++; throw new Error(rawMarker) }
  assert.equal((await store.submit(token, throwingReader)).phase, 'failed')
  assert.equal(store.submit(token, throwingReader), null)
  assert.equal(reads, 1)
  assert.deepEqual(argumentShapes, [['object', 'function'], ['object', 'function']])
  assert.equal(errorValues.length, 0)
  assert.doesNotMatch(JSON.stringify({ afterValues, state: store.$state }), /raw-error|RootSecret1!!/)

  const invalidToken = store.openPromote(context)
  let invalidReads = 0
  const invalidReader = () => { invalidReads++; return null }
  assert.equal((await store.submit(invalidToken, invalidReader)).phase, 'failed')
  assert.equal(store.submit(invalidToken, invalidReader), null)
  assert.equal(invalidReads, 1)

  const getterToken = store.openPermissions({ ...context, target: { ...target, role: 'admin' } })
  let getterReads = 0
  const getterReader = () => {
    getterReads++
    return { reason: 'save', get currentPassword() { throw new Error(rawMarker) }, overrides: [] }
  }
  assert.equal((await store.submit(getterToken, getterReader)).phase, 'failed')
  assert.equal(store.submit(getterToken, getterReader), null)
  assert.equal(getterReads, 1)
  assert.equal(errorValues.length, 0)
  assert.doesNotMatch(JSON.stringify({ afterValues, state: store.$state }), /raw-error|RootSecret1!!/)
})

test('Pinia action results and instrumentation never expose injected backend failure codes', async () => {
  const rawMarker = 'raw-secret-BackendPassword1!!'
  const apis = [
    {
      issueDemote: async () => { throw { code: rawMarker, status: 503 } },
      executeDemote: async () => assert.fail('unexpected execute'),
      query: async () => assert.fail('unexpected query'),
    },
    {
      issueDemote: async () => ({ ticket }),
      executeDemote: async () => { throw { code: rawMarker, status: 503 } },
      query: async () => assert.fail('unexpected query'),
    },
    {
      issueDemote: async () => ({ ticket }),
      executeDemote: async () => { throw { code: 'operation_commit_unknown', status: 503, operationRef: operation } },
      query: async () => ({ status: 'failed', operationRef: operation, failureCode: rawMarker }),
    },
  ]

  for (const [index, api] of apis.entries()) {
    setActivePinia(createPinia())
    const useStore = createAdminUserRolePermissionsStore(`a08-untrusted-code-${index}`, {
      api,
      randomBytes: () => new Uint8Array(32),
      schedule: () => () => {},
    })
    const store = useStore()
    const afterValues = []
    const errorValues = []
    store.$onAction(({ name, after, onError }) => {
      if (name !== 'submit') return
      after(value => { afterValues.push(value) })
      onError(error => { errorValues.push(error) })
    })
    const token = store.openDemote({ ...context, target: { ...target, role: 'admin' } })
    const result = await store.submit(token, () => ({ reason: 'demote', currentPassword: 'FrontendPassword1!!' }))
    assert.equal(result.failureCode, 'request_failed')
    assert.equal(store.failureCode, 'request_failed')
    assert.equal(errorValues.length, 0)
    assert.doesNotMatch(JSON.stringify({ result, afterValues, state: store.$state }), /raw-secret|BackendPassword1!!|FrontendPassword1!!/)
  }
})
