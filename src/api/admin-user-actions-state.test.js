import test from 'node:test'
import assert from 'node:assert/strict'
import { createUserDeleteWorkflow, DELETE_STATES } from './admin-user-actions-state.js'

const targetGuid = '123456789012345678'
const ticket = 'av_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
const operationRef = 'op_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
const input = () => ({ targetGuid, expectedAuthVersion: 7, reason: 'duplicate account', currentPassword: 'private password' })
const terminal = (status, extra = {}) => ({ operationRef, scope: 'users.delete', status, finishedAt: status === 'succeeded' || status === 'failed' ? 1790000000000 : null, failureCode: status === 'failed' ? 'target_version_conflict' : null, retryAfter: null, ...extra })

function deferred() {
  let resolve
  let reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function fixture(overrides = {}) {
  const calls = []
  const scheduled = []
  let randomCalls = 0
  let clock = 100
  const api = {
    issueUserDelete: async value => { calls.push({ method: 'issue', value: { ...value } }); return { ticket, expiresAt: 1790000300000 } },
    executeUserDelete: async value => { calls.push({ method: 'execute', value: { ...value } }); return { operationRef, user: { guid: targetGuid, status: 'deleted' } } },
    queryUserDelete: async value => { calls.push({ method: 'query', value: { ...value } }); return terminal('succeeded') },
    ...overrides.api,
  }
  const schedule = overrides.schedule ?? ((callback, delay) => {
    const item = { callback, delay, cancelled: false }
    scheduled.push(item)
    return () => { item.cancelled = true }
  })
  const workflow = createUserDeleteWorkflow({
    api,
    randomBytes: overrides.randomBytes ?? (length => { randomCalls++; assert.equal(length, 32); return Uint8Array.from({ length }, (_, index) => index) }),
    now: overrides.now ?? (() => ++clock),
    schedule,
  })
  return { workflow, calls, scheduled, get randomCalls() { return randomCalls } }
}

test('exports the closed public state vocabulary', () => {
  assert.deepEqual(DELETE_STATES, {
    IDLE: 'idle', VERIFYING: 'verifying', SUBMITTING: 'submitting',
    UNKNOWN: 'unknown', QUERYING: 'querying', SUCCEEDED: 'succeeded',
    FAILED: 'failed', PENDING_RECOVERY: 'pending_recovery',
  })
  assert.ok(Object.isFrozen(DELETE_STATES))
})

test('moves idle through verifying and submitting to succeeded and clears all transient values', async () => {
  const { workflow, calls } = fixture()
  const seen = []
  workflow.subscribe(snapshot => seen.push(snapshot.state))

  const result = await workflow.start(input())

  assert.deepEqual(seen, ['idle', 'verifying', 'submitting', 'succeeded'])
  assert.deepEqual(result, { state: 'succeeded', operationRef, failureCode: null })
  assert.deepEqual(workflow.getSnapshot(), { state: 'succeeded', operationRef, failure: null, updatedAt: 104 })
  assert.equal(calls.filter(call => call.method === 'issue').length, 1)
  assert.equal(calls.filter(call => call.method === 'execute').length, 1)
  assert.deepEqual(Object.keys(calls[0].value).sort(), ['currentPassword', 'expectedAuthVersion', 'reason', 'targetGuid'])
  assert.deepEqual(Object.keys(calls[1].value).sort(), ['expectedAuthVersion', 'idempotencyKey', 'reason', 'targetGuid', 'ticket'])
})

test('generates and validates the one workflow key before a deferred Issue request', async () => {
  const issue = deferred()
  const instance = fixture({ api: {
    issueUserDelete: value => { instance.calls.push({ method: 'issue', value: { ...value } }); return issue.promise },
  } })
  const running = instance.workflow.start(input())
  assert.equal(instance.workflow.getSnapshot().state, 'verifying')
  assert.equal(instance.randomCalls, 1)
  assert.equal(instance.calls.filter(call => call.method === 'issue').length, 1)
  issue.resolve({ ticket, expiresAt: 1790000300000 })
  await running
  assert.equal(instance.randomCalls, 1)
})

test('every known Issue or Execute failure enters failed and reset is the only failed-to-idle transition', async () => {
  const knownFailures = [
    ['authentication_failed', 401], ['invalid_admin_action_request', 400],
    ['action_verification_rejected', 403], ['action_operation_rejected', 403],
    ['action_target_not_found', 404], ['action_operation_not_found', 404],
    ['action_verification_conflict', 409], ['idempotency_conflict', 409],
    ['idempotency_cross_session', 409], ['action_rejected', 409],
    ['target_version_conflict', 409], ['policy_version_conflict', 409],
    ['target_state_conflict', 409], ['consumer_validation_failed', 409],
    ['operation_expired', 410], ['action_inactive', 422],
    ['action_rate_limited', 429], ['action_dependency_unavailable', 503],
    ['request_failed', 500],
  ].map(([code, status]) => ({ code, message: '请求无法完成', status, operationRef: null, retryAfter: null }))
  const cases = [['issue', knownFailures[2]], ...knownFailures.map(failure => ['execute', failure])]
  for (const [stage, failure] of cases) {
    const { workflow, calls } = fixture({ api: {
      issueUserDelete: async value => { calls.push({ method: 'issue', value: { ...value } }); if (stage === 'issue') throw failure; return { ticket, expiresAt: 1790000300000 } },
      executeUserDelete: async value => { calls.push({ method: 'execute', value: { ...value } }); throw failure },
    } })
    const result = await workflow.start(input())
    assert.equal(result.state, 'failed')
    assert.equal(workflow.getSnapshot().failure.code, failure.code)
    assert.equal(calls.some(call => call.method === 'query'), false)
    assert.equal(workflow.reset(), true)
    assert.equal(workflow.getSnapshot().state, 'idle')
    assert.equal(workflow.reset(), false)
  }
})

test('an invalid random source becomes a known failure instead of leaving the run unresolved', async () => {
  let apiCalls = 0
  const { workflow } = fixture({
    randomBytes: () => new Uint8Array(31),
    api: {
      issueUserDelete: async () => { apiCalls++ },
      executeUserDelete: async () => { apiCalls++ },
      queryUserDelete: async () => { apiCalls++ },
    },
  })
  assert.equal((await workflow.start(input())).state, 'failed')
  assert.equal(workflow.getSnapshot().failure.code, 'request_failed')
  assert.equal(apiCalls, 0)
})

test('an ambiguous Execute moves unknown to querying and queries with the original key without replaying POST', async () => {
  const query = deferred()
  const failure = { code: 'operation_commit_unknown', message: '请求无法完成', status: 503, operationRef, retryAfter: null }
  const { workflow, calls } = fixture({ api: {
    executeUserDelete: async value => { calls.push({ method: 'execute', value: { ...value } }); throw failure },
    queryUserDelete: async value => { calls.push({ method: 'query', value: { ...value } }); return query.promise },
  } })
  const seen = []
  workflow.subscribe(snapshot => seen.push(snapshot.state))
  const running = workflow.start(input())
  await waitFor(() => calls.some(call => call.method === 'query'))
  assert.deepEqual(seen, ['idle', 'verifying', 'submitting', 'unknown', 'querying'])
  const execute = calls.find(call => call.method === 'execute')
  const queryCall = calls.find(call => call.method === 'query')
  assert.match(execute.value.idempotencyKey, /^ik_[A-Za-z0-9_-]{43}$/)
  assert.equal(queryCall.value.idempotencyKey, execute.value.idempotencyKey)
  assert.deepEqual(Object.keys(queryCall.value), ['idempotencyKey'])
  query.resolve(terminal('succeeded'))
  assert.equal((await running).state, 'succeeded')
  assert.equal(calls.filter(call => call.method === 'issue').length, 1)
  assert.equal(calls.filter(call => call.method === 'execute').length, 1)
})

test('a network-ambiguous Execute also queries, while the same failure during Issue is known failed', async () => {
  const network = { code: 'request_failed', message: '请求失败，请稍后重试', status: null, operationRef: null, retryAfter: null }
  const executeCase = fixture({ api: { executeUserDelete: async () => { throw network } } })
  assert.equal((await executeCase.workflow.start(input())).state, 'succeeded')
  assert.equal(executeCase.calls.filter(call => call.method === 'query').length, 1)

  const issueCase = fixture({ api: { issueUserDelete: async () => { throw network } } })
  assert.equal((await issueCase.workflow.start(input())).state, 'failed')
  assert.equal(issueCase.calls.filter(call => call.method === 'query').length, 0)
})

test('processing schedules bounded integer Retry-After polling and remains querying', async () => {
  const statuses = [
    terminal('processing', { finishedAt: null, retryAfter: -4 }),
    terminal('processing', { finishedAt: null, retryAfter: 45 }),
    terminal('succeeded'),
  ]
  const { workflow, calls, scheduled } = fixture({ api: {
    executeUserDelete: async () => { throw { code: 'operation_commit_unknown', status: 503, operationRef } },
    queryUserDelete: async value => { calls.push({ method: 'query', value: { ...value } }); return statuses.shift() },
  } })
  const running = workflow.start(input())
  await waitFor(() => scheduled.length === 1)
  assert.equal(workflow.getSnapshot().state, 'querying')
  assert.equal(scheduled[0].delay, 1000)
  await scheduled[0].callback()
  await waitFor(() => scheduled.length === 2)
  assert.equal(scheduled[1].delay, 30000)
  await scheduled[1].callback()
  assert.equal((await running).state, 'succeeded')
  assert.equal(calls.filter(call => call.method === 'query').length, 3)
})

test('Query succeeded, failed, and pending_recovery are terminal and pending recovery never schedules again', async () => {
  for (const status of ['succeeded', 'failed', 'pending_recovery']) {
    const { workflow, scheduled } = fixture({ api: {
      executeUserDelete: async () => { throw { code: 'operation_commit_unknown', status: 503, operationRef } },
      queryUserDelete: async () => terminal(status),
    } })
    const result = await workflow.start(input())
    assert.equal(result.state, status)
    assert.equal(workflow.getSnapshot().state, status)
    assert.equal(scheduled.length, 0)
    if (status === 'failed') assert.equal(result.failureCode, 'target_version_conflict')
  }
})

test('duplicate clicks share one run and cannot replay Issue or Execute', async () => {
  const issue = deferred()
  const { workflow, calls } = fixture({ api: {
    issueUserDelete: value => { calls.push({ method: 'issue', value: { ...value } }); return issue.promise },
  } })
  const first = workflow.start(input())
  const second = workflow.start(input())
  assert.equal(first, second)
  issue.resolve({ ticket, expiresAt: 1790000300000 })
  await first
  assert.equal(calls.filter(call => call.method === 'issue').length, 1)
  assert.equal(calls.filter(call => call.method === 'execute').length, 1)
})

test('unmount cancels pending polling, ignores late work, and clears the original key', async () => {
  const execute = deferred()
  const { workflow, calls, scheduled } = fixture({ api: {
    executeUserDelete: value => { calls.push({ method: 'execute', value: { ...value } }); return execute.promise },
  } })
  const running = workflow.start(input())
  await waitFor(() => calls.some(call => call.method === 'execute'))
  const key = calls.find(call => call.method === 'execute').value.idempotencyKey
  workflow.unmount()
  execute.reject({ code: 'operation_commit_unknown', status: 503, operationRef })
  assert.equal((await running).state, 'idle')
  assert.equal(calls.some(call => call.method === 'query'), false)
  assert.equal(scheduled.length, 0)
  assert.ok(key)

  const polling = fixture({ api: {
    executeUserDelete: async () => { throw { code: 'operation_commit_unknown', status: 503, operationRef } },
    queryUserDelete: async value => {
      polling.calls.push({ method: 'query', value: { ...value } })
      return terminal('processing', { finishedAt: null, retryAfter: 5 })
    },
  } })
  const pending = polling.workflow.start(input())
  await waitFor(() => polling.scheduled.length === 1)
  polling.workflow.unmount()
  assert.equal(polling.scheduled[0].cancelled, true)
  assert.equal((await pending).state, 'idle')
  await polling.scheduled[0].callback()
  assert.equal(polling.calls.filter(call => call.method === 'query').length, 1)
})

test('rejects invalid scheduler handles and thrown or synchronous scheduling without hanging or replaying an API call', async t => {
  for (const schedule of [() => null, () => ({}), () => 42, callback => { callback(); return () => {} }, () => { throw Error('scheduler-private') }]) {
    const instance = fixture({
      schedule,
      api: {
        executeUserDelete: async () => { throw { code: 'operation_commit_unknown', status: 503, operationRef } },
        queryUserDelete: async value => {
          instance.calls.push({ method: 'query', value: { ...value } })
          return terminal('processing', { finishedAt: null, retryAfter: 5 })
        },
      },
    })
    t.after(() => instance.workflow.unmount())
    const result = await instance.workflow.start(input())
    assert.equal(result.state, 'failed')
    assert.equal(instance.workflow.getSnapshot().failure.code, 'request_failed')
    assert.equal(instance.calls.filter(call => call.method === 'query').length, 1)
  }
})

test('isolates a throwing cancel so unmount still clears state, settles, and blocks the late callback', async () => {
  let callback
  let cancelCalls = 0
  const instance = fixture({
    schedule: scheduled => {
      callback = scheduled
      return () => { cancelCalls++; throw Error('cancel-private') }
    },
    api: {
      executeUserDelete: async () => { throw { code: 'operation_commit_unknown', status: 503, operationRef } },
      queryUserDelete: async value => {
        instance.calls.push({ method: 'query', value: { ...value } })
        return terminal('processing', { finishedAt: null, retryAfter: 5 })
      },
    },
  })
  const running = instance.workflow.start(input())
  await waitFor(() => typeof callback === 'function')
  assert.doesNotThrow(() => instance.workflow.unmount())
  assert.equal(cancelCalls, 1)
  assert.equal((await running).state, 'idle')
  assert.equal(instance.workflow.getSnapshot().state, 'idle')
  await callback()
  assert.equal(instance.calls.filter(call => call.method === 'query').length, 1)
})

test('terminal cleanup isolates a throwing cancel and a failed terminal can still reset', async () => {
  for (const terminalStatus of ['succeeded', 'failed']) {
    let callback
    let cancelCalls = 0
    let queryCalls = 0
    const instance = fixture({
      schedule: scheduled => {
        callback = scheduled
        return () => { cancelCalls++; throw Error('cancel-private') }
      },
      api: {
        executeUserDelete: async () => { throw { code: 'operation_commit_unknown', status: 503, operationRef } },
        queryUserDelete: async () => ++queryCalls === 1
          ? terminal('processing', { finishedAt: null, retryAfter: 5 })
          : terminal(terminalStatus),
      },
    })
    const running = instance.workflow.start(input())
    await waitFor(() => typeof callback === 'function')
    assert.doesNotThrow(() => callback())
    assert.equal((await running).state, terminalStatus)
    assert.equal(cancelCalls, 1)
    await callback()
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(queryCalls, 2)
    if (terminalStatus === 'failed') {
      assert.equal(instance.workflow.reset(), true)
      assert.equal(instance.workflow.getSnapshot().state, 'idle')
    }
  }
})

test('request arguments prove password, ticket, and key stay in their required stages and old values are not reused', async () => {
  let randomRound = 0
  let issueRound = 0
  const secondTicket = 'av_AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE'
  const records = []
  const instance = fixture({
    randomBytes: length => Uint8Array.from({ length }, () => randomRound++),
    api: {
      issueUserDelete: async value => {
        records.push({ stage: 'issue', value: { ...value } })
        return { ticket: issueRound++ === 0 ? ticket : secondTicket, expiresAt: 1790000300000 }
      },
      executeUserDelete: async value => {
        records.push({ stage: 'execute', value: { ...value } })
        if (records.filter(record => record.stage === 'execute').length === 1) throw { code: 'target_state_conflict', status: 409 }
        return { operationRef, user: { guid: targetGuid, status: 'deleted' } }
      },
      queryUserDelete: async value => { records.push({ stage: 'query', value: { ...value } }); return terminal('succeeded') },
    },
  })
  const first = await instance.workflow.start(input())
  assert.equal(first.state, 'failed')
  const firstKey = records.find(record => record.stage === 'execute').value.idempotencyKey
  assert.equal(instance.workflow.reset(), true)
  const second = await instance.workflow.start({ ...input(), currentPassword: 'second private password' })
  assert.equal(second.state, 'succeeded')
  const issues = records.filter(record => record.stage === 'issue')
  const executes = records.filter(record => record.stage === 'execute')
  assert.equal(issues[0].value.currentPassword, 'private password')
  assert.equal(issues[1].value.currentPassword, 'second private password')
  assert.equal(Object.hasOwn(executes[0].value, 'currentPassword'), false)
  assert.equal(Object.hasOwn(executes[1].value, 'currentPassword'), false)
  assert.equal(executes[0].value.ticket, ticket)
  assert.equal(executes[1].value.ticket, secondTicket)
  assert.notEqual(executes[1].value.idempotencyKey, firstKey)
  assert.equal(records.some(record => record.stage === 'query'), false)
  assert.deepEqual(Object.keys(instance.workflow.getSnapshot()).sort(), ['failure', 'operationRef', 'state', 'updatedAt'])
})

test('generates one canonical key from exactly 32 injected random bytes and has no persistence or logging channels', async () => {
  const writes = []
  const oldLocal = globalThis.localStorage
  const oldSession = globalThis.sessionStorage
  const oldConsole = globalThis.console
  const oldHistory = globalThis.history
  const oldAnalytics = globalThis.analytics
  const trap = { setItem: (...args) => writes.push(args) }
  globalThis.localStorage = trap
  globalThis.sessionStorage = trap
  globalThis.history = { pushState: (...args) => writes.push(args), replaceState: (...args) => writes.push(args) }
  globalThis.analytics = { track: (...args) => writes.push(args) }
  globalThis.console = new Proxy(oldConsole, { get() { return (...args) => writes.push(args) } })
  try {
    const instance = fixture()
    await instance.workflow.start(input())
    assert.equal(instance.randomCalls, 1)
    const key = instance.calls.find(call => call.method === 'execute').value.idempotencyKey
    assert.equal(key, 'ik_AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8')
    assert.deepEqual(writes, [])
    assert.equal(Object.hasOwn(instance.workflow, 'analytics'), false)
    assert.equal(Object.hasOwn(instance.workflow.getSnapshot(), 'url'), false)
  } finally {
    globalThis.localStorage = oldLocal
    globalThis.sessionStorage = oldSession
    globalThis.console = oldConsole
    globalThis.history = oldHistory
    globalThis.analytics = oldAnalytics
  }
})

async function waitFor(predicate) {
  for (let attempt = 0; attempt < 50; attempt++) {
    if (predicate()) return
    await new Promise(resolve => setImmediate(resolve))
  }
  assert.fail('condition was not reached')
}
