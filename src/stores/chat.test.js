import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import { createServer } from 'vite'
import { createPinia, setActivePinia } from 'pinia'
import { setImmediate } from 'node:timers/promises'

// Load the real store/API/mappers via the project's Vite aliases, replacing
// only Axios's transport so every request stays inside these local fixtures.
let server, useChatStore, request, authSession, route, calls = [], writes = []
const browserGlobals = ['localStorage', 'navigator', 'isSecureContext', 'BroadcastChannel', 'document']
const originalGlobals = new Map(browserGlobals.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
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
  const storage = new Map()
  globalThis.localStorage = {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => { writes.push([key, value]); storage.set(key, value) },
    removeItem: key => storage.delete(key),
  }
  // Supply browser capabilities at the boundary, retaining the actual core,
  // browser adapter, HTTP interceptors and epoch checks in this SSR fixture.
  let lockQueue = Promise.resolve()
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks: {
    request: (_name, _options, fn) => { const pending = lockQueue.then(fn); lockQueue = pending.catch(() => {}); return pending },
  } } })
  globalThis.isSecureContext = true
  globalThis.BroadcastChannel = class { addEventListener() {} removeEventListener() {} postMessage() {} }

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
  ;({ default: request, authSession } = await server.ssrLoadModule('/src/api/request.js'))
  globalThis.document = { documentElement: { setAttribute() {} } }
  request.defaults.adapter = async (config) => {
    calls.push([config.method, config.url])
    const data = await route(config)
    return { data, status: 200, statusText: 'OK', headers: {}, config }
  }
})
after(async () => {
  await server?.close()
  for (const [key, descriptor] of originalGlobals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor)
    else delete globalThis[key]
  }
})
beforeEach(() => {
  setActivePinia(createPinia())
  authSession.clearSession()
  authSession.setSession({ accessToken: 'fixture-access', user: { guid: '1', username: 'fixture', nickname: null, role: 'user', status: 'active' } })
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

test('sending during initial detail waits for history and keeps the new streamed messages attached', async () => {
  const store = useChatStore()
  const response = deferred(), started = deferred(), stream = deferred()
  const history = { ...detail(A), messages: [
    ...detail(A).messages,
    { guid: `${A}2`, role: 'assistant', content: 'Previous reply', created_at: 2 },
    { guid: `${A}3`, role: 'user', content: 'Previous follow-up', created_at: 3 },
  ] }
  route = ({ url }) => url === listPath ? { items: [summary(A)], total: 1 } : (started.resolve(), response.promise)
  const originalFetch = globalThis.fetch
  const sent = []
  globalThis.fetch = async (_url, options) => { sent.push(JSON.parse(options.body)); return stream.promise }
  try {
    const initial = store.fetchConversations()
    await started.promise
    const sending = store.sendMessage('New question')
    await setImmediate()
    const earlyRequests = sent.length
    response.resolve(history)
    await initial
    const generationId = sent[0].generation_id
    const model = sent[0].model
    const streamBody = [
      `event: meta\ndata: ${JSON.stringify({ schema: 'platform-chat-sse.v2', generation_id: generationId, conversation_guid: A, models: [model] })}\n\n`,
      `event: delta\ndata: ${JSON.stringify({ generation_id: generationId, model, seq: 1, delta: 'New answer' })}\n\n`,
      `event: model_done\ndata: ${JSON.stringify({ generation_id: generationId, model, last_seq: 1 })}\n\n`,
      `event: done\ndata: ${JSON.stringify({ generation_id: generationId, status: 'completed', conversation_guid: A, tokens: 2, total_tokens_used: 2 })}\n\n`,
    ].join('')
    stream.resolve(new Response(streamBody, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }))
    await sending
    assert.equal(earlyRequests, 0, 'must not send before the in-flight history is available')
    assert.equal(sent[0].messages[0].content, `Message ${A}`)
    assert.equal(store.getActive().messages.at(-2).content, 'New question')
    assert.equal(store.getActive().messages.at(-1).content, 'New answer')
  } finally { globalThis.fetch = originalFetch }
})

test('ensureActive follows a newly selected pending detail without waiting on it twice or fetching again', async () => {
  const store = useChatStore()
  store.conversations = [summary(A), summary(B)]
  const a = deferred(), b = deferred()
  route = ({ url }) => url.endsWith(A) ? a.promise : b.promise
  const loadingA = store.selectConversation(A)
  let ready = false
  const ensuring = store.ensureActive().then(conv => { ready = true; return conv })
  const loadingB = store.selectConversation(B)
  a.resolve(detail(A))
  await loadingA
  await setImmediate()
  const readyBeforeB = ready
  b.resolve(detail(B))
  await loadingB
  const active = await ensuring
  assert.equal(readyBeforeB, false, 'the latest selection must finish its own pending detail')
  assert.equal(active.guid, B)
  assert.equal(active.messages[0].content, `Message ${B}`)
  assert.equal(calls.length, 2, 'waiting should not issue extra detail requests')
})

test('identity switch does not reuse old pending detail and its old finally cannot clear the new pending', async () => {
  const store = useChatStore()
  store.conversations = [summary(A)]; store.activeId = A
  const old = deferred(), current = deferred(), started = deferred()
  let details = 0
  route = () => { details++; if (details === 1) { started.resolve(); return old.promise } return current.promise }
  const oldLoading = store.refreshActiveConversation()
  await started.promise
  authSession.clearSession()
  authSession.setSession({ accessToken: 'next-account', user: { guid: '2', username: 'next', nickname: null, role: 'user', status: 'active' } })
  store.conversations = [summary(A)]; store.activeId = A
  const newLoading = store.refreshActiveConversation()
  try {
    await setImmediate()
    assert.equal(details, 2, 'the new identity must issue its own detail request')
    old.resolve(detail(A)); await oldLoading
    const sameNewLoading = store.refreshActiveConversation()
    await setImmediate()
    assert.equal(details, 2, 'old finally must not erase the new identity pending entry')
    current.resolve({ ...detail(A), messages: [{ guid: '123', role: 'user', content: 'New identity history', created_at: 1 }] })
    await Promise.all([newLoading, sameNewLoading])
    assert.equal(store.getActive().messages[0].content, 'New identity history')
  } finally {
    old.resolve(detail(A)); current.resolve(detail(A))
    await Promise.allSettled([oldLoading, newLoading])
  }
})

test('ensureActive waiting on history rejects after identity changes instead of returning another account history', async () => {
  const store = useChatStore()
  store.conversations = [summary(A)]; store.activeId = A
  const response = deferred(), started = deferred()
  route = () => { started.resolve(); return response.promise }
  const loading = store.refreshActiveConversation()
  await started.promise
  const ensuring = store.ensureActive()
  const rejected = assert.rejects(ensuring, /identity_changed/)
  authSession.clearSession()
  authSession.setSession({ accessToken: 'next-account', user: { guid: '2', username: 'next', nickname: null, role: 'user', status: 'active' } })
  store.conversations = [detail(B)]; store.activeId = B
  response.resolve(detail(A)); await loading
  await rejected
})
