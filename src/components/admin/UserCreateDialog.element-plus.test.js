import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc'
import { JSDOM } from 'jsdom'
import { createServer } from 'vite'

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://local.test/users', pretendToBeVisual: true })
const browserGlobals = [
  'window', 'document', 'navigator', 'Node', 'NodeFilter', 'Element', 'HTMLElement', 'HTMLInputElement', 'SVGElement',
  'Event', 'CustomEvent', 'KeyboardEvent', 'FocusEvent', 'MutationObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame',
]
for (const key of browserGlobals) {
  const value = ['getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame'].includes(key)
    ? dom.window[key].bind(dom.window)
    : dom.window[key]
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
}
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
globalThis.CSS ||= { supports: () => false }
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} }
globalThis.HTMLElement.prototype.scrollIntoView ||= function scrollIntoView() {}

const [{ mount }, { createPinia }, vue] = await Promise.all([
  import('@vue/test-utils'),
  import('pinia'),
  import('vue'),
])
const { defineComponent, h, nextTick } = vue
const vite = await createServer({
  root: new URL('../../../', import.meta.url).pathname,
  logLevel: 'silent',
  server: { middlewareMode: true },
  appType: 'custom',
  ssr: { noExternal: ['element-plus', 'async-validator'] },
})
after(() => vite.close())
const [{ default: ElementPlus }, focusTrap] = await Promise.all([
  vite.ssrLoadModule('element-plus'),
  vite.ssrLoadModule('/node_modules/element-plus/es/components/focus-trap/src/utils.mjs'),
])
const { restoreAdminUserCreateTriggerFocus, useAdminUserCreateStore } = await import('../../stores/admin-user-create.js')
const { getEdges, obtainAllFocusableElements } = focusTrap

async function loadDialogComponent() {
  const source = await readFile(new URL('./UserCreateDialog.vue', import.meta.url), 'utf8')
  const descriptor = parse(source, { filename: 'UserCreateDialog.vue' }).descriptor
  const script = compileScript(descriptor, { id: 'user-create-element-plus', genDefaultAs: '__sfc__' })
  const template = compileTemplate({
    id: 'user-create-element-plus',
    filename: 'UserCreateDialog.vue',
    source: descriptor.template.content,
    compilerOptions: { bindingMetadata: script.bindings },
  })
  assert.deepEqual(template.errors, [])
  const i18nStub = `data:text/javascript;base64,${Buffer.from("export function useI18n() { return { t: key => key } }").toString('base64')}`
  const replacements = new Map([
    ['vue', new URL('../../../node_modules/vue/index.mjs', import.meta.url).href],
    ['@/stores/admin-user-create', new URL('../../stores/admin-user-create.js', import.meta.url).href],
    ['@/composables/useI18n', i18nStub],
  ])
  let code = `${script.content}\n${template.code}\n__sfc__.render = render\nexport default __sfc__`
  for (const [specifier, replacement] of replacements) {
    code = code.replaceAll(`from '${specifier}'`, `from '${replacement}'`).replaceAll(`from \"${specifier}\"`, `from \"${replacement}\"`)
  }
  return (await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)).default
}

async function flushDialog() {
  for (let step = 0; step < 8; step++) await nextTick()
  await new Promise(resolve => setTimeout(resolve, 0))
  await nextTick()
}

async function mountDialogHarness() {
  const Dialog = await loadDialogComponent()
  const state = { wrapper: null, store: null, token: null, trigger: null, submitCalls: 0 }
  const Harness = defineComponent({
    setup() {
      state.store = useAdminUserCreateStore()
      return () => h('main', [
        h('button', {
          id: 'create-entry',
          onClick(event) {
            state.trigger = event.currentTarget
            state.token = state.store.openDialog({ actorRole: 'root', capabilities: ['users.create'] })
          },
        }, 'open'),
        h(Dialog, {
          onClosed() {
            restoreAdminUserCreateTriggerFocus({
              token: state.token,
              canRestore: owner => state.token === owner && !state.store.captureOwnership(),
              trigger: state.trigger,
              fallback: null,
              nextTick,
            })
          },
        }),
      ])
    },
  })
  state.wrapper = mount(Harness, {
    attachTo: document.body,
    global: { plugins: [createPinia(), ElementPlus] },
  })
  return state
}

async function openDialog(state) {
  const entry = state.wrapper.get('#create-entry')
  entry.element.focus()
  await entry.trigger('click')
  await flushDialog()
  return entry
}

test('real Element Plus dialog traps focus, closes on Escape, and restores focus', async () => {
  let state = null

  try {
    state = await mountDialogHarness()
    const entry = await openDialog(state)
    const dialog = state.wrapper.get('[role="dialog"]')
    const focusContainer = dialog.get('.el-dialog')
    const username = state.wrapper.get('input[maxlength="20"]')
    assert.equal(document.activeElement, username.element)

    const [firstControl, lastControl] = getEdges(focusContainer.element)
    const rawFocusables = obtainAllFocusableElements(focusContainer.element)
    assert.ok(firstControl, `real dialog focusables missing: raw=${rawFocusables.length}, buttons=${focusContainer.findAll('button').length}, inputs=${focusContainer.findAll('input').length}, firstTab=${focusContainer.element.querySelector('button')?.tabIndex}, sameDoc=${focusContainer.element.ownerDocument === document}, show=${NodeFilter.SHOW_ELEMENT}, display=${getComputedStyle(focusContainer.element).display}`)
    assert.ok(lastControl)
    lastControl.focus()
    lastControl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', code: 'Tab', bubbles: true, cancelable: true }))
    await flushDialog()
    assert.equal(focusContainer.element.contains(document.activeElement), true)
    assert.equal(document.activeElement, firstControl, 'Tab on the last control must loop within the real focus trap')

    document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }))
    await flushDialog()
    assert.equal(state.store.isOpen, false)
    assert.equal(document.activeElement, entry.element)
  } finally {
    state?.wrapper?.unmount()
    document.body.innerHTML = ''
  }
})

test('real Element Plus form focuses confirmation and actor-password errors before a keyboard-style native submit succeeds', async () => {
  let state = null

  try {
    state = await mountDialogHarness()
    const entry = await openDialog(state)
    state.store.role = 'admin'
    state.store.catalog = { capabilities: [] }
    state.store.submit = async owner => {
      state.submitCalls++
      return { state: state.store.owns(owner) ? 'succeeded' : 'failed', createdUser: null }
    }
    await flushDialog()
    const passwordInputs = state.wrapper.findAll('input[autocomplete="new-password"]')
    const confirmPassword = passwordInputs[1]
    const currentPassword = state.wrapper.get('input[autocomplete="current-password"]')
    const username = state.wrapper.get('input[maxlength="20"]')
    const form = state.wrapper.get('form')
    await username.setValue('alice')
    await passwordInputs[0].setValue('Str0ng!Pass')
    await confirmPassword.setValue('Different!Pass')
    username.element.focus()
    form.element.requestSubmit()
    await flushDialog()
    assert.equal(state.submitCalls, 0)
    assert.equal(document.activeElement, confirmPassword.element, `expected confirmation focus, got ${document.activeElement?.tagName}.${document.activeElement?.className}`)

    await confirmPassword.setValue('Str0ng!Pass')
    username.element.focus()
    form.element.requestSubmit()
    await flushDialog()
    assert.equal(document.activeElement, currentPassword.element, `expected actor-password focus, got ${document.activeElement?.tagName}.${document.activeElement?.className}`)
    assert.equal(state.submitCalls, 0)

    await currentPassword.setValue('Actor!Pass9')
    currentPassword.element.focus()
    currentPassword.element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }))
    form.element.requestSubmit()
    await flushDialog()
    assert.equal(state.submitCalls, 1)
    assert.equal(state.store.isOpen, false)
    assert.equal(document.activeElement, entry.element)
  } finally {
    state?.wrapper?.unmount()
    document.body.innerHTML = ''
  }
})

test('real mounted dialog clears secrets and restores focus when refreshed identity loses create authorization', async () => {
  let state = null

  try {
    state = await mountDialogHarness()
    const entry = await openDialog(state)
    state.store.role = 'admin'
    state.store.catalog = { capabilities: [] }
    await flushDialog()
    const passwordInputs = state.wrapper.findAll('input[autocomplete="new-password"]')
    const currentPassword = state.wrapper.get('input[autocomplete="current-password"]')
    await passwordInputs[0].setValue('Str0ng!Pass')
    await passwordInputs[1].setValue('Str0ng!Pass')
    await currentPassword.setValue('Actor!Pass9')

    let finishIdentity
    const refreshing = state.store.reauthorize(state.token, {
      refreshIdentity: () => new Promise(resolve => { finishIdentity = resolve }),
      currentContext: () => ({ actorRole: 'admin', capabilities: [] }),
    })
    await nextTick()
    assert.equal(state.store.authorizing, true)
    assert.deepEqual([...passwordInputs, currentPassword].map(input => input.element.value), ['', '', ''])
    finishIdentity()
    assert.equal(await refreshing, false)
    await flushDialog()
    assert.equal(state.store.isOpen, false)
    assert.equal(document.activeElement, entry.element)
  } finally {
    state?.wrapper?.unmount()
    document.body.innerHTML = ''
  }
})
