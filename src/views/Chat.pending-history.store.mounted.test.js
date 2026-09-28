import assert from 'node:assert/strict'
import test from 'node:test'
import { JSDOM } from 'jsdom'

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://local.test/chat' })
for (const key of ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'SVGElement', 'Event', 'MouseEvent']) {
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: dom.window[key] })
}
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
globalThis.isSecureContext = true
globalThis.BroadcastChannel = class { addEventListener() {} removeEventListener() {} postMessage() {} }
const values = new Map()
const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) }
globalThis.localStorage = storage; globalThis.sessionStorage = storage
Object.defineProperty(globalThis.navigator, 'locks', { configurable: true, value: { request: (_name, _options, fn) => fn() } })

const [testUtils, vue, pinia, vite] = await Promise.all([import('@vue/test-utils'), import('vue'), import('pinia'), import('vite')])
const { mount } = testUtils
const { defineComponent, h, onMounted, onBeforeUnmount, ref } = vue
const { createPinia, setActivePinia } = pinia
const { createServer } = vite
const server = await createServer({ envFile: false, server: { middlewareMode: true, watch: null, ws: false }, optimizeDeps: { noDiscovery: true, include: [] }, define: { 'import.meta.env.VITE_USE_MOCK': 'false' } })
const { useChatStore } = await server.ssrLoadModule('/src/stores/chat.js')
const { useSettingsStore } = await server.ssrLoadModule('/src/stores/settings.js')
const { authSession } = await server.ssrLoadModule('/src/api/request.js')
test.after(() => server.close())

const waitFor = async predicate => { for (let i = 0; i < 200; i += 1) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 5)) } assert.fail('condition not reached') }
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }

test('mounted boot with the real store keeps fetched history visible while pending recovery merges and settles', async () => {
  setActivePinia(createPinia())
  authSession.setSession({ accessToken: 'fixture', user: { guid: '1', username: 'fixture', nickname: null, role: 'user', status: 'active' } })
  const generationId = '123e4567-e89b-42d3-a456-426614174001'
  const conversationGuid = '9223372036854775703'
  sessionStorage.setItem('llm_platform_active_generation_v2', JSON.stringify({ generationId, mode: 'single', models: ['fixture-model'], conversationGuid, messageKey: 'pending-assistant', ownerGuid: '1', ownerEpoch: authSession.capture().epoch }))
  const store = useChatStore()
  const settings = useSettingsStore()
  const order = []
  const originalResume = store.resumePendingGeneration.bind(store)
  settings.loadModels = async () => { order.push('load'); settings.models = [{ id: 'fixture-model' }]; settings.modelsLoaded = true; settings.selectedModelId = 'fixture-model' }
  store.fetchConversations = async () => {
    order.push('fetch')
    store.conversations = [{ guid: conversationGuid, title: 'Existing', model: 'fixture-model', messages: [{ guid: '10', role: 'assistant', content: 'persisted history' }] }]
    store.activeId = conversationGuid
  }
  store.resumePendingGeneration = async () => { order.push('resume'); return originalResume() }
  store.ensureActive = async () => { order.push('ensure'); return store.getActive() }
  const requests = []; let gets = 0; let cancelPosts = 0
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).endsWith('/cancel')) { cancelPosts += 1; throw new Error('view unmount must not cancel') }
    assert.equal(options.method || 'GET', 'GET')
    gets += 1
    const request = deferred(); requests.push(request)
    options.signal?.addEventListener('abort', () => request.reject(new DOMException('aborted', 'AbortError')), { once: true })
    return request.promise
  }
  const Harness = defineComponent({
    setup() {
      const booting = ref(true)
      let disposed = false
      onMounted(async () => {
        await settings.loadModels()
        if (disposed) return
        await store.fetchConversations()
        if (disposed) return
        await store.resumePendingGeneration()
        if (disposed) return
        await store.ensureActive()
        if (disposed) return
        booting.value = false
      })
      onBeforeUnmount(() => { disposed = true; store.detachGenerationView() })
      return () => h('div', [
        h('span', { class: 'boot-state' }, booting.value ? 'booting' : 'ready'),
        ...(store.getActive()?.messages || []).map(message => h('p', { class: 'message' }, message.content || message.generationStatus)),
      ])
    },
  })
  let wrapper = mount(Harness)
  try {
    await waitFor(() => gets === 1)
    assert.deepEqual(order, ['load', 'fetch', 'resume'])
    assert.match(wrapper.text(), /persisted history/)
    assert.match(wrapper.text(), /waiting/)
    assert.equal(store.generationState.phase, 'recovering')
    assert.match(wrapper.text(), /booting/)
    const saved = sessionStorage.getItem('llm_platform_active_generation_v2')
    wrapper.unmount()
    await waitFor(() => store.streaming === false)
    assert.equal(cancelPosts, 0)
    assert.equal(sessionStorage.getItem('llm_platform_active_generation_v2'), saved, 'unmount preserves recovery metadata')
    order.length = 0
    wrapper = mount(Harness)
    await waitFor(() => gets === 2)
    assert.deepEqual(order, ['load', 'fetch', 'resume'])
    assert.equal(cancelPosts, 0)
    requests[1].resolve(new Response(JSON.stringify({ generation_id: generationId, status: 'cancelled', mode: 'single', conversation_guid: null }), { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } }))
    await waitFor(() => order.includes('ensure') && wrapper.text().includes('ready'))
    assert.deepEqual(order, ['load', 'fetch', 'resume', 'ensure'])
    assert.match(wrapper.text(), /persisted history/)
    assert.equal(store.conversations.length, 1, 'recovery must not replace authoritative history with a blank conversation')
    assert.equal(gets, 2, 'remount must recover the same metadata with GET only')
  } finally {
    wrapper.unmount(); globalThis.fetch = originalFetch; sessionStorage.removeItem('llm_platform_active_generation_v2')
  }
})
