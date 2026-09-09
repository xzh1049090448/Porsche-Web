import assert from 'node:assert/strict'
import test, { after } from 'node:test'
import { readFile } from 'node:fs/promises'
import { parse } from '@vue/compiler-sfc'
import { createServer } from 'vite'

const names = ['UserPromoteDialog', 'UserDemoteDialog', 'UserPermissionsDialog']
const sources = new Map(await Promise.all(names.map(async name => [name, await readFile(new URL(`./${name}.vue`, import.meta.url), 'utf8')])))
const vite = await createServer({ root: new URL('../../../', import.meta.url).pathname, logLevel: 'silent', server: { middlewareMode: true }, appType: 'custom' })
after(() => vite.close())

test('all A08 dialogs use native forms, owned store submission, unified events, and secret cleanup', () => {
  const scopes = { UserPromoteDialog: 'users.promote', UserDemoteDialog: 'users.demote', UserPermissionsDialog: 'users.permissions.write' }
  for (const [name, source] of sources) {
    const descriptor = parse(source, { filename: `${name}.vue` }).descriptor
    assert.ok(descriptor.scriptSetup)
    assert.match(descriptor.template.content, /<el-form[^>]+@submit\.prevent="submit"/)
    assert.match(descriptor.template.content, /native-type="submit"/)
    assert.match(descriptor.template.content, /trap-focus/)
    assert.match(descriptor.scriptSetup.content, /useAdminUserRolePermissionsStore/)
    assert.match(descriptor.scriptSetup.content, /rolePermissionStore\.owns\(token\)/)
    assert.match(descriptor.scriptSetup.content, /rolePermissionStore\.submit\(token,\s*consumeInput\)/)
    assert.match(descriptor.scriptSetup.content, new RegExp(`rolePermissionStore\\.action\\s*===?\\s*['"]${scopes[name].replaceAll('.', '\\.')}`))
    assert.match(descriptor.scriptSetup.content, /onBeforeUnmount/)
    for (const event of ['succeeded', 'conflict', 'failed', 'closed']) assert.match(descriptor.scriptSetup.content, new RegExp(`['"]${event}['"]`))
    assert.doesNotMatch(source, /fetch\(|axios|adminActionPost|adminActionPatch|UserDetail/)
  }
})

test('promote defaults to baseline with an optional editor, permissions always edits, and demote has no overrides', () => {
  const promote = sources.get('UserPromoteDialog')
  const demote = sources.get('UserDemoteDialog')
  const permissions = sources.get('UserPermissionsDialog')
  assert.match(promote, /UserPermissionEditor/)
  assert.match(promote, /editorExpanded/)
  assert.match(promote, /overrides[^=]*= ref\(\[\]\)/)
  assert.match(permissions, /UserPermissionEditor/)
  assert.doesNotMatch(demote, /UserPermissionEditor|overrides/)
})

test('dialog normalizers trim code-point reasons, preserve passwords, and omit demote overrides', async () => {
  const promote = await vite.ssrLoadModule('/src/components/admin/UserPromoteDialog.vue')
  const demote = await vite.ssrLoadModule('/src/components/admin/UserDemoteDialog.vue')
  const permissions = await vite.ssrLoadModule('/src/components/admin/UserPermissionsDialog.vue')
  assert.deepEqual(promote.normalizePromoteDialogInput({ reason: '  😀 review  ', currentPassword: ' Root1!! ', overrides: [] }), {
    reason: '😀 review', currentPassword: ' Root1!! ', overrides: [],
  })
  assert.deepEqual(permissions.normalizePermissionsDialogInput({ reason: ' save ', currentPassword: 'Root1!!', overrides: [{ capability: 'users.read', effect: 'deny' }] }), {
    reason: 'save', currentPassword: 'Root1!!', overrides: [{ capability: 'users.read', effect: 'deny' }],
  })
  const demoteInput = demote.normalizeDemoteDialogInput({ reason: ' demote ', currentPassword: 'Root1!!' })
  assert.deepEqual(demoteInput, { reason: 'demote', currentPassword: 'Root1!!' })
  assert.equal(Object.hasOwn(demoteInput, 'overrides'), false)
  for (const normalize of [promote.normalizePromoteDialogInput, demote.normalizeDemoteDialogInput, permissions.normalizePermissionsDialogInput]) {
    assert.throws(() => normalize({ reason: '😀'.repeat(201), currentPassword: 'Root1!!', overrides: [] }))
    assert.throws(() => normalize({ reason: 'ok', currentPassword: '', overrides: [] }))
    assert.throws(() => normalize({ reason: '\uD800', currentPassword: 'Root1!!', overrides: [] }))
  }
})

test('dialogs include session invalidation and safe terminal-state messages', () => {
  for (const source of sources.values()) {
    assert.match(source, /会话/)
    assert.match(source, /pending_recovery/)
    assert.match(source, /结果待确认/)
    assert.match(source, /conflict/)
    assert.match(source, /failureMessage/)
  }
})
