import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc'
import { JSDOM } from 'jsdom'

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://local.test/chat', pretendToBeVisual: true })
for (const key of ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'SVGElement', 'Event', 'MouseEvent', 'MutationObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame']) {
  const value = ['getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame'].includes(key) ? dom.window[key].bind(dom.window) : dom.window[key]
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
}
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
globalThis.isSecureContext = true
globalThis.BroadcastChannel = class { addEventListener() {} removeEventListener() {} postMessage() {} }
const values = new Map()
const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) }
globalThis.localStorage = storage; globalThis.sessionStorage = storage
Object.defineProperty(globalThis.navigator, 'locks', { configurable: true, value: { request: (_name, _options, fn) => fn() } })

const [{ mount }, { createPinia, setActivePinia }, { createServer }] = await Promise.all([import('@vue/test-utils'), import('pinia'), import('vite')])
const server = await createServer({ envFile: false, server: { middlewareMode: true, watch: null, ws: false }, optimizeDeps: { noDiscovery: true, include: [] }, define: { 'import.meta.env.VITE_USE_MOCK': 'false' } })
const { useChatStore } = await server.ssrLoadModule('/src/stores/chat.js')
const { useSettingsStore } = await server.ssrLoadModule('/src/stores/settings.js')
const { authSession } = await server.ssrLoadModule('/src/api/request.js')

const encode = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
const waitFor = async predicate => { for (let i = 0; i < 200; i += 1) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 5)) } assert.fail('condition not reached') }
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
const jsonResponse = body => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })

test('real chat store disconnect is visibly rendered before recovery and retry converges', async t => {
  t.after(() => server.close())
  setActivePinia(createPinia())
  authSession.setSession({ accessToken: 'fixture', user: { guid: '1', username: 'fixture', nickname: null, role: 'user', status: 'active' } })
  const settings = useSettingsStore(); settings.models = [{ id: 'fixture-model' }]; settings.modelsLoaded = true; settings.selectedModelId = 'fixture-model'
  const store = useChatStore(); store.conversations = [{ guid: '9223372036854775701', title: 'Fixture', model: 'fixture-model', messages: [] }]; store.activeId = '9223372036854775701'
  globalThis.__be06RealStore = store
  const source = await readFile(new URL('./GenerationStatus.vue', import.meta.url), 'utf8')
  const descriptor = parse(source, { filename: 'GenerationStatus.vue' }).descriptor
  const script = compileScript(descriptor, { id: 'be06-real-store-status', genDefaultAs: '__sfc__' })
  const template = compileTemplate({ id: 'be06-real-store-status', filename: 'GenerationStatus.vue', source: descriptor.template.content, compilerOptions: { bindingMetadata: script.bindings } })
  assert.deepEqual(template.errors, [])
  let code = `${script.content}\n${template.code}\n__sfc__.render=render\nexport default __sfc__`
  const replacements = new Map([
    ['vue', new URL('../../../node_modules/vue/index.mjs', import.meta.url).href],
    ['@/stores/chat', encode('export const useChatStore=()=>globalThis.__be06RealStore')],
    ['@/composables/useI18n', encode('export const useI18n=()=>({t:key=>key})')],
    ['@/components/chat/generation-ui', new URL('./generation-ui.js', import.meta.url).href],
  ])
  for (const [specifier, replacement] of replacements) code = code.replaceAll(`from '${specifier}'`, `from '${replacement}'`).replaceAll(`from "${specifier}"`, `from "${replacement}"`)
  const Status = (await import(encode(code))).default
  const wrapper = mount(Status, { attachTo: document.body })
  const seen = []
  const observer = new MutationObserver(() => seen.push(wrapper.text()))
  observer.observe(document.body, { childList: true, subtree: true, characterData: true })
  const first = deferred(), second = deferred(); let gets = 0, generationId
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (_url, options = {}) => {
    if ((options.method || 'GET') === 'POST') { generationId = JSON.parse(options.body).generation_id; return new Response('', { status: 200, headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' } }) }
    gets += 1
    return gets === 1 ? first.promise : second.promise
  }
  try {
    const sending = store.sendMessage('observe recovery')
    await waitFor(() => gets === 1)
    await waitFor(() => seen.some(text => text.includes('chat.generationStates.disconnected')))
    assert.ok(seen.some(text => text.includes('chat.generationStates.disconnected')), JSON.stringify({ seen, current: wrapper.text(), state: store.generationState }))
    await waitFor(() => wrapper.text().includes('chat.generationStates.recovering'))
    assert.match(wrapper.text(), /chat\.generationStates\.recovering/)
    first.reject(new TypeError('temporary failure')); await sending
    await waitFor(() => wrapper.text().includes('chat.generationStates.disconnected'))
    const retry = wrapper.get('.retry-button'); await retry.trigger('click'); await waitFor(() => gets === 2)
    await waitFor(() => wrapper.text().includes('chat.generationStates.recovering'))
    assert.match(wrapper.text(), /chat\.generationStates\.recovering/)
    second.resolve(jsonResponse({ generation_id: generationId, status: 'cancelled', mode: 'single', conversation_guid: null }))
    await waitFor(() => wrapper.text().includes('chat.generationStates.cancelled'))
    assert.equal(store.streaming, false)
  } finally {
    observer.disconnect(); wrapper.unmount(); globalThis.fetch = originalFetch; delete globalThis.__be06RealStore
  }
})
