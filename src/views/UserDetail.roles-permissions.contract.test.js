import assert from 'node:assert/strict'
import test, { after } from 'node:test'
import { createServer } from 'vite'

const vite = await createServer({ root: new URL('../../', import.meta.url).pathname, logLevel: 'silent', server: { middlewareMode: true }, appType: 'custom' })
after(() => vite.close())
const view = await vite.ssrLoadModule('/src/views/UserDetail.vue')
const adminUsers = await import('../api/admin-users.js')

const target = Object.freeze({ guid: '9', role: 'user', status: 'active', authVersion: 7 })
const eligibility = overrides => ({
  actorRole: 'root', actorGuid: '2', capabilities: ['users.promote', 'users.demote', 'users.permissions.write'],
  routeGuid: '9', target, ...overrides,
})

test('A08 eligibility is Root, exact-capability, route, target and self fail closed', () => {
  assert.equal(view.canOpenPromote(eligibility()), true)
  assert.equal(view.canOpenPromote(eligibility({ actorRole: 'admin' })), false)
  assert.equal(view.canOpenPromote(eligibility({ actorGuid: '9' })), false)
  assert.equal(view.canOpenPromote(eligibility({ routeGuid: '10' })), false)
  assert.equal(view.canOpenPromote(eligibility({ capabilities: [] })), false)
  assert.equal(view.canOpenPromote(eligibility({ target: { ...target, status: 'deleted' } })), false)
  assert.equal(view.canOpenPromote(eligibility({ target: { ...target, role: 'root' } })), false)
  const admin = { ...target, role: 'admin' }
  assert.equal(view.canOpenPermissions(eligibility({ target: admin })), true)
  assert.equal(view.canOpenDemote(eligibility({ target: admin })), true)
  assert.equal(view.canOpenPermissions(eligibility({ target })), false)
  assert.equal(view.canOpenDemote(eligibility({ target })), false)
})

test('trusted success reconciles only exact stable result and fresh detail/policy', () => {
  const state = { selected: target, rows: [target], permissions: null }
  const context = { targetGuid: '9', targetRole: 'user', authVersion: 7, permissionsVersion: 0, resultingRole: 'admin' }
  const result = { targetGuid: '9', resultingRole: 'admin', resultingAuthVersion: 8, resultingPermissionsVersion: 1 }
  const fresh = { target: { ...target, role: 'admin', authVersion: 8 }, permissions: { user_guid: '9', role: 'admin', permissions_version: '1' } }
  assert.equal(view.reconcileRolePermissionSuccess({ state, context, result, fresh, isCurrent: () => true }), true)
  assert.equal(state.selected.role, 'admin')
  for (const mutation of [
    { result: { ...result, targetGuid: '10' } },
    { result: { ...result, resultingAuthVersion: 9 } },
    { fresh: { ...fresh, permissions: { ...fresh.permissions, permissions_version: '2' } } },
    { isCurrent: () => false },
  ]) {
    const next = { selected: target, rows: [target], permissions: null }
    assert.equal(view.reconcileRolePermissionSuccess({ state: next, context, result, fresh, isCurrent: () => true, ...mutation }), false)
    assert.equal(next.selected, target)
  }
})

test('fresh snapshot reader performs one detail GET and only the applicable Admin permission GET', async () => {
  const calls=[]
  const read=adminUsers.createAdminUserRolePermissionSnapshotReader({
    detail:async(guid,options)=>{calls.push(['detail',guid,options]);return{guid,role:guid==='9'?'user':'admin'}},
    permissions:async(guid,options)=>{calls.push(['permissions',guid,options]);return{user_guid:guid,role:'admin'}},
  })
  const signal={signal:true}
  assert.deepEqual(await read('9',signal),{target:{guid:'9',role:'user'},permissions:null})
  assert.deepEqual(await read('10',signal),{target:{guid:'10',role:'admin'},permissions:{user_guid:'10',role:'admin'}})
  assert.deepEqual(calls,[['detail','9',signal],['detail','10',signal],['permissions','10',signal]])
})

test('demotion reconciliation accepts only a fresh User with the stable incremented versions', () => {
  const admin={...target,role:'admin'}
  const state={selected:admin,rows:[admin],permissions:{user_guid:'9',role:'admin',permissions_version:'3'}}
  const context={targetGuid:'9',targetRole:'admin',authVersion:7,permissionsVersion:3,resultingRole:'user'}
  const result={targetGuid:'9',resultingRole:'user',resultingAuthVersion:8,resultingPermissionsVersion:4}
  assert.equal(view.reconcileRolePermissionSuccess({state,context,result,fresh:{target:{...target,authVersion:8},permissions:null},isCurrent:()=>true}),true)
  assert.equal(state.selected.role,'user');assert.equal(state.permissions,null)
})
