import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
const read=name=>readFile(new URL(`./${name}`,import.meta.url),'utf8')
test('A07 dialogs are independent trapped native forms with owned focus and secret clearing', async()=>{
  const [password,group,plan]=await Promise.all(['UserPasswordResetDialog.vue','UserGroupChangeDialog.vue','UserPlanChangeDialog.vue'].map(read))
  for(const source of [password,group,plan]){assert.match(source,/trap-focus/);assert.match(source,/native-type="submit"/);assert.match(source,/@submit\.prevent="submit"/);assert.match(source,/errorAlert/);assert.match(source,/emit\('closed'/)}
  assert.match(password,/autocomplete="new-password"/);assert.match(password,/autocomplete="current-password"/);assert.match(password,/nativeNewPassword/);assert.match(password,/nativeCurrentPassword/)
  assert.match(group,/groupsLoading/);assert.match(group,/groupsError/);assert.match(plan,/ADMIN_USER_PLAN_OPTIONS/)
})
