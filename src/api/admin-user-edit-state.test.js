import assert from 'node:assert/strict'
import test from 'node:test'
import { ADMIN_USER_EDIT_STATES, createAdminUserEditWorkflow } from './admin-user-edit-state.js'

const user = Object.freeze({ guid: '123456789012345678', username: 'alice', nickname: null, email: null, group: 'default', planType: 'free', role: 'user', status: 'active', authVersion: 7, createdAt: '2026-09-08T00:00:00.000Z', lastLoginAt: null })
const deferred = () => { let resolve; let reject; const promise = new Promise((done, fail) => { resolve = done; reject = fail }); return { promise, resolve, reject } }

test('exports a closed state vocabulary', () => {
  assert.deepEqual(ADMIN_USER_EDIT_STATES, { IDLE: 'idle', SUBMITTING: 'submitting', SUCCEEDED: 'succeeded', CONFLICT: 'conflict', FAILED: 'failed', DISPOSED: 'disposed' })
})

test('shares duplicate submit, freezes a nullable edit snapshot, and isolates synchronous subscriber re-entry', async () => {
  const pending = deferred()
  const calls = []
  const workflow = createAdminUserEditWorkflow({ api: { patchAdminUserEdit: async value => { calls.push(value); return pending.promise } } })
  const input = { targetGuid: user.guid, nickname: null, expectedAuthVersion: 7 }
  const first = workflow.start(input)
  const second = workflow.start({ ...input })
  input.nickname = 'mutated'
  assert.equal(first, second)
  workflow.subscribe(snapshot => { if (snapshot.state === 'submitting') workflow.reset() })
  pending.resolve(user)
  assert.deepEqual(await first, { state: 'idle', user: null, failureCode: null })
  assert.deepEqual(calls, [{ targetGuid: user.guid, nickname: null, expectedAuthVersion: 7 }])
})

test('does not replay a conflict and reset or dispose discards late resolution', async () => {
  const pending = deferred()
  let calls = 0
  const workflow = createAdminUserEditWorkflow({ api: { patchAdminUserEdit: async () => { calls++; return pending.promise } } })
  const running = workflow.start({ targetGuid: user.guid, nickname: 'Alice', expectedAuthVersion: 7 })
  pending.reject({ code: 'auth_version_conflict', status: 409 })
  assert.deepEqual(await running, { state: 'conflict', user: null, failureCode: 'auth_version_conflict' })
  assert.equal(calls, 1)
  assert.equal(workflow.reset(), true)
  const late = deferred()
  const second = createAdminUserEditWorkflow({ api: { patchAdminUserEdit: async () => late.promise } })
  const secondRun = second.start({ targetGuid: user.guid, nickname: 'Alice', expectedAuthVersion: 7 })
  second.dispose()
  late.resolve(user)
  assert.deepEqual(await secondRun, { state: 'disposed', user: null, failureCode: 'workflow_disposed' })
})

test('preserves only the closed safe edit failure vocabulary without transport details', async () => {
  for (const code of ['authentication_failed', 'forbidden', 'not_found', 'unavailable', 'auth_version_conflict', 'request_failed']) {
    const workflow = createAdminUserEditWorkflow({ api: { patchAdminUserEdit: async () => {
      throw { code, status: 503, message: 'private transport detail', response: { data: { secret: true } } }
    } } })
    const result = await workflow.start({ targetGuid: user.guid, nickname: null, expectedAuthVersion: 7 })
    assert.equal(result.failureCode, code)
    assert.deepEqual(Object.keys(result).sort(), ['failureCode', 'state', 'user'])
    assert.doesNotMatch(JSON.stringify(result), /private|transport|status|response|secret/)
  }

  const workflow = createAdminUserEditWorkflow({ api: { patchAdminUserEdit: async () => { throw { code: 'unsafe_private_code' } } } })
  assert.equal((await workflow.start({ targetGuid: user.guid, nickname: null, expectedAuthVersion: 7 })).failureCode, 'request_failed')
})

test('workflow has no persistence, history, analytics, or logging channel', async () => {
  const writes = []
  const oldLocal = globalThis.localStorage
  const oldSession = globalThis.sessionStorage
  const oldHistory = globalThis.history
  const oldAnalytics = globalThis.analytics
  const oldConsole = globalThis.console
  const trap = new Proxy({}, { get: () => (...args) => writes.push(args) })
  globalThis.localStorage = trap
  globalThis.sessionStorage = trap
  globalThis.history = trap
  globalThis.analytics = trap
  globalThis.console = trap
  try {
    const workflow = createAdminUserEditWorkflow({ api: { patchAdminUserEdit: async () => user } })
    await workflow.start({ targetGuid: user.guid, nickname: null, expectedAuthVersion: 7 })
    assert.deepEqual(writes, [])
    assert.deepEqual(Object.keys(workflow.getSnapshot()).sort(), ['failureCode', 'state', 'user'])
  } finally {
    globalThis.localStorage = oldLocal
    globalThis.sessionStorage = oldSession
    globalThis.history = oldHistory
    globalThis.analytics = oldAnalytics
    globalThis.console = oldConsole
  }
})
