import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { parse as parseSFC } from '@vue/compiler-sfc'
import { parse as parseTemplate } from '@vue/compiler-dom'
import { parse as parseScript } from '@babel/parser'
import { messages } from '../../i18n/messages.js'
import { canSubmitUserDelete, clearUserDeleteConfirmationForm, focusDeleteError, focusDeleteValidation, isDeleteBusy, settleUserDeleteClosed, settleUserDeleteDialog } from '../../stores/admin-user-actions.js'

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
  assert.equal(attribute(password, 'autocomplete').value.content, 'off')
  assert.equal(attribute(password, 'show-password'), undefined)
  assert.equal(directive(password, 'model').exp.content, 'form.password')
  let readsPasswordFromStore = false
  walk(script, node => {
    if (node.type === 'MemberExpression' && node.object?.name === 'actionStore' && node.property?.name === 'password') readsPasswordFromStore = true
  })
  assert.equal(readsPasswordFromStore, false)
  const textarea = element('el-input', node => attribute(node, 'type')?.value?.content === 'textarea')
  assert.equal(attribute(textarea, 'maxlength').value.content, '200')
})

test('open, close, and remount clearing leaves model, native input, and private store password empty', () => {
  const storeWrites = []
  const nativePassword = { value: 'browser-managed-secret' }
  const form = { reason: 'reason', password: '' }
  const clearValidate = []
  const clear = () => clearUserDeleteConfirmationForm({
    form, passwordInput: { value: { input: nativePassword } },
    setReason: value => storeWrites.push(['reason', value]), setPassword: value => storeWrites.push(['password', value]),
    clearValidate: () => clearValidate.push(true),
  })
  clear()
  assert.deepEqual(form, { reason: '', password: '' })
  assert.equal(nativePassword.value, '')
  assert.deepEqual(storeWrites.slice(-2), [['reason', ''], ['password', '']])

  form.password = 'typed-secret'; nativePassword.value = 'typed-secret'
  clear()
  assert.equal(form.password, '')
  assert.equal(nativePassword.value, '')

  const remounted = { reason: '', password: '' }
  nativePassword.value = 'restored-secret'
  clearUserDeleteConfirmationForm({ form: remounted, passwordInput: { value: { input: nativePassword } }, setReason() {}, setPassword: value => storeWrites.push(['remount-password', value]), clearValidate() {} })
  assert.equal(remounted.password, '')
  assert.equal(nativePassword.value, '')
  assert.deepEqual(storeWrites.at(-1), ['remount-password', ''])
  assert.equal(hasCall('clearUserDeleteConfirmationForm'), true)
})

test('error and validation focus execute only while their dialog token still owns the next tick', () => {
  const calls = []
  const queued = []
  let owner = 'dialog-a'
  const focusable = { focus: () => calls.push('focus') }
  focusDeleteError({ token: 'dialog-a', owns: token => token === owner, errorAlert: { value: { $el: focusable } }, nextTick: callback => queued.push(callback) })
  focusDeleteValidation({ token: 'dialog-a', owns: token => token === owner, hasReason: false, reasonInput: { value: focusable }, passwordInput: { value: focusable }, nextTick: callback => queued.push(callback) })
  owner = 'dialog-b'
  queued.forEach(callback => callback())
  assert.deepEqual(calls, [])
  assert.equal(hasCall('focusDeleteError'), true)
  assert.equal(hasCall('focusDeleteValidation'), true)
})

test('a deferred validation rejection from A cannot schedule focus after B opens', async () => {
  let rejectValidation
  const validation = new Promise((resolve, reject) => { rejectValidation = reject })
  const calls = []
  let owner = 'dialog-a'
  async function rejectedLikeComponent() {
    try { await validation } catch {
      if (owner !== 'dialog-a') return
      focusDeleteValidation({ token: 'dialog-a', owns: token => token === owner, hasReason: false, reasonInput: { value: { focus: () => calls.push('focus') } }, passwordInput: {}, nextTick: callback => calls.push(callback) })
    }
  }
  const running = rejectedLikeComponent()
  owner = 'dialog-b'
  rejectValidation(new Error('invalid'))
  await running
  assert.deepEqual(calls, [])
  let guardedCatch = false
  walk(script, node => {
    if (node.type !== 'CatchClause') return
    let owns = false; let focus = false
    walk(node.body, child => {
      if (child.type === 'CallExpression' && child.callee?.type === 'MemberExpression' && child.callee.object?.name === 'actionStore' && child.callee.property?.name === 'owns') owns = true
      if (child.type === 'CallExpression' && child.callee?.name === 'focusDeleteValidation') focus = true
    })
    guardedCatch ||= owns && focus
  })
  assert.equal(guardedCatch, true)
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
