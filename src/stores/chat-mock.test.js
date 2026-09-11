import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createServer } from 'vite'
import { createPinia, setActivePinia } from 'pinia'

let server, useChatStore, useSettingsStore, authSession, mockApi
const originalMockEnv = process.env.VITE_USE_MOCK
const saved = new Map(['localStorage', 'sessionStorage', 'navigator', 'isSecureContext', 'BroadcastChannel', 'document'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))

before(async () => {
  process.env.VITE_USE_MOCK = 'true'
  const values = new Map()
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) }
  globalThis.localStorage = storage; globalThis.sessionStorage = storage
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks: { request: (_name, _options, fn) => fn() } } })
  globalThis.isSecureContext = true
  globalThis.BroadcastChannel = class { addEventListener() {} removeEventListener() {} postMessage() {} }
  globalThis.document = { documentElement: { setAttribute() {} }, visibilityState: 'hidden' }
  server = await createServer({ envFile: false, server: { middlewareMode: true, watch: null, ws: false }, optimizeDeps: { noDiscovery: true, include: [] }, plugins: [{ name: 'force-mock-mode', enforce: 'pre', transform(code, id) { if (id.endsWith('/src/api/request.js')) return code.replace('const env = import.meta.env ?? {}', "const env = { VITE_USE_MOCK: 'true' }") } }] })
  ;({ useChatStore } = await server.ssrLoadModule('/src/stores/chat.js'))
  ;({ useSettingsStore } = await server.ssrLoadModule('/src/stores/settings.js'))
  ;({ authSession } = await server.ssrLoadModule('/src/api/request.js'))
  ;({ mockApi } = await server.ssrLoadModule('/src/api/mock.js'))
})

after(async () => {
  await server?.close()
  if (originalMockEnv === undefined) delete process.env.VITE_USE_MOCK
  else process.env.VITE_USE_MOCK = originalMockEnv
  for (const [key, descriptor] of saved) descriptor ? Object.defineProperty(globalThis, key, descriptor) : delete globalThis[key]
})

test('mock mode retains local streaming without calling the strict network transport', async () => {
  setActivePinia(createPinia())
  authSession.setSession({ accessToken: 'mock', user: { guid: '1', username: 'mock', nickname: null, role: 'user', status: 'active' } })
  useSettingsStore().selectedModelId = 'demo-chat'
  const store = useChatStore(); await store.ensureActive()
  const originalFetch = globalThis.fetch; let networkCalls = 0
  globalThis.fetch = async () => { networkCalls += 1; throw new Error('mock mode must stay local') }
  try {
    await store.sendMessage('hi')
    for (let attempt = 0; attempt < 20 && store.generationState?.status !== 'completed'; attempt += 1) await new Promise(resolve => setTimeout(resolve, 5))
    assert.equal(networkCalls, 0)
    assert.equal(store.getActive().messages.at(-1).generationStatus, 'completed')
    assert.match(store.getActive().messages.at(-1).content, /演示模式/)
  } finally { globalThis.fetch = originalFetch }
})

test('mock compare records complete terminal metadata and converges successful siblings', async () => {
  setActivePinia(createPinia())
  authSession.setSession({ accessToken: 'mock', user: { guid: '1', username: 'mock', nickname: null, role: 'user', status: 'active' } })
  const settings = useSettingsStore(); settings.compareMode = true; settings.compareModelIds = ['demo-chat', 'demo-reasoning']
  const store = useChatStore(); await store.ensureActive()
  const originalFetch = globalThis.fetch; let networkCalls = 0
  globalThis.fetch = async () => { networkCalls += 1; throw new Error('mock compare must stay local') }
  try {
    await store.sendMessage('compare locally')
    for (let attempt = 0; attempt < 40 && store.generationState?.status === 'draining'; attempt += 1) await new Promise(resolve => setTimeout(resolve, 5))
    assert.equal(networkCalls, 0)
    assert.equal(store.generationState?.status, 'completed')
    const assistant = store.getActive().messages.at(-1)
    assert.deepEqual(assistant.models, ['demo-chat', 'demo-reasoning'])
    assert.deepEqual(Object.values(assistant.modelStates).map(state => state.status), ['completed', 'completed'])
    assert.equal(assistant.transientAttempt, undefined)
  } finally { globalThis.fetch = originalFetch }
})

test('mock compare uses the shared mixed and all-failed completion rules', async () => {
  const originalCompare = mockApi.compareModels
  try {
    for (const [name, outcomes, expected] of [
      ['mixed', { 'demo-chat': { status: 'failed', code: 'timeout' }, 'demo-reasoning': { status: 'completed', tokens: 2 } }, 'completed'],
      ['all failed', { 'demo-chat': { status: 'failed', code: 'timeout' }, 'demo-reasoning': { status: 'failed', code: 'gateway_upstream_error' } }, 'failed'],
    ]) {
      setActivePinia(createPinia())
      authSession.setSession({ accessToken: 'mock', user: { guid: '1', username: 'mock', nickname: null, role: 'user', status: 'active' } })
      const settings = useSettingsStore(); settings.compareMode = true; settings.compareModelIds = ['demo-chat', 'demo-reasoning']
      mockApi.compareModels = async ({ onModelChunk }) => {
        onModelChunk({ model: 'demo-chat', delta: 'partial a' }); onModelChunk({ model: 'demo-reasoning', delta: 'answer b' })
        return { models: outcomes, total_tokens_used: 2 }
      }
      const store = useChatStore(); await store.ensureActive(); await store.sendMessage(name)
      for (let attempt = 0; attempt < 40 && store.generationState?.status === 'draining'; attempt += 1) await new Promise(resolve => setTimeout(resolve, 5))
      assert.equal(store.generationState?.status, expected, name)
      const [user, assistant] = store.getActive().messages.slice(-2)
      assert.equal(Boolean(user.transientAttempt), expected === 'failed', name)
      assert.equal(Boolean(assistant.transientAttempt), expected === 'failed', name)
      assert.equal(JSON.stringify(assistant.replies).includes('timeout'), false, name)
    }
  } finally { mockApi.compareModels = originalCompare }
})
