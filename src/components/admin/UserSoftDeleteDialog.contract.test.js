import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('./UserSoftDeleteDialog.vue', import.meta.url), 'utf8')
const messages = await readFile(new URL('../../i18n/messages.js', import.meta.url), 'utf8')

test('dialog uses accessible Element Plus focus and close behavior', () => {
  assert.match(source, /<el-dialog/)
  assert.match(source, /trap-focus/)
  assert.match(source, /@open=/)
  assert.match(source, /@close=/)
  assert.match(source, /@closed=/)
  assert.match(source, /@keydown\.esc=/)
  assert.match(source, /focusError/)
})

test('dialog identifies the target and requires reason and current password', () => {
  assert.match(source, /target\.username/)
  assert.match(source, /target\.guid/)
  assert.match(source, /autocomplete="current-password"/)
  assert.doesNotMatch(source, /show-password/)
  assert.match(source, /deleteUser\.reasonRequired/)
  assert.match(source, /deleteUser\.passwordRequired/)
})

test('busy states disable submit, while close remains available to cancel Query, and pending recovery has guidance', () => {
  for (const state of ['verifying', 'submitting', 'querying']) assert.match(source, new RegExp(`'${state}'`))
  assert.match(source, /:disabled="busy/)
  assert.match(source, /function requestClose\(\) \{ actionStore\.close\(\) \}/)
  assert.match(source, /pending_recovery/)
  assert.match(source, /deleteUser\.pendingRecovery/)
})

test('Chinese and English copy states soft-delete, irreversible, username retention, and credential invalidation', () => {
  for (const phrase of ['软删除', '不可恢复', '用户名', '会话', 'Soft-delete', 'cannot be restored', 'username', 'sessions']) assert.match(messages, new RegExp(phrase, 'i'))
})

test('component clears form values on close and never uses browser persistence or logging', () => {
  assert.match(source, /clearForm/)
  assert.doesNotMatch(source, /localStorage|sessionStorage|console\.(?:log|info|debug)|analytics/)
})
