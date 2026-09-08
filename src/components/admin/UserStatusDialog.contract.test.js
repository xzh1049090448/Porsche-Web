import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('./UserStatusDialog.vue', import.meta.url), 'utf8').catch(() => '')

test('A06 dialog requires reason and second confirmation only for disable', () => {
  assert.match(source, /intendedStatus === 'disabled'/)
  assert.match(source, /form\.reason/)
  assert.match(source, /form\.confirmed/)
  assert.match(source, /normalizeAdminUserStatusRequest/)
  assert.match(source, /trap-focus/)
  assert.match(source, /close-on-click-modal="false"/)
})

test('A06 dialog clears reason and emits owned terminal events', () => {
  assert.match(source, /form\.reason = ''/)
  for (const event of ['closed', 'succeeded', 'conflict', 'failed']) assert.match(source, new RegExp(`'${event}'`))
  assert.doesNotMatch(source, /localStorage|sessionStorage|console\./)
})
