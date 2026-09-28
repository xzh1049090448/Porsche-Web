import assert from 'node:assert/strict'
import test from 'node:test'

import { createRolePermissionAttempt, ROLE_PERMISSION_PHASES } from './admin-user-roles-permissions-state.js'

const TICKET = 'av_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
const OPERATION = 'op_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
const KEY = 'ik_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
const base = Object.freeze({
  targetGuid: '9',
  expectedAuthVersion: 7,
  expectedPermissionsVersion: 3,
  catalogVersion: 1,
  overrides: Object.freeze([{ capability: 'users.read', effect: 'deny' }]),
  reason: 'rotation',
  currentPassword: 'Root1!!',
})

const deferred = () => {
  let resolve
  let reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const tick = () => new Promise(resolve => setImmediate(resolve))
const randomBytes = () => new Uint8Array(32)

test('attempt singleflights one verified mutation and exposes no secrets', async () => {
  const issued = deferred()
  const executed = deferred()
  const calls = { issue: [], execute: [] }
  const workflow = createRolePermissionAttempt({
    api: {
      issuePromote: input => { calls.issue.push(input); return issued.promise },
      executePromote: input => { calls.execute.push(input); return executed.promise },
      query: async () => assert.fail('unexpected query'),
    },
    randomBytes,
    schedule: () => assert.fail('unexpected schedule'),
  })
  const input = { ...base, overrides: base.overrides.map(item => ({ ...item })) }
  const first = workflow.start('users.promote', input)
  const second = workflow.start('users.promote', { ...input, reason: 'second' })
  assert.equal(first, second)
  assert.equal(workflow.getSnapshot().phase, ROLE_PERMISSION_PHASES.VERIFYING)
  assert.doesNotMatch(JSON.stringify(workflow.getSnapshot()), /Root1!!|av_|ik_/)

  input.reason = 'mutated'
  input.overrides[0].effect = 'allow'
  issued.resolve({ ticket: TICKET, expiresAt: 1790000300000 })
  await tick()
  assert.equal(workflow.getSnapshot().phase, ROLE_PERMISSION_PHASES.EXECUTING)
  assert.equal(calls.issue.length, 1)
  assert.equal(calls.execute.length, 1)
  assert.equal(calls.execute[0].reason, 'rotation')
  assert.deepEqual(calls.execute[0].overrides, [{ capability: 'users.read', effect: 'deny' }])
  assert.equal(calls.execute[0].idempotencyKey, KEY)

  executed.resolve({ operationRef: OPERATION, targetGuid: '9', resultingAuthVersion: 8, resultingPermissionsVersion: 4, resultingRole: 'admin' })
  const result = await first
  assert.equal(result.phase, ROLE_PERMISSION_PHASES.SUCCEEDED)
  assert.equal(result.operationRef, OPERATION)
  assert.doesNotMatch(JSON.stringify(result), /Root1!!|av_|ik_/)
})

test('commit unknown queries only with the original scope and key and honors Retry-After', async () => {
  const scheduled = []
  const calls = { issue: 0, execute: [], query: [] }
  const workflow = createRolePermissionAttempt({
    api: {
      issuePermissionWrite: async () => { calls.issue++; return { ticket: TICKET } },
      executePermissionWrite: async input => { calls.execute.push(input); throw { code: 'operation_commit_unknown', status: 503, operationRef: OPERATION } },
      query: async input => {
        calls.query.push(input)
        return calls.query.length === 1
          ? { status: 'processing', operationRef: OPERATION, retryAfter: 7 }
          : { status: 'succeeded', operationRef: OPERATION, targetGuid: '9', resultingAuthVersion: 8, resultingPermissionsVersion: 4, resultingRole: 'admin' }
      },
    },
    randomBytes,
    schedule: (callback, delay) => { scheduled.push({ callback, delay }); return () => {} },
  })
  const running = workflow.start('users.permissions.write', base)
  await tick()
  assert.equal(workflow.getSnapshot().phase, ROLE_PERMISSION_PHASES.QUERYING)
  assert.deepEqual(calls, {
    issue: 1,
    execute: [{
      targetGuid: '9', expectedAuthVersion: 7, expectedPermissionsVersion: 3, catalogVersion: 1,
      overrides: [{ capability: 'users.read', effect: 'deny' }], reason: 'rotation', ticket: TICKET, idempotencyKey: KEY,
    }],
    query: [{ scope: 'users.permissions.write', idempotencyKey: KEY }],
  })
  assert.equal(scheduled.length, 1)
  assert.equal(scheduled[0].delay, 7000)
  scheduled[0].callback()
  assert.equal((await running).phase, ROLE_PERMISSION_PHASES.SUCCEEDED)
  assert.equal(calls.execute.length, 1)
  assert.deepEqual(calls.query, [
    { scope: 'users.permissions.write', idempotencyKey: KEY },
    { scope: 'users.permissions.write', idempotencyKey: KEY },
  ])
})

test('attempt distinguishes conflicts failures and pending recovery and ignores disposed work', async () => {
  const fixture = executeError => createRolePermissionAttempt({
    api: {
      issueDemote: async () => ({ ticket: TICKET }),
      executeDemote: async () => { throw executeError },
      query: async () => ({ status: 'pending_recovery', operationRef: OPERATION }),
    }, randomBytes, schedule: () => () => {},
  })
  assert.equal((await fixture({ code: 'target_version_conflict', status: 409 }).start('users.demote', { ...base, overrides: undefined })).phase, ROLE_PERMISSION_PHASES.CONFLICT)
  assert.equal((await fixture({ code: 'action_dependency_unavailable', status: 503 }).start('users.demote', { ...base, overrides: undefined })).phase, ROLE_PERMISSION_PHASES.FAILED)
  assert.equal((await fixture({ code: 'operation_commit_unknown', status: 503, operationRef: OPERATION }).start('users.demote', { ...base, overrides: undefined })).phase, ROLE_PERMISSION_PHASES.PENDING_RECOVERY)

  const issued = deferred()
  let executeCalls = 0
  const disposed = createRolePermissionAttempt({ api: {
    issuePromote: () => issued.promise,
    executePromote: async () => { executeCalls++ },
    query: async () => assert.fail('unexpected query'),
  }, randomBytes, schedule: () => () => {} })
  const running = disposed.start('users.promote', base)
  disposed.dispose()
  issued.resolve({ ticket: TICKET })
  assert.equal((await running).failureCode, 'workflow_disposed')
  assert.equal(executeCalls, 0)
})

test('attempt maps untrusted Issue Execute and Query failure codes through frozen public allowlists', async () => {
  const rawMarker = 'raw-secret-RootSecret1!!'
  const scenarios = [
    {
      api: {
        issueDemote: async () => { throw { code: rawMarker, status: 503 } },
        executeDemote: async () => assert.fail('unexpected execute'),
        query: async () => assert.fail('unexpected query'),
      },
    },
    {
      api: {
        issueDemote: async () => ({ ticket: TICKET }),
        executeDemote: async () => { throw { code: rawMarker, status: 503 } },
        query: async () => assert.fail('unexpected query'),
      },
    },
    {
      api: {
        issueDemote: async () => ({ ticket: TICKET }),
        executeDemote: async () => { throw { code: 'operation_commit_unknown', status: 503, operationRef: OPERATION } },
        query: async () => ({ status: 'failed', operationRef: OPERATION, failureCode: rawMarker }),
      },
    },
  ]

  for (const { api } of scenarios) {
    const snapshots = []
    const workflow = createRolePermissionAttempt({ api, randomBytes, schedule: () => () => {} })
    workflow.subscribe(snapshot => { snapshots.push(snapshot) })
    const result = await workflow.start('users.demote', { ...base, overrides: undefined })
    assert.equal(result.failureCode, 'request_failed')
    assert.doesNotMatch(JSON.stringify({ result, snapshots }), /raw-secret|RootSecret1!!/)
  }

  const knownError = createRolePermissionAttempt({
    api: {
      issueDemote: async () => { throw { code: 'action_dependency_unavailable', status: 503 } },
      executeDemote: async () => assert.fail('unexpected execute'),
      query: async () => assert.fail('unexpected query'),
    },
    randomBytes,
    schedule: () => () => {},
  })
  assert.equal((await knownError.start('users.demote', { ...base, overrides: undefined })).failureCode, 'action_dependency_unavailable')

  const knownQueryFailure = createRolePermissionAttempt({
    api: {
      issueDemote: async () => ({ ticket: TICKET }),
      executeDemote: async () => { throw { code: 'operation_commit_unknown', status: 503, operationRef: OPERATION } },
      query: async () => ({ status: 'failed', operationRef: OPERATION, failureCode: 'target_version_conflict' }),
    },
    randomBytes,
    schedule: () => () => {},
  })
  const knownQueryResult = await knownQueryFailure.start('users.demote', { ...base, overrides: undefined })
  assert.equal(knownQueryResult.phase, ROLE_PERMISSION_PHASES.CONFLICT)
  assert.equal(knownQueryResult.failureCode, 'target_version_conflict')
})
