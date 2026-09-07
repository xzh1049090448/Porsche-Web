import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { compileScript, compileTemplate, parse as parseSFC } from '@vue/compiler-sfc'
import { parse as parseTemplate } from '@vue/compiler-dom'
import { parse as parseScript } from '@babel/parser'
import { createPinia } from 'pinia'
import { createRenderer, defineComponent, h, nextTick, ref, watch } from 'vue'
import { messages } from '../../i18n/messages.js'
import { restoreAdminUserCreateTriggerFocus, useAdminUserCreateStore } from '../../stores/admin-user-create.js'

const dialogSource = await readFile(new URL('./UserCreateDialog.vue', import.meta.url), 'utf8')
const usersSource = await readFile(new URL('../../views/Users.vue', import.meta.url), 'utf8')
const dialogDescriptor = parseSFC(dialogSource, { filename: 'UserCreateDialog.vue' }).descriptor
const usersDescriptor = parseSFC(usersSource, { filename: 'Users.vue' }).descriptor
const dialogTemplate = parseTemplate(dialogDescriptor.template.content)
const usersTemplate = parseTemplate(usersDescriptor.template.content)
const dialogScript = parseScript(dialogDescriptor.scriptSetup.content, { sourceType: 'module' })
const usersScript = parseScript(usersDescriptor.scriptSetup.content, { sourceType: 'module' })

async function loadDialogComponent() {
  const compiledScript = compileScript(dialogDescriptor, { id: 'user-create-mount', genDefaultAs: '__sfc__' })
  const compiledTemplate = compileTemplate({
    id: 'user-create-mount',
    filename: 'UserCreateDialog.vue',
    source: dialogDescriptor.template.content,
    compilerOptions: { bindingMetadata: compiledScript.bindings },
  })
  assert.deepEqual(compiledTemplate.errors, [])
  const i18nStub = `data:text/javascript;base64,${Buffer.from("export function useI18n() { return { t: key => key } }").toString('base64')}`
  const replacements = new Map([
    ['vue', new URL('../../../node_modules/vue/index.mjs', import.meta.url).href],
    ['@/stores/admin-user-create', new URL('../../stores/admin-user-create.js', import.meta.url).href],
    ['@/composables/useI18n', i18nStub],
  ])
  let code = `${compiledScript.content}\n${compiledTemplate.code}\n__sfc__.render = render\nexport default __sfc__`
  for (const [specifier, replacement] of replacements) {
    code = code.replaceAll(`from '${specifier}'`, `from '${replacement}'`).replaceAll(`from \"${specifier}\"`, `from \"${replacement}\"`)
  }
  return (await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)).default
}

function mountRenderer() {
  let activeElement = null
  const markConnected = (node, connected) => {
    node.isConnected = connected
    node.children?.forEach(child => markConnected(child, connected))
  }
  const host = {
    patchProp(node, key, _previous, value) { node.props[key] = value },
    insert(node, parent, anchor) {
      node.parent = parent
      const index = anchor ? parent.children.indexOf(anchor) : -1
      if (index < 0) parent.children.push(node)
      else parent.children.splice(index, 0, node)
      markConnected(node, parent.isConnected)
    },
    remove(node) {
      const index = node.parent?.children.indexOf(node) ?? -1
      if (index >= 0) node.parent.children.splice(index, 1)
      markConnected(node, false)
      node.parent = null
    },
    createElement(type) {
      const node = { type, props: {}, children: [], parent: null, text: '', isConnected: false }
      node.focus = () => { activeElement = node }
      return node
    },
    createText(text) { return { type: '#text', props: {}, children: [], parent: null, text, isConnected: false } },
    createComment(text) { return { type: '#comment', props: {}, children: [], parent: null, text, isConnected: false } },
    setText(node, text) { node.text = text },
    setElementText(node, text) { node.text = text; node.children = [] },
    parentNode: node => node.parent,
    nextSibling(node) { const siblings = node.parent?.children ?? []; return siblings[siblings.indexOf(node) + 1] ?? null },
    querySelector: () => null,
    setScopeId() {},
    cloneNode: node => ({ ...node, props: { ...node.props }, children: [...node.children] }),
    insertStaticContent(content, parent, anchor) {
      const node = host.createText(content)
      host.insert(node, parent, anchor)
      return [node, node]
    },
  }
  const root = { type: 'root', props: {}, children: [], parent: null, text: '', isConnected: true }
  const visit = (node, match) => match(node) ? node : node.children?.map(child => visit(child, match)).find(Boolean)
  const collect = (node, match, values = []) => {
    if (match(node)) values.push(node)
    node.children?.forEach(child => collect(child, match, values))
    return values
  }
  return { renderer: createRenderer(host), root, find: match => visit(root, match), findAll: match => collect(root, match), active: () => activeElement }
}

const Passthrough = defineComponent({
  inheritAttrs: false,
  setup(_props, { attrs, expose, slots }) {
    expose({ clearValidate() {}, scrollToField() {}, validate: async () => true })
    return () => h('div', attrs, slots.default?.())
  },
})
const InputStub = defineComponent({
  inheritAttrs: false,
  props: { modelValue: { default: '' } },
  setup(props, { attrs, expose }) {
    const input = ref(null)
    expose({ input, focus: () => input.value?.focus?.() })
    return () => h('input', { ...attrs, ref: input, value: props.modelValue })
  },
})
const ButtonStub = defineComponent({
  inheritAttrs: false,
  setup(_props, { attrs, slots }) { return () => h('button', attrs, slots.default?.()) },
})
const DialogStub = defineComponent({
  props: { modelValue: Boolean },
  emits: ['open', 'close', 'closed', 'keydown'],
  setup(props, { emit, slots }) {
    watch(() => props.modelValue, (open, wasOpen) => {
      if (open && !wasOpen) nextTick(() => emit('open'))
      if (!open && wasOpen) nextTick(() => emit('closed'))
    })
    return () => props.modelValue ? h('dialog', { 'data-model-value': props.modelValue }, [slots.default?.(), slots.footer?.()]) : null
  },
})

async function flushView() {
  for (let step = 0; step < 5; step++) await nextTick()
}

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
  assert.equal(directive(dialog, 'on', 'open-auto-focus').exp.content, 'focusUsername')
  assert.equal(directive(dialog, 'on', 'close').exp.content, 'requestClose')
  assert.equal(directive(dialog, 'on', 'closed').exp.content, 'onClosed')
  assert.equal(directive(dialog, 'on', 'keydown').modifiers[0].content, 'esc')
  assert.equal(scriptCalls(dialogScript, 'onBeforeUnmount'), true)
})

test('form has password confirmation and conditional administrator verification without money or token inputs', () => {
  const form = element(dialogElements, 'el-form')
  const submitButton = element(dialogElements, 'el-button', node => attribute(node, 'native-type')?.value?.content === 'submit')
  assert.equal(attribute(form, 'id').value.content, 'admin-user-create-form')
  assert.equal(attribute(submitButton, 'native-type').value.content, 'submit')
  assert.equal(attribute(submitButton, 'form').value.content, 'admin-user-create-form')
  assert.equal(directive(submitButton, 'on', 'click'), undefined)
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
  assert.equal(scriptCalls(usersScript, 'reconcileAdminUserCreateConflict'), true)
  assert.equal(scriptCalls(usersScript, 'restoreAdminUserCreateTriggerFocus'), true)
})

test('Users sends permission revisions and permission failures through one synchronous fail-closed refresh', () => {
  assert.match(usersDescriptor.scriptSetup.content, /refreshCreateAuthorization\('permission_revision'/)
  assert.match(usersDescriptor.scriptSetup.content, /watch\(\(\) => userStore\.permissionRevision,[\s\S]*flush:\s*'sync'/)
  assert.match(usersDescriptor.scriptSetup.content, /refreshIdentity:\s*refreshCreateIdentity/)
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

test('mounted dialog opens visibly with username focus and restores the trigger after close and success', async () => {
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document')
  const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  let app = null
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { documentElement: {}, title: '', activeElement: null } })
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => null, setItem() {}, removeItem() {} } })
  try {
    const Dialog = await loadDialogComponent()
    const mounted = mountRenderer()
    let token = null
    let trigger = null
    let store = null
    const Harness = defineComponent({
      setup() {
        store = useAdminUserCreateStore()
        return () => h('main', [
          h('button', {
            id: 'create-entry',
            onClick(event) {
              trigger = event.currentTarget
              token = store.openDialog({ actorRole: 'admin', capabilities: ['users.create'] })
            },
          }, 'open'),
          h(Dialog, {
            onClosed() {
              restoreAdminUserCreateTriggerFocus({
                token,
                canRestore: owner => token === owner && !store.captureOwnership(),
                trigger,
                fallback: null,
                nextTick,
              })
            },
          }),
        ])
      },
    })
    const pinia = createPinia()
    app = mounted.renderer.createApp(Harness)
    app.use(pinia)
    for (const [name, component] of Object.entries({
      'el-dialog': DialogStub,
      'el-form': Passthrough,
      'el-form-item': Passthrough,
      'el-input': InputStub,
      'el-select': Passthrough,
      'el-option': Passthrough,
      'el-alert': Passthrough,
      'el-skeleton': Passthrough,
      'el-button': ButtonStub,
    })) app.component(name, component)
    app.mount(mounted.root)
    await flushView()

    const entry = mounted.find(node => node.props?.id === 'create-entry')
    assert.ok(entry)
    entry.props.onClick({ currentTarget: entry })
    await flushView()
    assert.equal(store.isOpen, true)
    assert.equal(mounted.find(node => node.type === 'dialog')?.props['data-model-value'], true)
    assert.equal(mounted.active()?.type, 'input')

    const buttons = mounted.findAll(node => node.type === 'button')
    assert.equal(buttons.length >= 3, true)
    buttons.at(-2).props.onClick()
    await flushView()
    assert.equal(store.isOpen, false)
    assert.equal(mounted.active(), entry)

    entry.props.onClick({ currentTarget: entry })
    await flushView()
    store.submit = async owner => ({ state: store.owns(owner) ? 'succeeded' : 'failed', createdUser: null })
    mounted.find(node => node.props.id === 'admin-user-create-form').props.onSubmit({ preventDefault() {} })
    await flushView()
    assert.equal(store.isOpen, false)
    assert.equal(mounted.active(), entry)
  } finally {
    app?.unmount()
    if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument)
    else delete globalThis.document
    if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage)
    else delete globalThis.localStorage
  }
})
