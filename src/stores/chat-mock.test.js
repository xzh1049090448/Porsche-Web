import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createServer } from 'vite'
import { createPinia, setActivePinia } from 'pinia'

let server, useChatStore, useSettingsStore, authSession
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
