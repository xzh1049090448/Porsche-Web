import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { parse as parseSFC } from '@vue/compiler-sfc'
import { parse as parseTemplate } from '@vue/compiler-dom'
import { parse as parseScript } from '@babel/parser'
import { messages } from '../../i18n/messages.js'

const source = await readFile(new URL('./UserNicknameEditDialog.vue', import.meta.url), 'utf8').catch(() => '<template></template><script setup></script>')
const descriptor = parseSFC(source, { filename: 'UserNicknameEditDialog.vue' }).descriptor
const template = parseTemplate(descriptor.template?.content || '')
const script = parseScript(descriptor.scriptSetup?.content || '', { sourceType: 'module' })

function walk(node, visit) {
  if (!node || typeof node !== 'object') return
  visit(node)
  for (const [key, value] of Object.entries(node)) {
    if (['loc', 'tokens', 'comments'].includes(key)) continue
    if (Array.isArray(value)) value.forEach(item => walk(item, visit))
    else if (value && typeof value === 'object') walk(value, visit)
  }
}
const elements = []
walk(template, node => { if (node.type === 1) elements.push(node) })
const element = tag => elements.find(node => node.tag === tag)
const directive = (node, name, argument) => node?.props.find(prop => prop.type === 7 && prop.name === name && (argument == null || prop.arg?.content === argument))
const attribute = (node, name) => node?.props.find(prop => prop.type === 6 && prop.name === name)
const scriptCalls = name => { const found = []; walk(script, node => { if (node.type === 'CallExpression' && node.callee?.name === name) found.push(node) }); return found }

test('compiled dialog is controlled, traps focus, handles Escape, and owns one nickname form', () => {
  const dialog = element('el-dialog')
  assert.ok(dialog)
  assert.equal(directive(dialog, 'bind', 'model-value')?.exp?.content, 'editStore.isOpen')
  assert.ok(attribute(dialog, 'trap-focus'))
  assert.equal(directive(dialog, 'bind', 'close-on-press-escape')?.exp?.content, 'true')
  assert.equal(directive(dialog, 'on', 'close')?.exp?.content, 'requestClose')
  assert.equal(directive(dialog, 'on', 'closed')?.exp?.content, 'onClosed')
  assert.equal(directive(dialog, 'on', 'keydown')?.modifiers?.[0]?.content, 'esc')
  assert.equal(elements.filter(node => node.tag === 'el-input').length, 1)
  assert.equal(directive(element('el-form'), 'on', 'submit')?.modifiers?.[0]?.content, 'prevent')
  assert.equal(attribute(element('el-form'), 'id')?.value?.content, 'admin-user-nickname-edit-form')
})

test('component delegates submission to the Task5 store and exposes owned terminal events', () => {
  assert.ok(scriptCalls('useAdminUserEditStore').length)
  assert.ok(scriptCalls('normalizeAdminUserEditRequest').length)
  for (const event of ['closed', 'succeeded', 'conflict', 'failed']) assert.match(descriptor.scriptSetup.content, new RegExp(`['\"]${event}['\"]`))
  assert.match(descriptor.scriptSetup.content, /editStore\.submit\(token/)
  assert.match(descriptor.scriptSetup.content, /editStore\.owns\(token\)/)
  assert.doesNotMatch(source, /localStorage|sessionStorage|console\.|adminActionPost|\/admin\/users/)
})

test('messages cover success, conflict, authentication, authorization, unavailable, and explicit retry', () => {
  for (const locale of ['zh', 'en']) {
    const edit = messages[locale].editUser
    assert.ok(edit)
    for (const key of ['title', 'nickname', 'clearHelp', 'cancel', 'submit', 'retry', 'success', 'conflictRefreshing']) assert.equal(typeof edit[key], 'string')
    for (const code of ['authentication_failed', 'forbidden', 'not_found', 'unavailable', 'request_failed']) assert.equal(typeof edit.failures[code], 'string')
  }
})
