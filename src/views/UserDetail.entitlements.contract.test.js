import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
const source=await readFile(new URL('./UserDetail.vue',import.meta.url),'utf8')
test('UserDetail exposes three capability-gated mutually exclusive A07 dialogs',()=>{
  for(const name of ['UserPasswordResetDialog','UserGroupChangeDialog','UserPlanChangeDialog'])assert.match(source,new RegExp(name))
  for(const predicate of ['canOpenPasswordReset','canOpenGroupChange','canOpenPlanChange'])assert.match(source,new RegExp(predicate))
  for(const opener of ['openPasswordReset','openGroupChange','openPlanChange'])assert.match(source,new RegExp(opener))
  assert.match(source,/closeEntitlementInteractions/)
})
test('UserDetail reconciles reset stable results through one owned GET and handles authentication failure',()=>{
  assert.match(source,/resultingAuthVersion/);assert.match(source,/getAdminUser/);assert.match(source,/authentication_failed/);assert.match(source,/refreshEntitlementConflict/)
})
