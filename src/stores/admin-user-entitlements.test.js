import test from 'node:test'
import assert from 'node:assert/strict'
import { canManageUserEntitlement, canOpenGroupChange, canOpenPasswordReset, canOpenPlanChange, createDirectEntitlementCoordinator } from './admin-user-entitlements.js'

const target = { guid:'9', username:'target', role:'user', status:'active', authVersion:7, group:'default', planType:'free' }
test('A07 predicates enforce capability hierarchy self and deleted boundaries', () => {
  assert.equal(canManageUserEntitlement({ actorRole:'admin', actorGuid:'2', target }), true)
  assert.equal(canManageUserEntitlement({ actorRole:'admin', actorGuid:'9', target }), false)
  assert.equal(canManageUserEntitlement({ actorRole:'admin', actorGuid:'2', target:{ ...target, role:'admin' } }), false)
  assert.equal(canOpenPasswordReset({ actorRole:'root', actorGuid:'2', capabilities:['users.reset_password'], target }), true)
  assert.equal(canOpenPlanChange({ actorRole:'root', actorGuid:'2', capabilities:['users.plan.change'], target }), true)
  assert.equal(canOpenGroupChange({ actorRole:'root', actorGuid:'2', capabilities:['users.group.change','groups.read'], target }), true)
  assert.equal(canOpenGroupChange({ actorRole:'root', actorGuid:'2', capabilities:['users.group.change'], target }), false)
  assert.equal(canOpenPasswordReset({ actorRole:'root', actorGuid:'2', capabilities:['users.reset_password'], target:{ ...target, status:'deleted' } }), false)
  assert.equal(canManageUserEntitlement({ actorRole:'root',actorGuid:'2',target:{...target,status:'paused'} }),false)
  assert.equal(canManageUserEntitlement({ actorRole:'root',actorGuid:'2',target:{...target,status:''} }),false)
  assert.equal(canManageUserEntitlement({ actorRole:'root',actorGuid:'2',target:{...target,status:'disabled'} }),true)
})

test('direct coordinator rejects stale owners and requires a new gesture after conflict refresh', async () => {
  let resolve
  const state = {}
  const coordinator = createDirectEntitlementCoordinator({ state, capability:'users.plan.change', canOpen:canOpenPlanChange,
    execute: () => new Promise(r => { resolve=r }) })
  const context={ actorRole:'root',actorGuid:'2',capabilities:['users.plan.change'],target,routeGuid:'9',identityEpoch:'e1',permissionVersion:1 }
  const token=coordinator.open(context)
  const running=coordinator.submit(token,{planType:'professional',reason:'grant'})
  assert.equal(coordinator.submit(token,{planType:'enterprise',reason:'other'}),running)
  coordinator.updateContext(token,{identityEpoch:'e2'})
  resolve({ ...target,planType:'professional',authVersion:8 })
  await running
  assert.equal(state.open,false)
})
