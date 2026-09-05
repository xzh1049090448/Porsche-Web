import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const users = await readFile(new URL('./Users.vue', import.meta.url), 'utf8')
const detail = await readFile(new URL('./UserDetail.vue', import.meta.url), 'utf8')

test('list and detail gates render only the users.delete action', () => {
  for (const source of [users, detail]) {
    assert.match(source, /canDeleteAdminUser/)
    assert.match(source, /users\.delete/)
    assert.match(source, /UserSoftDeleteDialog/)
    assert.doesNotMatch(source, /create_admin|reset_password|promote|demote|permissions_write|public_content\.(?:publish|rollback)/)
  }
})

test('list success removes the row, falls back from an empty last page, and preserves filter and sort inputs', () => {
  assert.match(users, /onDeleteSucceeded/)
  assert.match(users, /filters\.page > 1/)
  assert.match(users, /filters\.page--/)
  assert.match(users, /store\.rows\.filter/)
  assert.doesNotMatch(users, /filters\s*=\s*reactive\([^)]*onDeleteSucceeded/s)
})

test('detail success becomes a deleted read-only projection', () => {
  assert.match(detail, /onDeleteSucceeded/)
  assert.match(detail, /status:\s*'deleted'/)
  assert.match(detail, /canDeleteTarget/)
})

test('views refresh target on conflict, reset authentication on 401, close on unmount, and restore trigger focus', () => {
  for (const source of [users, detail]) {
    assert.match(source, /onDeleteConflict/)
    assert.match(source, /clearSession/)
    assert.match(source, /onBeforeUnmount/)
    assert.match(source, /restoreDeleteFocus/)
  }
})

test('ambiguous and querying states do not reconcile list or detail eagerly', () => {
  for (const source of [users, detail]) {
    const handler = source.match(/(?:async\s+)?function onDeleteSucceeded[\s\S]*?\n}/)?.[0] || ''
    assert.doesNotMatch(handler, /unknown|querying/)
  }
})
