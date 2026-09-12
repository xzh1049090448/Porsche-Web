import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc'
import { JSDOM } from 'jsdom'

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://local.test/chat' })
for (const key of ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'SVGElement', 'Event', 'MouseEvent']) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: dom.window[key] })
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
test.after(() => server.close())

const encode = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
const waitFor = async predicate => { for (let i = 0; i < 200; i += 1) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 5)) } assert.fail('condition not reached') }
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
const failedStream = (generationId, model) => new Response(
  `event: meta\ndata: ${JSON.stringify({ schema: 'platform-chat-sse.v2', generation_id: generationId, conversation_guid: '9223372036854775704', models: [model] })}\n\n`
  + `event: error\ndata: ${JSON.stringify({ generation_id: generationId, code: 'timeout', request_id: 'req-1' })}\n\n`,
  { status: 200, headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' } },
)

test('mounted message list uses the real store action to replace an empty failure with a new UUID POST', async () => {
  setActivePinia(createPinia())
  authSession.setSession({ accessToken: 'fixture', user: { guid: '1', username: 'fixture', nickname: null, role: 'user', status: 'active' } })
  const settings = useSettingsStore(); settings.models = [{ id: 'fixture-model', name: 'Fixture', icon: 'F' }]; settings.modelsLoaded = true; settings.selectedModelId = 'fixture-model'
  const store = useChatStore(); store.conversations = [{ guid: '9223372036854775704', title: 'Fixture', model: 'fixture-model', messages: [] }]; store.activeId = '9223372036854775704'
  globalThis.__be06AttemptFixture = { store, settings }
  const source = await readFile(new URL('./ChatMessageList.vue', import.meta.url), 'utf8')
  const descriptor = parse(source, { filename: 'ChatMessageList.vue' }).descriptor
  const script = compileScript(descriptor, { id: 'be06-real-attempt-list', genDefaultAs: '__sfc__' })
  const template = compileTemplate({ id: 'be06-real-attempt-list', filename: 'ChatMessageList.vue', source: descriptor.template.content, compilerOptions: { bindingMetadata: script.bindings } })
  assert.deepEqual(template.errors, [])
  let code = `${script.content}\n${template.code}\n__sfc__.render=render\nexport default __sfc__`
  const replacements = new Map([
    ['vue', new URL('../../../node_modules/vue/index.mjs', import.meta.url).href],
    ['@/stores/chat', encode('export const useChatStore=()=>globalThis.__be06AttemptFixture.store')],
    ['@/stores/settings', encode('export const useSettingsStore=()=>globalThis.__be06AttemptFixture.settings')],
    ['@/composables/useI18n', encode('export const useI18n=()=>({t:key=>key})')],
    ['@/components/chat/generation-ui', new URL('./generation-ui.js', import.meta.url).href],
    ['@element-plus/icons-vue', encode('export const CopyDocument={}')],
    ['element-plus', encode('export const ElMessage={success(){}}')],
  ])
  for (const [specifier, replacement] of replacements) code = code.replaceAll(`from '${specifier}'`, `from '${replacement}'`).replaceAll(`from "${specifier}"`, `from "${replacement}"`)
  code = code.replaceAll("import MarkdownContent from '@/components/chat/MarkdownContent.vue'", "const MarkdownContent={props:['content'],template:'<div>{{content}}</div>'}")
  const List = (await import(encode(code))).default
  const wrapper = mount(List, { attachTo: document.body, global: { stubs: { ElAvatar: { template: '<span><slot /></span>' }, ElButton: { template: '<button><slot /></button>' }, ElImage: true } } })
  const second = deferred(); const postIds = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (_url, options = {}) => {
    const body = JSON.parse(options.body)
    postIds.push(body.generation_id)
    return postIds.length === 1 ? failedStream(body.generation_id, body.model) : second.promise
  }
  try {
    await store.sendMessage('retry with a new attempt')
    await waitFor(() => wrapper.find('.regenerate-button').exists())
    assert.equal(wrapper.find('.message.assistant .bubble').exists(), false)
    assert.match(wrapper.get('.attempt-failure').text(), /chat\.generationErrors\.requestFailed/)
    await wrapper.get('.regenerate-button').trigger('click')
    await waitFor(() => postIds.length === 2)
    assert.notEqual(postIds[0], postIds[1], 'regeneration must create a new UUID instead of replaying the failed POST')
    second.resolve(failedStream(postIds[1], 'fixture-model'))
    await waitFor(() => store.generationState?.status === 'failed')
  } finally {
    wrapper.unmount(); globalThis.fetch = originalFetch; delete globalThis.__be06AttemptFixture
  }
})
