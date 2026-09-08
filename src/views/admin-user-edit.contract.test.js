import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { parse as parseSFC } from '@vue/compiler-sfc'
import { parse as parseTemplate } from '@vue/compiler-dom'
import { parse as parseScript } from '@babel/parser'
import { canOpenAdminUserEdit } from '../stores/admin-user-edit.js'

const source = await readFile(new URL('./UserDetail.vue', import.meta.url), 'utf8')
const descriptor = parseSFC(source, { filename: 'UserDetail.vue' }).descriptor
const template = parseTemplate(descriptor.template.content)
const setup = parseScript(descriptor.scriptSetup.content, { sourceType: 'module' })
function walk(node, visit) { if (!node || typeof node !== 'object') return; visit(node); for (const [key, value] of Object.entries(node)) { if (key === 'loc') continue; if (Array.isArray(value)) value.forEach(item => walk(item, visit)); else if (value && typeof value === 'object') walk(value, visit) } }
const elements = []; walk(template, node => { if (node.type === 1) elements.push(node) })
const calls = name => { const found = []; walk(setup, node => { if (node.type === 'CallExpression' && node.callee?.name === name) found.push(node) }); return found }
const directive = (node, name, argument) => node?.props.find(prop => prop.type === 7 && prop.name === name && (argument == null || prop.arg?.content === argument))
async function helpers() {
  assert.ok(descriptor.script?.content, 'UserDetail must expose pure reconciliation helpers')
  return import(`data:text/javascript;base64,${Buffer.from(descriptor.script.content).toString('base64')}`)
}

test('detail exposes edit only through the exact manageable-target predicate', () => {
  const button = elements.find(node => node.tag === 'el-button' && directive(node, 'on', 'click')?.exp?.content?.includes('openEdit'))
  assert.ok(button); assert.equal(directive(button, 'if')?.exp?.content, 'canEditTarget')
  const base = { actorRole: 'admin', actorGuid: '2', capabilities: ['users.edit'], target: { guid: '3', role: 'user', status: 'active', authVersion: 7 } }
  assert.equal(canOpenAdminUserEdit(base), true)
  for (const next of [{ capabilities: [] }, { actorGuid: '3' }, { target: { ...base.target, role: 'admin' } }, { target: { ...base.target, status: 'deleted' } }, { target: { ...base.target, authVersion: 0 } }]) assert.equal(canOpenAdminUserEdit({ ...base, ...next }), false)
})

test('success reconciliation updates only the owned detail and matching cached row', async () => {
  const { reconcileAdminUserEditSuccess } = await helpers()
  const old = { guid: '3', nickname: 'Old', authVersion: 7 }; const other = { guid: '4', nickname: 'Other', authVersion: 2 }; const fresh = { ...old, nickname: 'New' }
  const state = { selected: old, rows: [other, old] }
  assert.equal(reconcileAdminUserEditSuccess({ state, user: fresh, targetGuid: '3', expectedAuthVersion: 7, isCurrent: () => true }), true)
  assert.equal(state.selected, fresh); assert.deepEqual(state.rows, [other, fresh])
  const stale = { selected: old, rows: [old] }
  assert.equal(reconcileAdminUserEditSuccess({ state: stale, user: fresh, targetGuid: '3', expectedAuthVersion: 7, isCurrent: () => false }), false)
  assert.equal(stale.selected, old)
})

test('view wires owned success, one conflict refresh, failure handling, focus restoration, and the Task5 store', () => {
  assert.ok(elements.some(node => node.tag === 'UserNicknameEditDialog'))
  for (const name of ['useAdminUserEditStore', 'canOpenAdminUserEdit', 'reconcileAdminUserEditSuccess', 'getAdminUser']) assert.ok(calls(name).length, `missing ${name}`)
  for (const name of ['onEditSucceeded', 'onEditConflict', 'onEditFailed', 'restoreEditFocus']) assert.match(descriptor.scriptSetup.content, new RegExp(name))
  assert.match(descriptor.scriptSetup.content, /failureCode === 'authentication_failed'|code === 'authentication_failed'/)
  assert.match(descriptor.scriptSetup.content, /\['forbidden', 'not_found'\]/)
  assert.match(descriptor.scriptSetup.content, /editConflictPromise/)
  assert.match(descriptor.scriptSetup.content, /editStore\.owns\(editToken\.value\)/)
  assert.match(descriptor.scriptSetup.content, /userStore\.identityEpoch/)
  assert.match(descriptor.template.content, /aria-live="polite"/)
  assert.doesNotMatch(source, /adminActionPost|\/admin\/users\//)
})
