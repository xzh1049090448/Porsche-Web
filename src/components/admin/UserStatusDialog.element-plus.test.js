import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc'
import { JSDOM } from 'jsdom'
import { createServer } from 'vite'

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://local.test/users/123456789012345678', pretendToBeVisual: true })
for (const key of ['window', 'document', 'navigator', 'Node', 'NodeFilter', 'Element', 'HTMLElement', 'HTMLInputElement', 'SVGElement', 'Event', 'CustomEvent', 'KeyboardEvent', 'MouseEvent', 'FocusEvent', 'MutationObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame']) {
  const value = ['getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame'].includes(key) ? dom.window[key].bind(dom.window) : dom.window[key]
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
}
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
globalThis.CSS ||= { supports: () => false }
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} }
globalThis.HTMLElement.prototype.scrollIntoView ||= function scrollIntoView() {}

const [{ mount }, { createPinia }, vue] = await Promise.all([import('@vue/test-utils'), import('pinia'), import('vue')])
const { defineComponent, h, nextTick, ref } = vue
const vite = await createServer({ root: new URL('../../../', import.meta.url).pathname, logLevel: 'silent', server: { middlewareMode: true }, appType: 'custom', ssr: { noExternal: ['element-plus', 'async-validator'] } })
after(() => vite.close())
const [{ default: ElementPlus }, focusTrap] = await Promise.all([
  vite.ssrLoadModule('element-plus'),
  vite.ssrLoadModule('/node_modules/element-plus/es/components/focus-trap/src/utils.mjs'),
])
const { useAdminUserStatusStore } = await import('../../stores/admin-user-status.js')
const baseTarget = Object.freeze({ guid: '123456789012345678', username: 'alice', nickname: 'Alice', role: 'user', status: 'active', authVersion: 7 })
const mappedUser = Object.freeze({ ...baseTarget, email: null, group: 'default', planType: 'free', status: 'disabled', authVersion: 8, createdAt: '2026-09-08T00:00:00.000Z', lastLoginAt: null })

async function flushDialog() { for (let step = 0; step < 8; step++) await nextTick(); await new Promise(resolve => setTimeout(resolve, 0)); await nextTick() }
async function loadDialogComponent() {
  const source = await readFile(new URL('./UserStatusDialog.vue', import.meta.url), 'utf8')
  const descriptor = parse(source, { filename: 'UserStatusDialog.vue' }).descriptor
  const script = compileScript(descriptor, { id: 'user-status-element-plus', genDefaultAs: '__sfc__' })
  const template = compileTemplate({ id: 'user-status-element-plus', filename: 'UserStatusDialog.vue', source: descriptor.template.content, compilerOptions: { bindingMetadata: script.bindings } })
  assert.deepEqual(template.errors, [])
  const replacements = new Map([
    ['vue', new URL('../../../node_modules/vue/index.mjs', import.meta.url).href],
    ['@/stores/admin-user-status', new URL('../../stores/admin-user-status.js', import.meta.url).href],
    ['@/api/admin-user-status', new URL('../../api/admin-user-status.js', import.meta.url).href],
  ])
  let code = `${script.content}\n${template.code}\n__sfc__.render = render\nexport default __sfc__`
  for (const [specifier, replacement] of replacements) code = code.replaceAll(`from '${specifier}'`, `from '${replacement}'`).replaceAll(`from "${specifier}"`, `from "${replacement}"`)
  return (await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)).default
}
async function mountHarness(status = 'disabled') {
  const Dialog = await loadDialogComponent()
  const target = Object.freeze({ ...baseTarget, status: status === 'disabled' ? 'active' : 'disabled' })
  const ownership = Object.freeze({ actorRole: 'admin', actorGuid: '2', capabilities: [status === 'disabled' ? 'users.disable' : 'users.enable'], target, status, routeGuid: target.guid, identityEpoch: 'epoch-1', permissionVersion: 1 })
  const state = { wrapper: null, store: null, owner: null, submitted: [], events: [] }
  const Harness = defineComponent({
    setup() {
      state.store = useAdminUserStatusStore(); state.owner = ref(null)
      return () => h('main', [
        h('button', { id: 'status-entry', onClick(event) { state.trigger = event.currentTarget; state.owner.value = state.store.open(ownership) } }, 'open'),
        h(Dialog, { owner: state.owner.value, onClosed(token) { state.events.push(['closed', token]); nextTick(() => state.trigger?.focus()) }, onSucceeded: (user, token) => state.events.push(['succeeded', user, token]), onConflict: token => state.events.push(['conflict', token]), onFailed: (code, token) => state.events.push(['failed', code, token]) }),
      ])
    },
  })
  state.wrapper = mount(Harness, { attachTo: document.body, global: { plugins: [createPinia(), ElementPlus] } })
  return state
}
async function openDialog(state) { const entry = state.wrapper.get('#status-entry'); entry.element.focus(); await entry.trigger('click'); await flushDialog(); return entry }

for (const status of ['disabled', 'active']) test(`real ${status} dialog focuses its first control, traps focus, closes on Escape, and restores focus`, async () => {
  let state
  try {
    state = await mountHarness(status); const entry = await openDialog(state)
    const dialog = state.wrapper.get('[role="dialog"]'); const container = dialog.get('.el-dialog')
    const firstControl = status === 'disabled' ? state.wrapper.get('textarea').element : state.wrapper.get('input[type="checkbox"]').element
    assert.equal(document.activeElement, firstControl)
    const [first, last] = focusTrap.getEdges(container.element); assert.ok(first); assert.ok(last)
    last.focus(); last.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', code: 'Tab', bubbles: true, cancelable: true })); await flushDialog()
    assert.equal(document.activeElement, first)
    document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true })); await flushDialog()
    assert.equal(state.store.isOpen, false); assert.equal(document.activeElement, entry.element)
  } finally { state?.wrapper?.unmount(); document.body.innerHTML = '' }
})

test('disable accepts 200 astral code points, rejects 201, and clears reason as soon as ownership closes', async () => {
  let state
  try {
    state = await mountHarness('disabled'); await openDialog(state)
    state.store.submit = async (token, input) => { state.submitted.push([token, input]); return { state: 'failed', failureCode: 'unavailable', user: null } }
    const textarea = state.wrapper.get('textarea'); const checkbox = state.wrapper.get('input[type="checkbox"]')
    assert.equal(textarea.attributes('maxlength'), undefined)
    await checkbox.setValue(true); await textarea.setValue('😀'.repeat(201)); await state.wrapper.get('form').trigger('submit'); await flushDialog()
    assert.equal(state.submitted.length, 0); assert.equal(document.activeElement, textarea.element)
    await textarea.setValue('😀'.repeat(200)); await state.wrapper.get('form').trigger('submit'); await flushDialog()
    assert.equal(state.submitted.length, 1); assert.equal(state.submitted[0][1].reason, '😀'.repeat(200))
    await textarea.setValue('private reason'); state.store.close(state.owner.value); await nextTick(); await nextTick()
    assert.equal(textarea.element.value, '')
  } finally { state?.wrapper?.unmount(); document.body.innerHTML = '' }
})

test('validation-stage duplicate submits produce one mutation and one terminal event', async () => {
  let state
  try {
    state = await mountHarness('disabled'); await openDialog(state)
    state.store.submit = async (token, input) => { state.submitted.push([token, input]); return { state: 'succeeded', user: mappedUser } }
    await state.wrapper.get('textarea').setValue('review'); await state.wrapper.get('input[type="checkbox"]').setValue(true)
    const form = state.wrapper.get('form'); void form.trigger('submit'); void form.trigger('submit'); await flushDialog()
    assert.equal(state.submitted.length, 1)
    assert.equal(state.events.filter(event => event[0] === 'succeeded').length, 1)
  } finally { state?.wrapper?.unmount(); document.body.innerHTML = '' }
})

test('direct component unmount clears the retained native reason control', async () => {
  let state
  try {
    state = await mountHarness('disabled'); await openDialog(state)
    const textarea = state.wrapper.get('textarea'); await textarea.setValue('private unmount reason')
    const native = textarea.element; state.wrapper.unmount(); state = null
    assert.equal(native.value, '')
  } finally { state?.wrapper?.unmount(); document.body.innerHTML = '' }
})
