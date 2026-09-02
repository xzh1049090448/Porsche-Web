import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import { createServer } from 'vite'
import { createPinia, setActivePinia } from 'pinia'

// Load the real store/API/mappers via the project's Vite aliases, replacing
// only Axios's transport so every request stays inside these local fixtures.
let server, useChatStore, request, route, calls, writes
const A = '9223372036854775701'
const B = '9223372036854775702'
const C = '9223372036854775703'
const listPath = '/api/v1/conversations'
const summary = (guid) => ({ guid, title: `History ${guid}`, model: 'fixture-model', created_at: 1, updated_at: 2 })
const detail = (guid) => ({ ...summary(guid), messages: [{ guid: `${guid}1`, role: 'user', content: `Message ${guid}`, created_at: 1 }] })
function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
function httpError(status) { return Object.assign(new Error(`Fixture ${status}`), { response: { status } }) }

before(async () => {
  globalThis.localStorage = {
    getItem: () => null,
    setItem: (key, value) => writes.push([key, value]),
    removeItem: () => {},
  }
  server = await createServer({
    envFile: false,
    server: { middlewareMode: true, watch: null, ws: false },
    // SSR tests do not need client pre-bundling; leave a running dev server's
    // optimized dependency cache alone.
    optimizeDeps: { noDiscovery: true, include: [] },
    define: { 'import.meta.env.VITE_USE_MOCK': 'false' },
    plugins: [{
      name: 'no-browser-navigation-in-store-tests',
      enforce: 'pre',
      load(id) {
        if (id.endsWith('/src/router/index.js')) return 'export default { replace() { throw new Error("Unexpected navigation") } }'
      },
    }],
  })
  ;({ useChatStore } = await server.ssrLoadModule('/src/stores/chat.js'))
  ;({ default: request } = await server.ssrLoadModule('/src/api/request.js'))
  globalThis.document = { documentElement: { setAttribute() {} } }
  request.defaults.adapter = async (config) => {
    calls.push([config.method, config.url])
    const data = await route(config)
    return { data, status: 200, statusText: 'OK', headers: {}, config }
  }
})
after(async () => { await server?.close(); delete globalThis.localStorage; delete globalThis.document })
beforeEach(() => {
  setActivePinia(createPinia())
  calls = []; writes = []
  route = ({ url, method }) => {
    if (url === listPath && method === 'get') return { items: [summary(A), summary(B)], total: 2 }
    if (url === listPath && method === 'post') return { ...summary(C), messages: [] }
    if (url === `${listPath}/${A}`) return detail(A)
    if (url === `${listPath}/${B}`) return detail(B)
    throw new Error(`Unexpected fixture request: ${method} ${url}`)
  }
})

test('initial mount sequence loads selected history exactly once and keeps real history out of Storage', async () => {
  const store = useChatStore()
  await store.fetchConversations()
  await store.ensureActive()
  assert.equal(store.getActive().messages[0]?.content, `Message ${A}`)
  assert.equal(calls.filter(([, url]) => url === `${listPath}/${A}`).length, 1)
  assert.equal(calls.some(([method]) => method === 'post'), false)
  assert.equal(writes.some(([key, value]) => /conversations|activeConversation/.test(key) || value.includes('Message')), false)
})

test('list reload preserves an existing selection and loads its detail', async () => {
  const store = useChatStore()
  store.activeId = B
  await store.fetchConversations()
  assert.equal(store.activeId, B)
  assert.equal(store.getActive().messages[0]?.content, `Message ${B}`)
})

test('a selection absent from the refreshed list falls back to loaded first history', async () => {
  const store = useChatStore()
  store.activeId = C
  await store.fetchConversations()
  await store.ensureActive()
  assert.equal(store.activeId, A)
  assert.equal(store.getActive().messages[0]?.content, `Message ${A}`)
})

test('concurrent initialization shares list and pending detail requests', async () => {
  const store = useChatStore()
  const response = deferred()
  const started = deferred()
  route = ({ url }) => url === listPath ? { items: [summary(A)], total: 1 } : (started.resolve(), response.promise)
  const first = store.fetchConversations()
  const second = store.fetchConversations()
  // A missing detail request on the old implementation must fail, not hang.
  await Promise.race([started.promise, first])
  assert.equal(calls.filter(([, url]) => url === `${listPath}/${A}`).length, 1)
  const refresh = store.refreshActiveConversation()
  response.resolve(detail(A))
  await Promise.all([first, second, refresh])
  assert.equal(calls.filter(([, url]) => url === listPath).length, 1)
  assert.equal(calls.filter(([, url]) => url === `${listPath}/${A}`).length, 1)
  assert.equal(store.getActive().messages.length, 1)
})

test('empty account keeps the existing single-new-conversation behavior', async () => {
  const store = useChatStore()
  route = ({ method }) => method === 'get' ? { items: [], total: 0 } : { ...summary(C), messages: [] }
  await store.fetchConversations()
  assert.equal(calls.some(([method]) => method === 'post'), false)
  await store.ensureActive()
  assert.equal(store.activeId, C)
  assert.equal(calls.filter(([method]) => method === 'post').length, 1)
})

for (const status of [200, 404, 500]) {
  test(`slow A ${status} response cannot replace or remove newly selected B`, async () => {
    const store = useChatStore()
    store.conversations = [summary(A), summary(B)]
    store.activeId = A
    const response = deferred()
    const started = deferred()
    route = ({ url }) => url.endsWith(A) ? (started.resolve(), response.promise) : detail(B)
    const pending = store.refreshActiveConversation()
    await started.promise
    store.selectConversation(B)
    await store.refreshActiveConversation()
    if (status === 200) response.resolve(detail(A))
    else response.reject(httpError(status))
    await pending
    assert.equal(store.activeId, B)
    assert.equal(store.getActive().messages[0]?.content, `Message ${B}`)
    assert.equal(store.conversations.some((item) => item.guid === B), true)
    assert.equal(calls.some(([method]) => method === 'post'), false)
    if (status === 404) assert.equal(store.conversations.some((item) => item.guid === A), false)
  })
}

test('failed initial detail stays retryable through selecting the same conversation', async () => {
  const store = useChatStore()
  let attempts = 0
  route = ({ url }) => {
    if (url === listPath) return { items: [summary(A)], total: 1 }
    if (++attempts === 1) throw httpError(500)
    return detail(A)
  }
  await store.fetchConversations()
  assert.equal(attempts, 1)
  assert.equal(store.getActive().messages.length, 0)
  store.selectConversation(A)
  await store.refreshActiveConversation()
  assert.equal(store.getActive().messages[0]?.content, `Message ${A}`)
  assert.equal(attempts, 2)
})

test('initial 404 removes the requested conversation and loads the fallback history', async () => {
  const store = useChatStore()
  route = ({ url }) => {
    if (url === listPath) return { items: [summary(A), summary(B)], total: 2 }
    if (url.endsWith(A)) throw httpError(404)
    return detail(B)
  }
  await store.fetchConversations()
  assert.equal(store.activeId, B)
  assert.equal(store.getActive().messages[0]?.content, `Message ${B}`)
  assert.equal(calls.some(([method]) => method === 'post'), false)
})

test('failed list request does not create a conversation and can be retried', async () => {
  const store = useChatStore()
  const success = route
  route = () => { throw httpError(500) }
  await assert.rejects(store.fetchConversations())
  assert.equal(store.loading, false)
  assert.equal(store.activeId, null)
  assert.equal(calls.some(([method]) => method === 'post'), false)
  route = success
  await store.fetchConversations()
  assert.equal(store.getActive().messages[0]?.content, `Message ${A}`)
})
