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
const { useAdminUserEditStore } = await import('../../stores/admin-user-edit.js')
const target = Object.freeze({ guid: '123456789012345678', username: 'alice', nickname: 'Alice', role: 'user', status: 'active', authVersion: 7 })
const mappedUser = Object.freeze({ ...target, email: null, group: 'default', planType: 'free', createdAt: '2026-09-08T00:00:00.000Z', lastLoginAt: null })
const ownership = Object.freeze({ actorRole: 'admin', actorGuid: '2', capabilities: ['users.edit'], target, routeGuid: target.guid, identityEpoch: 'epoch-1', permissionVersion: 1 })

async function flushDialog() { for (let step = 0; step < 8; step++) await nextTick(); await new Promise(resolve => setTimeout(resolve, 0)); await nextTick() }
async function loadDialogComponent() {
  const source = await readFile(new URL('./UserNicknameEditDialog.vue', import.meta.url), 'utf8')
  const descriptor = parse(source, { filename: 'UserNicknameEditDialog.vue' }).descriptor
  const script = compileScript(descriptor, { id: 'user-edit-element-plus', genDefaultAs: '__sfc__' })
  const template = compileTemplate({
    id: 'user-edit-element-plus',
    filename: 'UserNicknameEditDialog.vue',
    source: descriptor.template.content,
    compilerOptions: { bindingMetadata: script.bindings },
  })
  assert.deepEqual(template.errors, [])
  const i18nStub = `data:text/javascript;base64,${Buffer.from("export function useI18n() { return { t: key => key } }").toString('base64')}`
  const replacements = new Map([
    ['vue', new URL('../../../node_modules/vue/index.mjs', import.meta.url).href],
    ['@/stores/admin-user-edit', new URL('../../stores/admin-user-edit.js', import.meta.url).href],
    ['@/api/admin-user-edit', new URL('../../api/admin-user-edit.js', import.meta.url).href],
    ['@/composables/useI18n', i18nStub],
  ])
  let code = `${script.content}\n${template.code}\n__sfc__.render = render\nexport default __sfc__`
  for (const [specifier, replacement] of replacements) {
    code = code.replaceAll(`from '${specifier}'`, `from '${replacement}'`).replaceAll(`from \"${specifier}\"`, `from \"${replacement}\"`)
  }
  return (await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)).default
}
async function mountHarness() {
  const Dialog = await loadDialogComponent()
  const state = { wrapper: null, store: null, owner: null, submitted: [], events: [] }
  const Harness = defineComponent({
    setup() {
      state.store = useAdminUserEditStore()
      state.owner = ref(null)
      return () => h('main', [
        h('button', { id: 'edit-entry', onClick(event) { state.trigger = event.currentTarget; state.owner.value = state.store.open(ownership) } }, 'open'),
        h(Dialog, {
          owner: state.owner.value,
          onClosed(token) { state.events.push(['closed', token]); nextTick(() => state.trigger?.focus()) },
          onSucceeded: (user, token) => state.events.push(['succeeded', user, token]),
          onConflict: token => state.events.push(['conflict', token]),
          onFailed: (code, token) => state.events.push(['failed', code, token]),
        }),
      ])
    },
  })
  state.wrapper = mount(Harness, { attachTo: document.body, global: { plugins: [createPinia(), ElementPlus] } })
  return state
}
async function openDialog(state) { const entry = state.wrapper.get('#edit-entry'); entry.element.focus(); await entry.trigger('click'); await flushDialog(); return entry }

test('real dialog focuses nickname, traps focus, closes on Escape, and restores focus', async () => {
  let state
  try {
    state = await mountHarness(); const entry = await openDialog(state)
    const dialog = state.wrapper.get('[role="dialog"]'); const container = dialog.get('.el-dialog'); const input = state.wrapper.get('input')
    assert.equal(document.activeElement, input.element)
    const [first, last] = focusTrap.getEdges(container.element); assert.ok(first); assert.ok(last)
    last.focus(); last.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', code: 'Tab', bubbles: true, cancelable: true })); await flushDialog()
    assert.equal(document.activeElement, first)
    document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true })); await flushDialog()
    assert.equal(state.store.isOpen, false); assert.equal(document.activeElement, entry.element)
  } finally { state?.wrapper?.unmount(); document.body.innerHTML = '' }
})

test('real form turns whitespace into null, accepts 64 code points, rejects 65, and disables duplicate submit while busy', async () => {
  let state
  try {
    state = await mountHarness(); await openDialog(state)
    state.store.submit = async (token, input) => { state.submitted.push([token, input]); return { state: 'succeeded', user: mappedUser } }
    const input = state.wrapper.get('input'); const submit = state.wrapper.get('button[type="submit"]')
    await input.setValue('x'.repeat(65)); submit.element.click(); await flushDialog(); assert.equal(state.submitted.length, 0); assert.equal(document.activeElement, input.element)
    await input.setValue('😀'.repeat(64)); submit.element.click(); await flushDialog(); assert.equal(state.submitted.length, 1); assert.equal(state.submitted[0][1].nickname, '😀'.repeat(64))
  } finally { state?.wrapper?.unmount(); document.body.innerHTML = '' }

  try {
    state = await mountHarness(); await openDialog(state)
    state.store.submit = async (token, input) => {
      state.submitted.push([token, input])
      state.store.state = 'failed'
      state.store.failureCode = 'unavailable'
      return { state: 'failed', failureCode: 'unavailable', user: null }
    }
    const input = state.wrapper.get('input'); await input.setValue('   '); state.store.state = 'submitting'; await nextTick()
    assert.equal(state.wrapper.get('button[type="submit"]').attributes('disabled'), '')
    state.store.state = 'idle'; await nextTick(); state.wrapper.get('button[type="submit"]').element.click(); await flushDialog()
    assert.equal(state.submitted[0][1].nickname, null); assert.equal(state.store.isOpen, true)
    assert.ok(state.wrapper.text().includes('editUser.retry'))
  } finally { state?.wrapper?.unmount(); document.body.innerHTML = '' }
})
