import test from 'node:test'
import assert from 'node:assert/strict'
import { createDirectEntitlementWorkflow, createPasswordResetWorkflow } from './admin-user-entitlements-state.js'

const mapped = { guid:'9', username:'target', nickname:null, email:null, group:'team', planType:'professional', role:'user', status:'active', authVersion:8, createdAt:'2026-09-08T00:00:00Z', lastLoginAt:null }

test('direct entitlement workflow singleflights and exposes conflicts without replay', async () => {
  let calls = 0; let resolve
  const workflow = createDirectEntitlementWorkflow({ execute: () => { calls++; return new Promise(r => { resolve = r }) } })
  const one = workflow.start({}); const two = workflow.start({})
  assert.equal(one, two); assert.equal(calls, 1)
  resolve(mapped); assert.equal((await one).state, 'succeeded')
  const conflict = createDirectEntitlementWorkflow({ execute: async () => { throw Object.assign(new Error(), { code:'auth_version_conflict' }) } })
  assert.equal((await conflict.start({})).state, 'conflict')
})

test('password reset queries commit unknown and clears all private input', async () => {
  let queryCalls = 0
  const workflow = createPasswordResetWorkflow({
    api: {
      issuePasswordReset: async () => ({ ticket:'av_ticket' }),
      executePasswordReset: async () => { throw { code:'operation_commit_unknown', operationRef:'op_ref' } },
      queryPasswordReset: async () => { queryCalls++; return { status:'succeeded', operationRef:'op_ref', targetGuid:'9', resultingAuthVersion:8 } },
    }, randomBytes: () => new Uint8Array(32), schedule: () => () => {},
  })
  const input = { targetGuid:'9', expectedAuthVersion:7, reason:'reset', newPassword:'Abcdef1!', currentPassword:'Owner1!!' }
  const result = await workflow.start(input)
  assert.equal(result.state, 'succeeded'); assert.equal(result.targetGuid,'9'); assert.equal(result.resultingAuthVersion,8); assert.equal(queryCalls, 1)
  assert.deepEqual(workflow.getPrivateSnapshot(), { newPassword:null, currentPassword:null, ticket:null, idempotencyKey:null })
})

test('pending recovery retains only the original key and permanently blocks a second run in the same instance', async()=>{
  const calls={issue:0,execute:0,query:0}
  const workflow=createPasswordResetWorkflow({api:{
    issuePasswordReset:async()=>{calls.issue++;return{ticket:'av_ticket'}},
    executePasswordReset:async()=>{calls.execute++;throw{code:'operation_commit_unknown',operationRef:'op_ref'}},
    queryPasswordReset:async()=>{calls.query++;return{status:'pending_recovery',operationRef:'op_ref'}},
  },randomBytes:()=>new Uint8Array(32),schedule:()=>()=>{}})
  const input={targetGuid:'9',expectedAuthVersion:7,reason:'reset',newPassword:'Abcdef1!',currentPassword:'Owner1!!'}
  assert.equal((await workflow.start(input)).state,'pending_recovery')
  assert.equal(workflow.reset(),false)
  assert.equal((await workflow.start(input)).state,'pending_recovery')
  assert.deepEqual(calls,{issue:1,execute:1,query:1})
  assert.deepEqual(workflow.getPrivateSnapshot(),{newPassword:null,currentPassword:null,ticket:null,idempotencyKey:'ik_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'})
  workflow.dispose()
  assert.equal(workflow.getPrivateSnapshot().idempotencyKey,null)
})
