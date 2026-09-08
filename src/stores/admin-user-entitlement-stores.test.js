import test from 'node:test'
import assert from 'node:assert/strict'
import { createGroupChangeCoordinator } from './admin-user-group-change.js'
import { createPlanChangeCoordinator } from './admin-user-plan-change.js'
import { createPasswordResetCoordinator } from './admin-user-password-reset.js'
import { useAdminUserGroupChangeStore } from './admin-user-group-change.js'
import { useAdminUserPlanChangeStore } from './admin-user-plan-change.js'
import { useAdminUserPasswordResetStore } from './admin-user-password-reset.js'
import { createPinia, setActivePinia } from 'pinia'

const target={guid:'9',username:'target',role:'user',status:'active',authVersion:7,group:'default',planType:'free'}
const context=capabilities=>({actorRole:'root',actorGuid:'2',capabilities,target,routeGuid:'9',identityEpoch:'e1',permissionVersion:1})
test('three A07 coordinators open only owned eligible contexts', () => {
  const group=createGroupChangeCoordinator({api:async()=>{},loadGroups:async()=>[]}); const gt=group.open(context(['users.group.change','groups.read'])); assert.ok(gt); assert.equal(group.owns(gt),true); group.close(gt)
  const plan=createPlanChangeCoordinator({api:async()=>{}}); const pt=plan.open(context(['users.plan.change'])); assert.ok(pt); plan.close(pt)
  const reset=createPasswordResetCoordinator({api:{issuePasswordReset:async()=>{},executePasswordReset:async()=>{},queryPasswordReset:async()=>{}},randomBytes:()=>new Uint8Array(32),schedule:()=>()=>{}}); const rt=reset.open(context(['users.reset_password'])); assert.ok(rt); reset.close(rt)
})

test('group directory retry stays owner-scoped and forwards abort options', async () => {
  const calls=[]
  const group=createGroupChangeCoordinator({api:async()=>{},loadGroups:async(_permissions,options)=>{calls.push(options);if(calls.length===1)throw new Error('unavailable');return[{guid:'12',key:'team',displayName:'Team'}]}})
  const token=group.open(context(['users.group.change','groups.read']))
  await new Promise(resolve=>setTimeout(resolve,0))
  assert.equal(group.state.groupsError,true)
  assert.equal(group.retryGroups(Object.freeze({wrong:true})),false)
  assert.equal(group.retryGroups(token),true)
  await new Promise(resolve=>setTimeout(resolve,0))
  assert.equal(group.state.groupsError,false)
  assert.equal(group.state.groups[0].guid,'12')
  assert.equal(calls.every(options=>options.signal instanceof AbortSignal),true)
})

test('all three setup stores retain a public visibility ref beside their open action', () => {
  setActivePinia(createPinia())
  for (const [store, capabilities] of [
    [useAdminUserPasswordResetStore(), ['users.reset_password']],
    [useAdminUserGroupChangeStore(), ['users.group.change','groups.read']],
    [useAdminUserPlanChangeStore(), ['users.plan.change']],
  ]) {
    assert.equal(typeof store.open, 'function')
    assert.equal(store.isOpen, false)
    const token=store.open(context(capabilities))
    assert.ok(token)
    assert.equal(store.isOpen, true)
    assert.equal(store.close(token), true)
    assert.equal(store.isOpen, false)
  }
})

test('password reset coordinator cannot issue execute or query again after pending recovery',async()=>{
  const calls={issue:0,execute:0,query:0}
  const reset=createPasswordResetCoordinator({api:{
    issuePasswordReset:async()=>{calls.issue++;return{ticket:'av_ticket'}},
    executePasswordReset:async()=>{calls.execute++;throw{code:'operation_commit_unknown',operationRef:'op_ref'}},
    queryPasswordReset:async()=>{calls.query++;return{status:'pending_recovery',operationRef:'op_ref'}},
  },randomBytes:()=>new Uint8Array(32),schedule:()=>()=>{}})
  const token=reset.open(context(['users.reset_password']))
  const input={reason:'reset',newPassword:'Abcdef1!',currentPassword:'Owner1!!'}
  assert.equal((await reset.submit(token,input)).state,'pending_recovery')
  assert.equal(reset.reset(token),false)
  assert.equal((await reset.submit(token,input)).state,'pending_recovery')
  assert.deepEqual(calls,{issue:1,execute:1,query:1})
})
