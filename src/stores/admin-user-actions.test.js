import test from 'node:test'
import assert from 'node:assert/strict'
import { createAdminUserActionsCoordinator, canDeleteAdminUser } from './admin-user-actions.js'

const target = () => ({ guid: '42', username: '张三', role: 'user', status: 'active', authVersion: 7 })

function deferred() {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}

function fixture({ terminal = { state: 'succeeded', operationRef: 'op_safe', failureCode: null } } = {}) {
  const starts = []
  const workflows = []
  const reconciled = []
  const refreshed = []
  let unauthorized = 0
  let snapshot = { state: 'idle', operationRef: null, failure: null, updatedAt: 1 }
  const coordinator = createAdminUserActionsCoordinator({
    api: {}, randomBytes: () => new Uint8Array(32), now: () => 1, schedule: () => () => {},
    createWorkflow: () => {
      const listeners = new Set()
      const workflow = {
        start: async input => { starts.push({ ...input }); snapshot = { state: terminal.state, operationRef: terminal.operationRef, failure: terminal.failureCode ? { code: terminal.failureCode, status: terminal.status ?? 409 } : null, updatedAt: 2 }; listeners.forEach(fn => fn(snapshot)); return terminal },
        reset: () => true,
        unmount: () => { workflow.unmounted = true },
        subscribe: fn => { listeners.add(fn); fn(snapshot); return () => listeners.delete(fn) },
      }
      workflows.push(workflow)
      return workflow
    },
    onSucceeded: value => reconciled.push(value),
    onConflict: value => { refreshed.push(value); return true },
    onUnauthorized: () => { unauthorized++ },
  })
  return { coordinator, starts, workflows, reconciled, refreshed, get unauthorized() { return unauthorized } }
}

test('delete visibility requires users.delete, a lower manageable role, and a live target', () => {
  assert.equal(canDeleteAdminUser({ actorRole: 'admin', capabilities: ['users.delete'], target: target() }), true)
  assert.equal(canDeleteAdminUser({ actorRole: 'root', capabilities: ['users.delete'], target: { ...target(), role: 'admin' } }), true)
  for (const input of [
    { actorRole: 'admin', capabilities: [], target: target() },
    { actorRole: 'admin', capabilities: ['users.delete'], target: { ...target(), role: 'admin' } },
    { actorRole: 'root', capabilities: ['users.delete'], target: { ...target(), role: 'root' } },
    { actorRole: 'admin', capabilities: ['users.delete'], target: { ...target(), status: 'deleted' } },
  ]) assert.equal(canDeleteAdminUser(input), false)
})

test('each open owns a fresh workflow and submit derives the frozen displayed intent', async () => {
  const f = fixture()
  f.coordinator.open(target())
  f.coordinator.setReason('  duplicate account  ')
  f.coordinator.setPassword('actor-password')
  await f.coordinator.submit()
  assert.deepEqual(f.starts, [{ targetGuid: '42', expectedAuthVersion: 7, reason: 'duplicate account', currentPassword: 'actor-password' }])
  assert.deepEqual(f.reconciled, [{ guid: '42', status: 'deleted', operationRef: 'op_safe' }])
  assert.equal(JSON.stringify(f.coordinator.state).includes('actor-password'), false)
  assert.equal(JSON.stringify(f.coordinator.state).includes('duplicate account'), false)
  f.coordinator.open({ ...target(), guid: '43' })
  assert.equal(f.workflows.length, 2)
  assert.equal(f.workflows[0].unmounted, true)
})

test('close and dispose clear private input and cancel the owned workflow', () => {
  const f = fixture()
  f.coordinator.open(target())
  f.coordinator.setReason('private reason')
  f.coordinator.setPassword('private password')
  f.coordinator.close()
  assert.equal(f.workflows[0].unmounted, true)
  assert.deepEqual(f.coordinator.state, { open: false, dialogRevision: 1, target: null, state: 'idle', operationRef: null, failureCode: null })
  assert.doesNotMatch(JSON.stringify(f.coordinator.state), /private reason|private password/)
})

test('ambiguous work never reconciles until the workflow reports succeeded', async () => {
  const waiting = deferred()
  const reconciled = []
  let listener
  const coordinator = createAdminUserActionsCoordinator({
    api: {}, randomBytes: () => new Uint8Array(32), now: () => 1, schedule: () => () => {},
    createWorkflow: () => ({
      start: () => waiting.promise,
      reset: () => true,
      unmount() {},
      subscribe(fn) { listener = fn; fn({ state: 'idle', operationRef: null, failure: null }); return () => {} },
    }),
    onSucceeded: result => reconciled.push(result), onConflict() {}, onUnauthorized() {},
  })
  coordinator.open(target()); coordinator.setReason('reason'); coordinator.setPassword('password')
  const running = coordinator.submit()
  listener({ state: 'querying', operationRef: 'op_safe', failure: null })
  assert.deepEqual(reconciled, [])
  waiting.resolve({ state: 'succeeded', operationRef: 'op_safe', failureCode: null })
  await running
  assert.equal(reconciled.length, 1)
})

test('409 refreshes the displayed target and 401 performs a full reset', async () => {
  const conflict = fixture({ terminal: { state: 'failed', operationRef: null, failureCode: 'target_version_conflict', status: 409 } })
  conflict.coordinator.open(target()); conflict.coordinator.setReason('reason'); conflict.coordinator.setPassword('password'); await conflict.coordinator.submit()
  assert.deepEqual(conflict.refreshed, ['42'])
  assert.equal(conflict.coordinator.state.open, true)

  const unauthorized = fixture({ terminal: { state: 'failed', operationRef: null, failureCode: 'authentication_failed', status: 401 } })
  unauthorized.coordinator.open(target()); unauthorized.coordinator.setReason('reason'); unauthorized.coordinator.setPassword('password'); await unauthorized.coordinator.submit()
  assert.equal(unauthorized.unauthorized, 1)
  assert.equal(unauthorized.coordinator.state.open, false)
})

test('pending recovery is display-safe and blocks a second submit', async () => {
  const f = fixture({ terminal: { state: 'pending_recovery', operationRef: 'op_safe', failureCode: null } })
  f.coordinator.open(target()); f.coordinator.setReason('reason'); f.coordinator.setPassword('password')
  await f.coordinator.submit()
  assert.equal(f.coordinator.state.state, 'pending_recovery')
  assert.equal(await f.coordinator.submit(), null)
})

test('a known failure can retry only after explicit submit and a conflict target can be refreshed safely', async () => {
  const terminals = [
    { state: 'failed', operationRef: null, failureCode: 'target_version_conflict', status: 409 },
    { state: 'succeeded', operationRef: 'op_safe', failureCode: null },
  ]
  let snapshot = { state: 'idle', operationRef: null, failure: null }
  const starts = []
  const listeners = new Set()
  const coordinator = createAdminUserActionsCoordinator({
    api: {}, randomBytes: () => new Uint8Array(32), now: () => 1, schedule: () => () => {},
    createWorkflow: () => ({
      async start(input) { starts.push(input); const terminal = terminals.shift(); snapshot = { state: terminal.state, operationRef: terminal.operationRef, failure: terminal.failureCode ? { code: terminal.failureCode, status: terminal.status } : null }; listeners.forEach(fn => fn(snapshot)); return terminal },
      reset() { snapshot = { state: 'idle', operationRef: null, failure: null }; listeners.forEach(fn => fn(snapshot)); return true },
      unmount() {},
      subscribe(fn) { listeners.add(fn); fn(snapshot); return () => listeners.delete(fn) },
    }),
    async onConflict() { return true }, onSucceeded() {}, onUnauthorized() {},
  })
  const token = coordinator.open(target()); coordinator.setReason('reason'); coordinator.setPassword('first-password')
  await coordinator.submit()
  assert.equal(coordinator.updateTarget(token, { ...target(), authVersion: 8 }), true)
  coordinator.setPassword('second-password')
  await coordinator.submit()
  assert.deepEqual(starts.map(call => call.expectedAuthVersion), [7, 8])
  assert.deepEqual(starts.map(call => call.currentPassword), ['first-password', 'second-password'])
})

test('a conflict callback must affirm a fresh target or the coordinator fails closed', async () => {
  const f = fixture({ terminal: { state: 'failed', operationRef: null, failureCode: 'target_version_conflict', status: 409 } })
  f.coordinator.open(target(), { onConflict: async () => false })
  f.coordinator.setReason('private reason'); f.coordinator.setPassword('private password')
  await f.coordinator.submit()
  assert.deepEqual(f.coordinator.state, { open: false, dialogRevision: 1, target: null, state: 'idle', operationRef: null, failureCode: null })
  assert.equal(f.workflows[0].unmounted, true)
})

test('a late success from dialog A cannot reconcile or close reopened same-GUID dialog B', async () => {
  const a = deferred()
  const reconciled = []
  const workflows = []
  const coordinator = createAdminUserActionsCoordinator({
    api: {}, randomBytes: () => new Uint8Array(32), now: () => 1, schedule: () => () => {},
    createWorkflow: () => {
      const index = workflows.length
      const workflow = { start: () => index === 0 ? a.promise : new Promise(() => {}), reset: () => true, unmount() {}, subscribe(fn) { fn({ state: 'idle', operationRef: null, failure: null }); return () => {} } }
      workflows.push(workflow)
      return workflow
    },
    onSucceeded: value => reconciled.push(value), onConflict: async () => true, onUnauthorized() {},
  })
  const tokenA = coordinator.open(target())
  coordinator.setReason('reason'); coordinator.setPassword('password')
  const runningA = coordinator.submit(tokenA)
  coordinator.close(tokenA)
  const tokenB = coordinator.open(target())
  a.resolve({ state: 'succeeded', operationRef: 'op_old', failureCode: null })
  await runningA
  assert.notEqual(tokenA, tokenB)
  assert.equal(coordinator.owns(tokenB), true)
  assert.equal(coordinator.state.open, true)
  assert.deepEqual(reconciled, [])
})

test('a late conflict callback from A cannot replace or invalidate reopened same-GUID dialog B', async () => {
  const refresh = deferred()
  let coordinator
  coordinator = createAdminUserActionsCoordinator({
    api: {}, randomBytes: () => new Uint8Array(32), now: () => 1, schedule: () => () => {},
    createWorkflow: () => ({
      start: async () => ({ state: 'failed', operationRef: null, failureCode: 'target_version_conflict' }), reset: () => true,
      unmount() {}, subscribe(fn) { fn({ state: 'idle', operationRef: null, failure: null }); return () => {} },
    }),
    async onConflict(guid, token) {
      const fresh = await refresh.promise
      return coordinator.owns(token) && coordinator.updateTarget(token, fresh)
    },
    onSucceeded() {}, onUnauthorized() {},
  })
  const tokenA = coordinator.open(target())
  coordinator.setReason('reason'); coordinator.setPassword('password')
  const runningA = coordinator.submit(tokenA)
  await new Promise(resolve => setImmediate(resolve))
  coordinator.close(tokenA)
  const tokenB = coordinator.open(target())
  refresh.resolve({ ...target(), authVersion: 99 })
  await runningA
  assert.equal(coordinator.owns(tokenB), true)
  assert.equal(coordinator.state.target.authVersion, 7)
  assert.equal(coordinator.state.open, true)
})

test('opening B while A success reconciliation is pending preserves B ownership', async () => {
  const reconcile = deferred()
  let callbackStarted
  const started = new Promise(resolve => { callbackStarted = resolve })
  const coordinator = createAdminUserActionsCoordinator({
    api: {}, randomBytes: () => new Uint8Array(32), now: () => 1, schedule: () => () => {},
    createWorkflow: () => ({ start: async () => ({ state: 'succeeded', operationRef: 'op_old', failureCode: null }), reset: () => true, unmount() {}, subscribe(fn) { fn({ state: 'idle', operationRef: null, failure: null }); return () => {} } }),
    async onSucceeded() { callbackStarted(); await reconcile.promise }, onConflict: async () => true, onUnauthorized() {},
  })
  const tokenA = coordinator.open(target())
  coordinator.setReason('reason'); coordinator.setPassword('password')
  const runningA = coordinator.submit(tokenA)
  await started
  const tokenB = coordinator.open(target())
  reconcile.resolve()
  await runningA
  assert.equal(coordinator.owns(tokenB), true)
  assert.equal(coordinator.state.open, true)
})
