import test from 'node:test'
import assert from 'node:assert/strict'
import { ADMIN_USER_CREATE_STATES, createAdminUserCreateWorkflow } from './admin-user-create-state.js'

const operationRef = `op_${'A'.repeat(43)}`
const ticket = `av_${'A'.repeat(43)}`
const createdUser = Object.freeze({
  guid: '123456789012345679', username: 'alice', nickname: 'Alice', email: null, group: 'default', planType: 'free',
  role: 'user', status: 'active', authVersion: 1, createdAt: '2026-09-06T00:00:00.000Z', lastLoginAt: null,
})
const createdAdminUser = Object.freeze({
  ...createdUser, username: 'admin-alice', nickname: 'Admin Alice', role: 'admin',
})
const firstGeneratedKey = 'ik_AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8'

const userInput = (overrides = {}) => ({
  username: '  alice  ', nickname: '  Alice  ', password: 'Str0ng!Pass', role: 'user',
  groupGuid: null, planType: 'free', permissionOverrides: [], ...overrides,
})
const adminInput = (overrides = {}) => userInput({
  username: ' admin-alice ', nickname: ' Admin Alice ', role: 'admin', currentPassword: 'Current!Pass9',
  permissionOverrides: [{ capability: 'users.plan.change', effect: 'deny' }, { capability: 'users.sessions.read', effect: 'allow' }],
  ...overrides,
})
const terminal = (scope, status, extra = {}) => ({
  operationRef, scope, status,
  finishedAt: ['succeeded', 'failed'].includes(status) ? 1790000000000 : null,
  failureCode: status === 'failed' ? 'consumer_validation_failed' : null,
  retryAfter: null,
  ...extra,
})

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
  let randomSeed = 0
  const api = {
    issueAdminUserCreateVerification: async value => {
      calls.push({ method: 'issue', value })
      return { ticket, expiresAt: 1790000300000 }
    },
    executeAdminUserCreate: async value => {
      calls.push({ method: 'create', value })
      const user = Object.freeze({
        ...createdUser,
        username: value.request.username,
        nickname: value.request.nickname,
        role: value.request.role,
        planType: value.request.plan_type,
      })
      return {
        operationRef,
        user,
        permissionsVersion: value.request.role === 'admin' ? '1' : null,
      }
    },
    queryAdminUserCreate: async value => {
      calls.push({ method: 'query', value })
      return terminal(value.scope, 'succeeded')
    },
    ...overrides.api,
  }
  const schedule = overrides.schedule ?? ((callback, delay) => {
    const item = { callback, delay, cancelled: false }
    scheduled.push(item)
    return () => { item.cancelled = true }
  })
  const workflow = createAdminUserCreateWorkflow({
    api,
    randomBytes: overrides.randomBytes ?? (length => {
      randomCalls++
      assert.equal(length, 32)
      const start = randomSeed++
      return Uint8Array.from({ length }, (_, index) => start + index)
    }),
    schedule,
  })
  return { workflow, calls, scheduled, get randomCalls() { return randomCalls } }
}

test('exports a frozen closed state vocabulary', () => {
  assert.deepEqual(ADMIN_USER_CREATE_STATES, {
    IDLE: 'idle', VERIFYING: 'verifying', SUBMITTING: 'submitting', UNKNOWN: 'unknown', QUERYING: 'querying',
    SUCCEEDED: 'succeeded', FAILED: 'failed', PENDING_RECOVERY: 'pending_recovery',
  })
  assert.equal(Object.isFrozen(ADMIN_USER_CREATE_STATES), true)
})

test('ordinary creation skips verification and reuses one idempotency key for an exact-scope query', async () => {
  const failure = { code: 'operation_commit_unknown', message: '请求无法完成', status: 503, operationRef, retryAfter: null }
  const instance = fixture({ api: {
    executeAdminUserCreate: async value => { instance.calls.push({ method: 'create', value }); throw failure },
    queryAdminUserCreate: async value => { instance.calls.push({ method: 'query', value }); return terminal(value.scope, 'succeeded') },
  } })
  const seen = []
  instance.workflow.subscribe(snapshot => seen.push(snapshot.state))
  const result = await instance.workflow.start(userInput())

  assert.deepEqual(result, { state: 'succeeded', operationRef, failureCode: null, createdUser: null })
  assert.deepEqual(seen, ['idle', 'submitting', 'unknown', 'querying', 'succeeded'])
  assert.equal(instance.calls.filter(call => call.method === 'issue').length, 0)
  const create = instance.calls.find(call => call.method === 'create')
  const query = instance.calls.find(call => call.method === 'query')
  assert.equal(create.value.idempotencyKey, query.value.idempotencyKey)
  assert.equal(query.value.scope, 'users.create')
  assert.deepEqual(Object.keys(query.value).sort(), ['idempotencyKey', 'scope'])
  assert.equal(instance.randomCalls, 1)
})

test('administrator verification and create use the same normalized request and one key', async () => {
  const instance = fixture()
  const seen = []
  instance.workflow.subscribe(snapshot => seen.push(snapshot.state))
  const result = await instance.workflow.start(adminInput())

  assert.equal(result.state, 'succeeded')
  assert.deepEqual(result.createdUser, createdAdminUser)
  assert.deepEqual(seen, ['idle', 'verifying', 'submitting', 'succeeded'])
  const issue = instance.calls.find(call => call.method === 'issue')
  const create = instance.calls.find(call => call.method === 'create')
  assert.equal(issue.value.request, create.value.request)
  assert.deepEqual(issue.value.request, {
    username: 'admin-alice', nickname: 'Admin Alice', password: 'Str0ng!Pass', role: 'admin', group_guid: null, plan_type: 'free',
    permission_overrides: [{ capability: 'users.sessions.read', effect: 'allow' }, { capability: 'users.plan.change', effect: 'deny' }],
  })
  assert.deepEqual(Object.keys(issue.value).sort(), ['currentPassword', 'request'])
  assert.deepEqual(Object.keys(create.value).sort(), ['idempotencyKey', 'request', 'ticket'])
  assert.equal(issue.value.currentPassword, 'Current!Pass9')
  assert.equal(create.value.ticket, ticket)
  assert.equal(instance.randomCalls, 1)
})

test('duplicate clicks share one logical attempt and cannot duplicate verification or create', async () => {
  const issue = deferred()
  const instance = fixture({ api: {
    issueAdminUserCreateVerification: value => { instance.calls.push({ method: 'issue', value }); return issue.promise },
  } })
  const first = instance.workflow.start(adminInput())
  const second = instance.workflow.start(adminInput({ username: 'ignored-second' }))
  assert.equal(first, second)
  assert.equal(instance.randomCalls, 1)
  assert.equal(instance.calls.filter(call => call.method === 'issue').length, 1)
  issue.resolve({ ticket, expiresAt: 1790000300000 })
  assert.equal((await first).state, 'succeeded')
  assert.equal(instance.calls.filter(call => call.method === 'create').length, 1)
})

test('ordinary synchronous subscriber restart keeps attempt promises, keys, and secrets isolated', async () => {
  const instance = fixture()
  let restarted = false
  let secondPromise
  instance.workflow.subscribe(snapshot => {
    if (!restarted && snapshot.state === 'submitting') {
      restarted = true
      assert.equal(instance.workflow.reset(), true)
      secondPromise = instance.workflow.start(userInput({
        username: 'second-user', nickname: 'Second User', password: 'Second!Pass',
      }))
    }
  })

  const firstPromise = instance.workflow.start(userInput({
    username: 'first-user', nickname: 'First User', password: 'First!Pass',
  }))
  assert.ok(secondPromise)
  assert.notEqual(firstPromise, secondPromise)
  assert.deepEqual(await firstPromise, { state: 'idle', operationRef: null, failureCode: null, createdUser: null })
  assert.equal((await secondPromise).state, 'succeeded')

  const creates = instance.calls.filter(call => call.method === 'create')
  assert.equal(creates.length, 1)
  assert.equal(creates[0].value.request.username, 'second-user')
  assert.equal(creates[0].value.request.password, 'Second!Pass')
  assert.notEqual(creates[0].value.idempotencyKey, firstGeneratedKey)
  assert.equal(instance.randomCalls, 2)
})

test('administrator synchronous subscriber restart cannot cross verification secrets or attempts', async () => {
  const instance = fixture()
  let restarted = false
  let secondPromise
  instance.workflow.subscribe(snapshot => {
    if (!restarted && snapshot.state === 'verifying') {
      restarted = true
      assert.equal(instance.workflow.reset(), true)
      secondPromise = instance.workflow.start(adminInput({
        username: 'second-admin', nickname: 'Second Admin', password: 'Second!Pass', currentPassword: 'Second!Current9',
      }))
    }
  })

  const firstPromise = instance.workflow.start(adminInput({
    username: 'first-admin', nickname: 'First Admin', password: 'First!Pass', currentPassword: 'First!Current9',
  }))
  assert.ok(secondPromise)
  assert.notEqual(firstPromise, secondPromise)
  assert.deepEqual(await firstPromise, { state: 'idle', operationRef: null, failureCode: null, createdUser: null })
  assert.equal((await secondPromise).state, 'succeeded')

  const issues = instance.calls.filter(call => call.method === 'issue')
  const creates = instance.calls.filter(call => call.method === 'create')
  assert.equal(issues.length, 1)
  assert.equal(creates.length, 1)
  assert.equal(issues[0].value.request.username, 'second-admin')
  assert.equal(issues[0].value.request.password, 'Second!Pass')
  assert.equal(issues[0].value.currentPassword, 'Second!Current9')
  assert.equal(creates[0].value.request, issues[0].value.request)
  assert.equal(creates[0].value.ticket, ticket)
  assert.notEqual(creates[0].value.idempotencyKey, firstGeneratedKey)
  assert.equal(instance.randomCalls, 2)
})

test('bounded polling clamps delays and succeeds without replaying POST', async () => {
  const statuses = [
    terminal('users.create', 'processing', { retryAfter: -9 }),
    terminal('users.create', 'processing', { retryAfter: 80 }),
    terminal('users.create', 'succeeded'),
  ]
  const instance = fixture({ api: {
    executeAdminUserCreate: async value => { instance.calls.push({ method: 'create', value }); throw { code: 'operation_commit_unknown', status: 503, operationRef } },
    queryAdminUserCreate: async value => { instance.calls.push({ method: 'query', value }); return statuses.shift() },
  } })
  const running = instance.workflow.start(userInput())
  await waitFor(() => instance.scheduled.length === 1)
  assert.equal(instance.scheduled[0].delay, 1000)
  await instance.scheduled[0].callback()
  await waitFor(() => instance.scheduled.length === 2)
  assert.equal(instance.scheduled[1].delay, 30000)
  await instance.scheduled[1].callback()
  assert.equal((await running).state, 'succeeded')
  assert.equal(instance.calls.filter(call => call.method === 'create').length, 1)
  assert.equal(instance.calls.filter(call => call.method === 'query').length, 3)
})

test('polling stops after five responses and reports pending recovery', async () => {
  const instance = fixture({ api: {
    executeAdminUserCreate: async () => { throw { code: 'operation_commit_unknown', status: 503, operationRef } },
    queryAdminUserCreate: async value => {
      instance.calls.push({ method: 'query', value })
      return terminal(value.scope, 'processing', { retryAfter: 30 })
    },
  } })
  const running = instance.workflow.start(userInput())
  for (let poll = 0; poll < 4; poll++) {
    await waitFor(() => instance.scheduled.length === poll + 1)
    await instance.scheduled[poll].callback()
  }
  assert.deepEqual(await running, { state: 'pending_recovery', operationRef, failureCode: null, createdUser: null })
  assert.equal(instance.calls.filter(call => call.method === 'query').length, 5)
  assert.equal(instance.scheduled.length, 4)
})

test('query terminal failure retains only a safe failure code', async () => {
  const instance = fixture({ api: {
    executeAdminUserCreate: async () => { throw { code: 'operation_commit_unknown', status: 503, operationRef } },
    queryAdminUserCreate: async value => terminal(value.scope, 'failed', { failureCode: 'consumer_validation_failed' }),
  } })
  assert.deepEqual(await instance.workflow.start(userInput()), {
    state: 'failed', operationRef, failureCode: 'consumer_validation_failed', createdUser: null,
  })
  assert.deepEqual(instance.workflow.getSnapshot(), {
    state: 'failed', operationRef, failureCode: 'consumer_validation_failed', createdUser: null,
  })
})

test('unsafe failure codes and unsafe operation references never enter snapshots', async () => {
  const instance = fixture({ api: {
    executeAdminUserCreate: async () => { throw { code: 'private_password_Str0ng!Pass', status: 409, operationRef: 'op_private' } },
  } })
  assert.deepEqual(await instance.workflow.start(userInput()), {
    state: 'failed', operationRef: null, failureCode: 'request_failed', createdUser: null,
  })
  assert.deepEqual(Object.keys(instance.workflow.getSnapshot()).sort(), ['createdUser', 'failureCode', 'operationRef', 'state'])
  assert.doesNotMatch(JSON.stringify(instance.workflow.getSnapshot()), /Str0ng|private/)
})

test('a mismatched created-user result fails closed before entering a snapshot', async () => {
  const instance = fixture({ api: {
    executeAdminUserCreate: async () => ({ operationRef, user: createdAdminUser, permissionsVersion: null }),
  } })
  assert.deepEqual(await instance.workflow.start(userInput()), {
    state: 'failed', operationRef: null, failureCode: 'request_failed', createdUser: null,
  })
})

test('reset during verification clears the old password, ticket, and key and ignores the late response', async () => {
  const firstIssue = deferred()
  let issueRound = 0
  const secondTicket = `av_${'E'.repeat(43)}`
  const instance = fixture({ api: {
    issueAdminUserCreateVerification: value => {
      instance.calls.push({ method: 'issue', value })
      return issueRound++ === 0 ? firstIssue.promise : Promise.resolve({ ticket: secondTicket, expiresAt: 1790000300000 })
    },
  } })
  const first = instance.workflow.start(adminInput({ currentPassword: 'First!Current9' }))
  const firstKeyCallCount = instance.randomCalls
  assert.equal(instance.workflow.reset(), true)
  assert.deepEqual(await first, { state: 'idle', operationRef: null, failureCode: null, createdUser: null })
  firstIssue.resolve({ ticket, expiresAt: 1790000300000 })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(instance.calls.filter(call => call.method === 'create').length, 0)

  const second = await instance.workflow.start(adminInput({ currentPassword: 'Second!Current9' }))
  assert.equal(second.state, 'succeeded')
  const issues = instance.calls.filter(call => call.method === 'issue')
  const create = instance.calls.find(call => call.method === 'create')
  assert.equal(issues[0].value.currentPassword, 'First!Current9')
  assert.equal(issues[1].value.currentPassword, 'Second!Current9')
  assert.equal(create.value.ticket, secondTicket)
  assert.equal(firstKeyCallCount, 1)
  assert.equal(instance.randomCalls, 2)
})

test('reset cancels polling and a new attempt cannot reuse the old key', async () => {
  let attempt = 0
  const instance = fixture({ api: {
    executeAdminUserCreate: async value => {
      instance.calls.push({ method: 'create', value })
      if (attempt++ === 0) throw { code: 'operation_commit_unknown', status: 503, operationRef }
      return { operationRef, user: createdUser, permissionsVersion: null }
    },
    queryAdminUserCreate: async value => {
      instance.calls.push({ method: 'query', value })
      return terminal(value.scope, 'processing', { retryAfter: 5 })
    },
  } })
  const first = instance.workflow.start(userInput())
  await waitFor(() => instance.scheduled.length === 1)
  const oldKey = instance.calls.find(call => call.method === 'create').value.idempotencyKey
  assert.equal(instance.workflow.reset(), true)
  assert.equal(instance.scheduled[0].cancelled, true)
  assert.equal((await first).state, 'idle')
  await instance.scheduled[0].callback()
  assert.equal(instance.calls.filter(call => call.method === 'query').length, 1)

  assert.equal((await instance.workflow.start(userInput({ password: 'N3w!Secret' }))).state, 'succeeded')
  const keys = instance.calls.filter(call => call.method === 'create').map(call => call.value.idempotencyKey)
  assert.notEqual(keys[1], oldKey)
})

test('unmount clears in-flight secrets, blocks query recovery, and ignores late rejection', async () => {
  const create = deferred()
  const unhandled = []
  const onUnhandled = reason => unhandled.push(reason)
  process.on('unhandledRejection', onUnhandled)
  try {
    const instance = fixture({ api: {
      executeAdminUserCreate: value => { instance.calls.push({ method: 'create', value }); return create.promise },
    } })
    const running = instance.workflow.start(adminInput())
    await waitFor(() => instance.calls.some(call => call.method === 'create'))
    instance.workflow.unmount()
    create.reject({ code: 'operation_commit_unknown', status: 503, operationRef })
    assert.deepEqual(await running, { state: 'failed', operationRef: null, failureCode: 'workflow_disposed', createdUser: null })
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(instance.calls.some(call => call.method === 'query'), false)
    assert.deepEqual(unhandled, [])
    assert.deepEqual(await instance.workflow.start(adminInput({ currentPassword: 'Never!Used9' })), {
      state: 'failed', operationRef: null, failureCode: 'workflow_disposed', createdUser: null,
    })
  } finally {
    process.off('unhandledRejection', onUnhandled)
  }
})

test('completed snapshots contain only safe state, operation ref, failure code, and created user', async () => {
  const writes = []
  const localName = ['local', 'Storage'].join('')
  const sessionName = ['session', 'Storage'].join('')
  const oldLocal = globalThis[localName]
  const oldSession = globalThis[sessionName]
  const oldConsole = globalThis.console
  globalThis[localName] = { setItem: (...args) => writes.push(args) }
  globalThis[sessionName] = { setItem: (...args) => writes.push(args) }
  globalThis.console = new Proxy(oldConsole, { get: () => (...args) => writes.push(args) })
  try {
    const instance = fixture()
    await instance.workflow.start(adminInput())
    assert.deepEqual(instance.workflow.getSnapshot(), { state: 'succeeded', operationRef, failureCode: null, createdUser: createdAdminUser })
    assert.deepEqual(writes, [])
    assert.doesNotMatch(JSON.stringify(instance.workflow.getSnapshot()), /Str0ng|Current|av_|ik_/)
  } finally {
    globalThis[localName] = oldLocal
    globalThis[sessionName] = oldSession
    globalThis.console = oldConsole
  }
})

test('invalid random sources and scheduler failures settle without API replay', async () => {
  let calls = 0
  const random = fixture({
    randomBytes: () => new Uint8Array(31),
    api: {
      issueAdminUserCreateVerification: async () => { calls++ },
      executeAdminUserCreate: async () => { calls++ },
      queryAdminUserCreate: async () => { calls++ },
    },
  })
  assert.equal((await random.workflow.start(userInput())).failureCode, 'request_failed')
  assert.equal(calls, 0)

  for (const schedule of [() => null, callback => { callback(); return () => {} }, () => { throw Error('private') }]) {
    const instance = fixture({
      schedule,
      api: {
        executeAdminUserCreate: async () => { throw { code: 'operation_commit_unknown', status: 503, operationRef } },
        queryAdminUserCreate: async value => terminal(value.scope, 'processing', { retryAfter: 5 }),
      },
    })
    assert.equal((await instance.workflow.start(userInput())).failureCode, 'request_failed')
  }
})

async function waitFor(predicate) {
  for (let attempt = 0; attempt < 50; attempt++) {
    if (predicate()) return
    await new Promise(resolve => setImmediate(resolve))
  }
  assert.fail('condition was not reached')
}
