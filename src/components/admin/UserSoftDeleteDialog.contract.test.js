import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { parse as parseSFC } from '@vue/compiler-sfc'
import { parse as parseTemplate } from '@vue/compiler-dom'
import { parse as parseScript } from '@babel/parser'
import { messages } from '../../i18n/messages.js'
import { canSubmitUserDelete, focusDeleteError, isDeleteBusy, settleUserDeleteClosed, settleUserDeleteDialog } from '../../stores/admin-user-actions.js'

const source = await readFile(new URL('./UserSoftDeleteDialog.vue', import.meta.url), 'utf8')
const descriptor = parseSFC(source, { filename: 'UserSoftDeleteDialog.vue' }).descriptor
const template = parseTemplate(descriptor.template.content)
const script = parseScript(descriptor.scriptSetup.content, { sourceType: 'module' })

function walk(node, visit) {
  if (!node || typeof node !== 'object') return
  visit(node)
  for (const [key, value] of Object.entries(node)) {
    if (['loc', 'parent', 'tokens', 'comments'].includes(key)) continue
    if (Array.isArray(value)) value.forEach(item => walk(item, visit))
    else if (value && typeof value === 'object') walk(value, visit)
  }
}
const elements = []
walk(template, node => { if (node.type === 1) elements.push(node) })
const element = (tag, predicate = () => true) => elements.find(node => node.tag === tag && predicate(node))
const directive = (node, name, argument) => node?.props.find(prop => prop.type === 7 && prop.name === name && (argument == null || prop.arg?.content === argument))
const attribute = (node, name) => node?.props.find(prop => prop.type === 6 && prop.name === name)
const hasCall = (callee, memberName) => {
  let found = false
  walk(script, node => {
    if (node.type === 'CallExpression' && node.callee?.name === callee
      && (!memberName || node.arguments.some(arg => arg.type === 'MemberExpression' && arg.property?.name === memberName))) found = true
  })
  return found
}

test('compiled dialog AST enforces focus trap, Escape, controlled close, and terminal hooks', () => {
  const dialog = element('el-dialog')
  assert.ok(dialog)
  assert.ok(attribute(dialog, 'trap-focus'))
  assert.equal(directive(dialog, 'bind', 'close-on-press-escape').exp.content, 'true')
  assert.equal(directive(dialog, 'on', 'close').exp.content, 'requestClose')
  assert.equal(directive(dialog, 'on', 'closed').exp.content, 'onClosed')
  assert.equal(directive(dialog, 'on', 'keydown').modifiers[0].content, 'esc')
})

test('busy and submit helpers execute the closed state policy and are called by the component script', () => {
  for (const state of ['verifying', 'submitting', 'querying']) assert.equal(isDeleteBusy(state), true)
  for (const state of ['idle', 'failed', 'unknown', 'succeeded', 'pending_recovery']) assert.equal(isDeleteBusy(state), false)
  assert.equal(canSubmitUserDelete({ state: 'idle', target: { status: 'active' } }), true)
  assert.equal(canSubmitUserDelete({ state: 'querying', target: { status: 'active' } }), false)
  assert.equal(canSubmitUserDelete({ state: 'pending_recovery', target: { status: 'active' } }), false)
  assert.equal(canSubmitUserDelete({ state: 'unknown', target: { status: 'active' } }), false)
  assert.equal(canSubmitUserDelete({ state: 'succeeded', target: { status: 'active' } }), false)
  assert.equal(canSubmitUserDelete({ state: 'idle', target: { status: 'deleted' } }), false)
  assert.equal(hasCall('isDeleteBusy', 'state'), true)
  assert.equal(hasCall('canSubmitUserDelete'), true)
  const danger = element('el-button', node => attribute(node, 'type')?.value?.content === 'danger')
  assert.equal(directive(danger, 'bind', 'disabled').exp.content, '!canSubmit')
})

test('compiled field AST identifies the target and requires a non-revealing current password', () => {
  assert.equal(elements.filter(node => node.tag === 'el-descriptions-item').length, 2)
  const password = element('el-input', node => attribute(node, 'type')?.value?.content === 'password')
  assert.equal(attribute(password, 'autocomplete').value.content, 'current-password')
  assert.equal(attribute(password, 'show-password'), undefined)
  const textarea = element('el-input', node => attribute(node, 'type')?.value?.content === 'textarea')
  assert.equal(attribute(textarea, 'maxlength').value.content, '200')
})

test('error focus helper executes against the rendered alert and is called by the component', () => {
  const calls = []
  const focusable = { focus: () => calls.push('focus') }
  focusDeleteError({ errorAlert: { value: { $el: focusable } }, nextTick: callback => { calls.push('tick'); callback() } })
  assert.deepEqual(calls, ['tick', 'focus'])
  assert.equal(hasCall('focusDeleteError'), true)
})

test('late component settlement cannot close or focus a newer dialog', () => {
  const effects = []
  settleUserDeleteDialog({ token: 'old', result: { state: 'succeeded' }, owns: () => false, close: () => effects.push('close'), focusError: () => effects.push('focus') })
  assert.deepEqual(effects, [])
  settleUserDeleteDialog({ token: 'current', result: { state: 'succeeded' }, owns: token => token === 'current', close: token => effects.push(['close', token]), focusError: () => effects.push('focus') })
  assert.deepEqual(effects, [['close', 'current']])
  assert.equal(hasCall('settleUserDeleteDialog'), true)
})

test('a late closed event cannot clear or emit against a newer dialog', () => {
  const effects = []
  assert.equal(settleUserDeleteClosed({ currentToken: 'dialog-b', clearForm: () => effects.push('clear'), emitClosed: () => effects.push('emit') }), false)
  assert.deepEqual(effects, [])
  assert.equal(settleUserDeleteClosed({ currentToken: null, clearForm: () => effects.push('clear'), emitClosed: () => effects.push('emit') }), true)
  assert.deepEqual(effects, ['clear', 'emit'])
  assert.equal(hasCall('settleUserDeleteClosed'), true)
})

test('Chinese and English messages state irreversible soft-delete, username retention, credential invalidation, and recovery guidance', () => {
  assert.match(messages.zh.deleteUser.irreversible, /软删除.*不可恢复/)
  assert.match(messages.zh.deleteUser.usernameOccupied, /用户名.*占用/)
  assert.match(messages.zh.deleteUser.credentialsInvalidated, /会话.*令牌.*失效/)
  assert.match(messages.en.deleteUser.irreversible, /soft-delete.*cannot be restored/i)
  assert.match(messages.en.deleteUser.usernameOccupied, /username.*occupied/i)
  assert.match(messages.en.deleteUser.credentialsInvalidated, /sessions.*tokens.*invalidated/i)
  assert.match(messages.en.deleteUser.pendingRecovery, /contact an administrator/i)
})
