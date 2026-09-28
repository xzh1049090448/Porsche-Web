import assert from 'node:assert/strict'
import test from 'node:test'
import { ADMIN_USER_STATUS_STATES, createAdminUserStatusWorkflow } from './admin-user-status-state.js'

const user = Object.freeze({ guid: '123456789012345678', username: 'alice', nickname: null, email: null, group: 'default', planType: 'free', role: 'user', status: 'disabled', authVersion: 8, createdAt: '2026-09-08T00:00:00.000Z', lastLoginAt: null })
const deferred = () => { let resolve; let reject; const promise = new Promise((done, fail) => { resolve = done; reject = fail }); return { promise, resolve, reject } }

test('exports a closed A06 state vocabulary', () => {
  assert.deepEqual(ADMIN_USER_STATUS_STATES, { IDLE: 'idle', SUBMITTING: 'submitting', SUCCEEDED: 'succeeded', CONFLICT: 'conflict', FAILED: 'failed', DISPOSED: 'disposed' })
})

test('shares duplicate submit, freezes normalized input, and keeps reason out of every public snapshot', async () => {
  const pending = deferred()
  const calls = []
  const workflow = createAdminUserStatusWorkflow({ api: { patchAdminUserStatus: async value => { calls.push(value); return pending.promise } } })
  const input = { targetGuid: user.guid, status: 'disabled', reason: '  private reason  ', expectedAuthVersion: 7 }
  const first = workflow.start(input)
  const second = workflow.start({ ...input, reason: 'other' })
  input.reason = 'mutated'
  assert.equal(first, second)
  assert.deepEqual(workflow.getSnapshot(), { state: 'submitting', user: null, failureCode: null })
  assert.doesNotMatch(JSON.stringify(workflow.getSnapshot()), /reason|private|mutated/)
  pending.resolve(user)
  assert.deepEqual(await first, { state: 'succeeded', user, failureCode: null })
  assert.deepEqual(calls, [{ targetGuid: user.guid, status: 'disabled', reason: 'private reason', expectedAuthVersion: 7 }])
})

test('isolates synchronous subscriber re-entry and reset or dispose discards late settlement', async () => {
  const pending = deferred()
  const workflow = createAdminUserStatusWorkflow({ api: { patchAdminUserStatus: async () => pending.promise } })
  const running = workflow.start({ targetGuid: user.guid, status: 'disabled', reason: 'reason', expectedAuthVersion: 7 })
  workflow.subscribe(snapshot => { if (snapshot.state === 'submitting') workflow.reset() })
  pending.resolve(user)
  assert.deepEqual(await running, { state: 'idle', user: null, failureCode: null })

  const late = deferred()
  const second = createAdminUserStatusWorkflow({ api: { patchAdminUserStatus: async () => late.promise } })
  const secondRun = second.start({ targetGuid: user.guid, status: 'active', reason: null, expectedAuthVersion: 8 })
  second.dispose()
  late.resolve({ ...user, status: 'active', authVersion: 9 })
  assert.deepEqual(await secondRun, { state: 'disposed', user: null, failureCode: 'workflow_disposed' })
})

test('does not replay either conflict and preserves only the closed safe failure vocabulary', async () => {
  for (const code of ['auth_version_conflict', 'user_status_conflict']) {
    let calls = 0
    const workflow = createAdminUserStatusWorkflow({ api: { patchAdminUserStatus: async () => { calls++; throw { code, status: 409 } } } })
    assert.deepEqual(await workflow.start({ targetGuid: user.guid, status: 'active', reason: null, expectedAuthVersion: 8 }), { state: 'conflict', user: null, failureCode: code })
    assert.equal(calls, 1)
  }
  for (const code of ['authentication_failed', 'forbidden', 'not_found', 'unavailable', 'request_failed']) {
    const workflow = createAdminUserStatusWorkflow({ api: { patchAdminUserStatus: async () => { throw { code, status: 503, message: 'private', response: { secret: true } } } } })
    const result = await workflow.start({ targetGuid: user.guid, status: 'active', reason: null, expectedAuthVersion: 8 })
    assert.equal(result.failureCode, code)
    assert.deepEqual(Object.keys(result).sort(), ['failureCode', 'state', 'user'])
    assert.doesNotMatch(JSON.stringify(result), /private|status|response|secret|reason/)
  }
  const unknown = createAdminUserStatusWorkflow({ api: { patchAdminUserStatus: async () => { throw { code: 'unsafe_private' } } } })
  assert.equal((await unknown.start({ targetGuid: user.guid, status: 'active', reason: null, expectedAuthVersion: 8 })).failureCode, 'request_failed')
})

test('workflow has no storage, history, analytics, or logging channel', async () => {
  const writes = []
  const originals = [globalThis.localStorage, globalThis.sessionStorage, globalThis.history, globalThis.analytics, globalThis.console]
  const trap = new Proxy({}, { get: () => (...args) => writes.push(args) })
  globalThis.localStorage = trap; globalThis.sessionStorage = trap; globalThis.history = trap; globalThis.analytics = trap; globalThis.console = trap
  try {
    const workflow = createAdminUserStatusWorkflow({ api: { patchAdminUserStatus: async () => user } })
    await workflow.start({ targetGuid: user.guid, status: 'disabled', reason: 'never persist me', expectedAuthVersion: 7 })
    assert.deepEqual(writes, [])
    assert.doesNotMatch(JSON.stringify(workflow.getSnapshot()), /reason|persist/)
  } finally {
    [globalThis.localStorage, globalThis.sessionStorage, globalThis.history, globalThis.analytics, globalThis.console] = originals
  }
})
