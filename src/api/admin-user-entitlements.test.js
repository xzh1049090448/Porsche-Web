import test from 'node:test'
import assert from 'node:assert/strict'
import { createAdminUserEntitlementsApi, mapAdminUserEntitlementError, normalizeGroupChangeRequest, normalizePlanChangeRequest, normalizePasswordResetRequest } from './admin-user-entitlements.js'

const user = { guid:'9', username:'target', nickname:null, email:null, group:'default', plan_type:'professional', role:'user', status:'active', auth_version:8, created_at:'2026-09-08T00:00:00Z', last_login_at:null }
const headers = new Headers({ 'Cache-Control':'no-store', 'X-Request-ID':'req-1' })

test('normalizes the three frozen A07 requests without trimming passwords', () => {
  assert.deepEqual(normalizeGroupChangeRequest({ targetGuid:'9', groupGuid:'12', reason:' move ', expectedAuthVersion:7 }), { targetGuid:'9', groupGuid:'12', reason:'move', expectedAuthVersion:7 })
  assert.deepEqual(normalizePlanChangeRequest({ targetGuid:'9', planType:'enterprise', reason:' grant ', expectedAuthVersion:7 }), { targetGuid:'9', planType:'enterprise', reason:'grant', expectedAuthVersion:7 })
  assert.deepEqual(normalizePasswordResetRequest({ targetGuid:'9', newPassword:' Abcdef1!', reason:' reset ', currentPassword:'Owner1!!', expectedAuthVersion:7 }), { targetGuid:'9', newPassword:' Abcdef1!', reason:'reset', currentPassword:'Owner1!!', expectedAuthVersion:7 })
  assert.throws(() => normalizePlanChangeRequest({ targetGuid:'9', planType:'pro', reason:'x', expectedAuthVersion:7 }))
  assert.throws(() => normalizePasswordResetRequest({ targetGuid:'9', newPassword:'password123', reason:'reset', currentPassword:'Owner1!!', expectedAuthVersion:7 }))
})

test('uses exact direct PATCH paths and validates the returned version delta', async () => {
  const calls = []
  const api = createAdminUserEntitlementsApi({
    patch: async (...args) => { calls.push(args); return { status:200, headers, data:user } },
    post: async () => assert.fail('unexpected post'), get: async () => assert.fail('unexpected get'),
  })
  const group = await api.changeGroup({ targetGuid:'9', groupGuid:'12', reason:'move', expectedAuthVersion:7 })
  const plan = await api.changePlan({ targetGuid:'9', planType:'professional', reason:'grant', expectedAuthVersion:7 })
  assert.equal(group.authVersion, 8); assert.equal(plan.authVersion, 8)
  assert.deepEqual(calls.map(call => call[0]), ['/admin/v2/users/9/group', '/admin/v2/users/9/plan'])
})

test('requires the exact v2 action and entitlement error envelopes',()=>{
  const direct=mapAdminUserEntitlementError({response:{status:409,headers,data:{error:{code:'user_plan_conflict',message:'请求无法完成',kind:'admin_user_entitlement_error',request_id:'req-1'}}}})
  assert.equal(direct.code,'user_plan_conflict')
  const wrongKind=mapAdminUserEntitlementError({response:{status:409,headers,data:{error:{code:'user_plan_conflict',message:'请求无法完成',type:'admin_action_error',request_id:'req-1'}}}})
  assert.equal(wrongKind.code,'request_failed')
  const wrongStatus=mapAdminUserEntitlementError({response:{status:403,headers,data:{error:{code:'user_plan_conflict',message:'请求无法完成',kind:'admin_user_entitlement_error',request_id:'req-1'}}}})
  assert.equal(wrongStatus.code,'request_failed')
  const actionBodyLimit=mapAdminUserEntitlementError({response:{status:413,headers,data:{error:{code:'request_body_too_large',message:'请求无法完成',type:'admin_action_error',request_id:'req-1'}}}})
  const directBodyLimit=mapAdminUserEntitlementError({response:{status:413,headers,data:{error:{code:'request_body_too_large',message:'请求无法完成',kind:'admin_user_entitlement_error',request_id:'req-1'}}}})
  assert.equal(actionBodyLimit.code,'request_body_too_large')
  assert.equal(directBodyLimit.code,'request_body_too_large')
})

test('runs the exact reset issue execute and query contract', async () => {
  const calls = []
  const api = createAdminUserEntitlementsApi({
    patch: async () => assert.fail('unexpected patch'),
    post: async (...args) => { calls.push(args); return calls.length === 1
      ? { status:201, headers, data:{ ticket:'av_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', expires_at:1790000300000 } }
      : { status:200, headers, data:{ operation_ref:'op_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', target_guid:'9', resulting_auth_version:8 } } },
    get: async (...args) => { calls.push(args); return { status:200, headers, data:{ operation_ref:'op_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', scope:'users.reset_password', status:'succeeded', finished_at:1790000000000, failure_code:null, target_guid:'9', resulting_auth_version:8 } } },
  })
  const input = { targetGuid:'9', newPassword:'Abcdef1!', reason:'reset', currentPassword:'Owner1!!', expectedAuthVersion:7 }
  const issued = await api.issuePasswordReset(input)
  const result = await api.executePasswordReset({ ...input, ticket:issued.ticket, idempotencyKey:'ik_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' })
  const queried = await api.queryPasswordReset({ idempotencyKey:'ik_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' })
  assert.equal(result.resultingAuthVersion, 8); assert.equal(queried.status, 'succeeded'); assert.equal(queried.targetGuid,'9')
  assert.equal(calls[0][0], '/admin/v2/action-verifications')
  assert.equal(calls[1][0], '/admin/v2/users/9/actions')
  assert.equal(calls[2][0], '/admin/v2/operations?scope=users.reset_password')
})

test('rejects weak execute passwords and unknown operation failure codes before exposing them', async () => {
  const api = createAdminUserEntitlementsApi({
    patch: async () => assert.fail('unexpected patch'),
    post: async () => assert.fail('weak password reached transport'),
    get: async () => ({ status:200, headers, data:{ operation_ref:'op_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', scope:'users.reset_password', status:'failed', finished_at:1790000000000, failure_code:'invented_failure', target_guid:null, resulting_auth_version:null } }),
  })
  await assert.rejects(() => api.executePasswordReset({ targetGuid:'9', newPassword:'password123', reason:'reset', expectedAuthVersion:7, ticket:'av_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', idempotencyKey:'ik_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' }), /invalid_admin_user_entitlement_request/)
  await assert.rejects(() => api.queryPasswordReset({ idempotencyKey:'ik_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' }), /invalid_admin_user_entitlement_response/)
})
