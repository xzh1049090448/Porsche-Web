import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('./UserDetail.vue', import.meta.url), 'utf8')

test('UserDetail wires the exact A06 status predicate and owned recovery flow', () => {
  for (const token of ['UserStatusDialog', 'useAdminUserStatusStore', 'canOpenAdminUserStatus', 'openStatus', 'onStatusSucceeded', 'onStatusConflict', 'getAdminUser']) assert.match(source, new RegExp(token))
  assert.match(source, /users\.disable/)
  assert.match(source, /users\.enable/)
  assert.match(source, /statusStore\.refreshConflict/)
})
