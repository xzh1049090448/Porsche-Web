import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { parse as parseSFC } from '@vue/compiler-sfc'
import { parse as parseTemplate } from '@vue/compiler-dom'
import { parse as parseScript } from '@babel/parser'
import { messages } from '../../i18n/messages.js'

const dialogSource = await readFile(new URL('./UserCreateDialog.vue', import.meta.url), 'utf8')
const usersSource = await readFile(new URL('../../views/Users.vue', import.meta.url), 'utf8')
const dialogDescriptor = parseSFC(dialogSource, { filename: 'UserCreateDialog.vue' }).descriptor
const usersDescriptor = parseSFC(usersSource, { filename: 'Users.vue' }).descriptor
const dialogTemplate = parseTemplate(dialogDescriptor.template.content)
const usersTemplate = parseTemplate(usersDescriptor.template.content)
const dialogScript = parseScript(dialogDescriptor.scriptSetup.content, { sourceType: 'module' })
const usersScript = parseScript(usersDescriptor.scriptSetup.content, { sourceType: 'module' })

function walk(node, visit) {
  if (!node || typeof node !== 'object') return
  visit(node)
  for (const [key, value] of Object.entries(node)) {
    if (['loc', 'parent', 'tokens', 'comments'].includes(key)) continue
    if (Array.isArray(value)) value.forEach(item => walk(item, visit))
    else if (value && typeof value === 'object') walk(value, visit)
  }
}
const collectElements = ast => { const items = []; walk(ast, node => { if (node.type === 1) items.push(node) }); return items }
const dialogElements = collectElements(dialogTemplate)
const usersElements = collectElements(usersTemplate)
const attribute = (node, name) => node?.props.find(prop => prop.type === 6 && prop.name === name)
const directive = (node, name, argument) => node?.props.find(prop => prop.type === 7 && prop.name === name && (argument == null || prop.arg?.content === argument))
const element = (items, tag, predicate = () => true) => items.find(node => node.tag === tag && predicate(node))
const scriptCalls = (ast, name) => { let found = false; walk(ast, node => { if (node.type === 'CallExpression' && (node.callee?.name === name || node.callee?.property?.name === name)) found = true }); return found }

test('dialog is controlled, traps focus, handles Escape, and exposes lifecycle hooks', () => {
  const dialog = element(dialogElements, 'el-dialog')
  assert.ok(dialog)
  assert.ok(attribute(dialog, 'trap-focus'))
  assert.equal(directive(dialog, 'bind', 'close-on-click-modal').exp.content, 'false')
  assert.equal(directive(dialog, 'on', 'close').exp.content, 'requestClose')
  assert.equal(directive(dialog, 'on', 'closed').exp.content, 'onClosed')
  assert.equal(directive(dialog, 'on', 'keydown').modifiers[0].content, 'esc')
  assert.equal(scriptCalls(dialogScript, 'onBeforeUnmount'), true)
})

test('form has password confirmation and conditional administrator verification without money or token inputs', () => {
  const modelBindings = dialogElements.flatMap(node => node.props)
    .filter(prop => prop.type === 7 && prop.name === 'model').map(prop => prop.exp?.content)
  for (const field of ['form.username', 'form.nickname', 'form.password', 'form.confirmPassword', 'form.role', 'form.groupGuid', 'form.planType', 'form.currentPassword']) {
    assert.ok(modelBindings.includes(field), `missing ${field}`)
  }
  assert.equal(dialogDescriptor.template.content.match(/type="password"/g)?.length, 3)
  assert.doesNotMatch(dialogDescriptor.template.content, /amount|balance|quota|token|金额|余额|额度/i)
  assert.match(dialogDescriptor.template.content, /form\.role === 'admin'/)
  assert.equal(scriptCalls(dialogScript, 'buildAdminPermissionOverrides'), true)
  assert.equal(scriptCalls(dialogScript, 'clearAdminUserCreateSecrets'), true)
})

test('permission editor is tri-state and only rendered for administrator creation', () => {
  assert.match(dialogDescriptor.template.content, /permissionRows/)
  assert.match(dialogDescriptor.template.content, /inherit/)
  assert.match(dialogDescriptor.template.content, /allow/)
  assert.match(dialogDescriptor.template.content, /deny/)
  const conditionalAdmin = dialogElements.find(node => directive(node, 'if')?.exp?.content === "form.role === 'admin'")
  assert.ok(conditionalAdmin)
})

test('Users exposes create only through users.create, owns restore focus, and announces success accessibly', () => {
  const createButton = element(usersElements, 'el-button', node => directive(node, 'on', 'click')?.exp?.content?.includes('openCreate'))
  assert.ok(createButton)
  assert.equal(directive(createButton, 'if').exp.content, 'canCreate')
  assert.match(usersDescriptor.scriptSetup.content, /permissionProjection\?\.capabilities\?\.includes\('users\.create'\) === true/)
  assert.ok(element(usersElements, 'UserCreateDialog'))
  const live = usersElements.find(node => attribute(node, 'aria-live')?.value?.content === 'polite')
  assert.ok(live)
  assert.equal(scriptCalls(usersScript, 'reconcileCreatedAdminUser'), true)
  assert.equal(scriptCalls(usersScript, 'restoreAdminUserCreateTriggerFocus'), true)
})

test('localized announcements distinguish known created identity from recovered success', () => {
  for (const locale of ['zh', 'en']) {
    assert.equal(typeof messages[locale].createUser.successKnown, 'string')
    assert.match(messages[locale].createUser.successKnown, /\{username\}/)
    assert.match(messages[locale].createUser.successKnown, /\{guid\}/)
    assert.equal(typeof messages[locale].createUser.successRecovered, 'string')
    assert.doesNotMatch(messages[locale].createUser.successRecovered, /\{username\}|\{guid\}/)
  }
})
