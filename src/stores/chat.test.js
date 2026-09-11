import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import { createServer } from 'vite'
import { createPinia, setActivePinia } from 'pinia'
import { setImmediate } from 'node:timers/promises'

// Load the real store/API/mappers via the project's Vite aliases, replacing
// only Axios's transport so every request stays inside these local fixtures.
let server, useChatStore, projectConversationForPersistence, useSettingsStore, useUserStore, request, authSession, route, calls = [], writes = []
const browserGlobals = ['localStorage', 'sessionStorage', 'navigator', 'isSecureContext', 'BroadcastChannel', 'document']
const originalGlobals = new Map(browserGlobals.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
const A = '9223372036854775701'
const B = '9223372036854775702'
const C = '9223372036854775703'
const D = '9223372036854775704'
const listPath = '/api/v1/conversations'
const summary = (guid) => ({ guid, title: `History ${guid}`, model: 'fixture-model', created_at: 1, updated_at: 2 })
const detail = (guid) => ({ ...summary(guid), messages: [{ guid: `${guid}1`, role: 'user', content: `Message ${guid}`, created_at: 1 }] })
function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
function httpError(status) { return Object.assign(new Error(`Fixture ${status}`), { response: { status } }) }
const sseResponse = body => new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store' } })
const jsonResponse = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers } })
const waitFor = async predicate => {
  for (let attempt = 0; attempt < 240; attempt += 1) {
    if (predicate()) return
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  assert.fail('condition was not reached')
}

before(async () => {
  const storage = new Map()
  globalThis.localStorage = {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => { writes.push([key, value]); storage.set(key, value) },
    removeItem: key => storage.delete(key),
  }
  const session = new Map()
  globalThis.sessionStorage = {
    getItem: key => session.get(key) ?? null,
    setItem: (key, value) => session.set(key, value),
    removeItem: key => session.delete(key),
    clear: () => session.clear(),
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
  ;({ useChatStore, projectConversationForPersistence } = await server.ssrLoadModule('/src/stores/chat.js'))
  ;({ useSettingsStore } = await server.ssrLoadModule('/src/stores/settings.js'))
  ;({ useUserStore } = await server.ssrLoadModule('/src/stores/user.js'))
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
  globalThis.sessionStorage.clear()
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
  useSettingsStore().selectedModelId = 'fixture-model'
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
    stream.resolve(sseResponse(streamBody))
    await sending
    await waitFor(() => store.generationState?.status === 'completed')
    assert.equal(earlyRequests, 0, 'must not send before the in-flight history is available')
    assert.equal(sent[0].messages[0].content, `Message ${A}`)
    assert.deepEqual(sent[0].messages.map(message => message.role), ['user', 'assistant', 'user', 'user'])
    assert.equal(sent[0].messages.at(-1).content, 'New question')
    assert.equal(sent[0].messages.some(message => message.role === 'assistant' && message.content === ''), false)
    assert.equal(sent[0].messages.filter(message => message.role === 'user' && message.content === 'New question').length, 1)
    assert.equal(store.getActive().messages.at(-2).content, 'New question')
    assert.equal(store.getActive().messages.at(-1).content, 'New answer')
  } finally { globalThis.fetch = originalFetch }
})

test('new local conversation posts without a server guid and binds the first v2 meta once', async () => {
  const store = useChatStore(); useSettingsStore().selectedModelId = 'fixture-model'
  store.conversations = [{ localKey: 'draft-1', title: 'Draft', messages: [] }]; store.activeId = 'draft-1'
  const sent = []; const originalFetch = globalThis.fetch
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body); sent.push(body)
    const id = body.generation_id
    return sseResponse([
      `event: meta\ndata: ${JSON.stringify({ schema: 'platform-chat-sse.v2', generation_id: id, conversation_guid: A, models: ['fixture-model'] })}\n\n`,
      `event: delta\ndata: ${JSON.stringify({ generation_id: id, model: 'fixture-model', seq: 1, delta: 'A👍🏽' })}\n\n`,
      `event: model_done\ndata: ${JSON.stringify({ generation_id: id, model: 'fixture-model', last_seq: 1 })}\n\n`,
      `event: done\ndata: ${JSON.stringify({ generation_id: id, status: 'completed', conversation_guid: A, tokens: 1, total_tokens_used: 1 })}\n\n`,
    ].join(''))
  }
  try {
    await store.sendMessage('hello'); await waitFor(() => store.generationState?.status === 'completed')
    assert.equal(Object.hasOwn(sent[0], 'conversation_guid'), false)
    assert.equal(store.activeId, A); assert.equal(store.getActive().guid, A)
    assert.equal(store.getActive().messages.at(-1).content, 'A👍🏽')
    assert.equal(store.getActive().messages.at(-1).generationStatus, 'completed')
  } finally { globalThis.fetch = originalFetch }
})

test('new local conversation binds an authoritative completed GET when the stream ends before meta', async () => {
  const store = useChatStore(); useSettingsStore().selectedModelId = 'fixture-model'
  store.conversations = [{ localKey: 'draft-status', title: 'Draft', messages: [] }]; store.activeId = 'draft-status'
  const originalFetch = globalThis.fetch; let generationId; let gets = 0
  globalThis.fetch = async (_url, options = {}) => {
    if ((options.method || 'GET') === 'POST') {
      generationId = JSON.parse(options.body).generation_id
      return sseResponse('')
    }
    gets += 1
    return jsonResponse({ generation_id: generationId, status: 'completed', mode: 'single', conversation_guid: A, total_tokens_used: 2, result: { model: 'fixture-model', status: 'completed', assistant_message_guid: B, content: 'recovered without meta', tokens: 2 } })
  }
  try {
    await store.sendMessage('recover me'); await waitFor(() => store.generationState?.status === 'completed')
    assert.equal(gets, 1)
    assert.equal(store.activeId, A); assert.equal(store.getActive().guid, A)
    assert.equal(store.getActive().messages.at(-1).content, 'recovered without meta')
  } finally { globalThis.fetch = originalFetch }
})

test('disconnect recovers by GET and appends only the authoritative suffix once', async () => {
  const store = useChatStore(); useSettingsStore().selectedModelId = 'fixture-model'
  store.conversations = [{ ...summary(A), messages: [] }]; store.activeId = A
  const originalFetch = globalThis.fetch; let generationId; let gets = 0
  globalThis.fetch = async (url, options = {}) => {
    if ((options.method || 'GET') === 'POST') {
      generationId = JSON.parse(options.body).generation_id
      return sseResponse([
        `event: meta\ndata: ${JSON.stringify({ schema: 'platform-chat-sse.v2', generation_id: generationId, conversation_guid: A, models: ['fixture-model'] })}\n\n`,
        `event: delta\ndata: ${JSON.stringify({ generation_id: generationId, model: 'fixture-model', seq: 1, delta: 'Hel' })}\n\n`,
      ].join(''))
    }
    gets += 1
    return jsonResponse({ generation_id: generationId, status: 'completed', mode: 'single', conversation_guid: A, total_tokens_used: 9, result: { model: 'fixture-model', status: 'completed', assistant_message_guid: B, content: 'Hello', tokens: 2 } })
  }
  try {
    await store.sendMessage('hello'); await waitFor(() => store.generationState?.status === 'completed')
    assert.equal(gets, 1)
    assert.equal(store.getActive().messages.at(-1).content, 'Hello')
    assert.equal(store.getActive().messages.at(-1).tokens, 2)
    assert.equal(store.getActive().messages.at(-1).content.includes('HelHel'), false)
  } finally { globalThis.fetch = originalFetch }
})

test('authoritative prefix mismatch fails closed and never persists assistant partial or error text', async () => {
  const store = useChatStore(); useSettingsStore().selectedModelId = 'fixture-model'
  store.conversations = [{ ...summary(A), messages: [] }]; store.activeId = A
  const originalFetch = globalThis.fetch; let generationId
  globalThis.fetch = async (_url, options = {}) => {
    if ((options.method || 'GET') === 'POST') {
      generationId = JSON.parse(options.body).generation_id
      return sseResponse(`event: meta\ndata: ${JSON.stringify({ schema: 'platform-chat-sse.v2', generation_id: generationId, conversation_guid: A, models: ['fixture-model'] })}\n\nevent: delta\ndata: ${JSON.stringify({ generation_id: generationId, model: 'fixture-model', seq: 1, delta: 'safe partial' })}\n\n`)
    }
    return jsonResponse({ generation_id: generationId, status: 'completed', mode: 'single', conversation_guid: A, total_tokens_used: 1, result: { model: 'fixture-model', status: 'completed', assistant_message_guid: B, content: 'different', tokens: 1 } })
  }
  try {
    await store.sendMessage('hello'); await waitFor(() => store.generationState?.status === 'failed')
    const assistant = store.getActive().messages.at(-1)
    assert.equal(assistant.content.includes('请求未完成'), false)
    assert.equal(assistant.content.includes('错误'), false)
    assert.equal(writes.some(([, value]) => value.includes('safe partial') || value.includes('different')), false)
    globalThis.fetch = async (_url, options) => {
      const body = JSON.parse(options.body); const id = body.generation_id
      return sseResponse(`event: meta\ndata: ${JSON.stringify({ schema: 'platform-chat-sse.v2', generation_id: id, conversation_guid: A, models: ['fixture-model'] })}\n\nevent: delta\ndata: ${JSON.stringify({ generation_id: id, model: 'fixture-model', seq: 1, delta: 'retry answer' })}\n\nevent: model_done\ndata: ${JSON.stringify({ generation_id: id, model: 'fixture-model', last_seq: 1 })}\n\nevent: done\ndata: ${JSON.stringify({ generation_id: id, status: 'completed', conversation_guid: A, tokens: 1, total_tokens_used: 1 })}\n\n`)
    }
    await store.sendMessage('retry question'); await waitFor(() => store.generationState?.status === 'completed')
    assert.equal(store.getActive().messages.some(message => message.role === 'user' && message.content === 'hello'), true)
    assert.deepEqual(store.getActive().messages.slice(-2).map(message => message.content), ['retry question', 'retry answer'])
  } finally { globalThis.fetch = originalFetch }
})

test('compare keeps a failed model separate while its sibling completes in requested order', async () => {
  const store = useChatStore(); const settings = useSettingsStore()
  settings.compareMode = true; settings.compareModelIds = ['model-a', 'model-b']
  store.conversations = [{ ...summary(A), messages: [] }]; store.activeId = A
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (_url, options) => {
    const id = JSON.parse(options.body).generation_id
    return sseResponse([
      `event: meta\ndata: ${JSON.stringify({ schema: 'platform-chat-sse.v2', generation_id: id, conversation_guid: A, models: ['model-a', 'model-b'] })}\n\n`,
      `event: delta\ndata: ${JSON.stringify({ generation_id: id, model: 'model-a', seq: 1, delta: 'works' })}\n\n`,
      `event: model_error\ndata: ${JSON.stringify({ generation_id: id, model: 'model-b', code: 'timeout' })}\n\n`,
      `event: model_done\ndata: ${JSON.stringify({ generation_id: id, model: 'model-a', last_seq: 1 })}\n\n`,
      `event: done\ndata: ${JSON.stringify({ generation_id: id, status: 'completed', conversation_guid: A, total_tokens_used: 1, models: { 'model-a': { status: 'completed', tokens: 1 }, 'model-b': { status: 'failed', code: 'timeout' } } })}\n\n`,
    ].join(''))
  }
  try {
    await store.sendMessage('compare'); await waitFor(() => store.generationState?.status === 'completed')
    const assistant = store.getActive().messages.at(-1)
    assert.deepEqual(assistant.models, ['model-a', 'model-b'])
    assert.equal(assistant.replies['model-a'], 'works'); assert.equal(assistant.replies['model-b'], '')
    assert.deepEqual(assistant.modelStates['model-b'], { status: 'failed', code: 'timeout' })
  } finally { globalThis.fetch = originalFetch }
})

test('compare completion keeps failed sibling partial only in the display overlay', async () => {
  const store = useChatStore(); const settings = useSettingsStore()
  settings.compareMode = true; settings.compareModelIds = ['model-a', 'model-b']
  store.conversations = [{ ...summary(A), messages: [] }]; store.activeId = A
  const originalFetch = globalThis.fetch; const bodies = []; let requestNumber = 0
  globalThis.document.visibilityState = 'hidden'
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body); bodies.push(body); requestNumber += 1
    const id = body.generation_id
    if (requestNumber === 1) {
      const encoder = new TextEncoder()
      return new Response(new ReadableStream({ async start(controller) {
        controller.enqueue(encoder.encode([
          `event: meta\ndata: ${JSON.stringify({ schema: 'platform-chat-sse.v2', generation_id: id, conversation_guid: A, models: ['model-a', 'model-b'] })}\n\n`,
          `event: delta\ndata: ${JSON.stringify({ generation_id: id, model: 'model-a', seq: 1, delta: 'authoritative success' })}\n\n`,
          `event: delta\ndata: ${JSON.stringify({ generation_id: id, model: 'model-b', seq: 1, delta: 'failed secret partial' })}\n\n`,
        ].join('')))
        await new Promise(resolve => setTimeout(resolve, 25))
        controller.enqueue(encoder.encode([
          `event: model_error\ndata: ${JSON.stringify({ generation_id: id, model: 'model-b', code: 'timeout' })}\n\n`,
          `event: model_done\ndata: ${JSON.stringify({ generation_id: id, model: 'model-a', last_seq: 1 })}\n\n`,
          `event: done\ndata: ${JSON.stringify({ generation_id: id, status: 'completed', conversation_guid: A, total_tokens_used: 1, models: { 'model-a': { status: 'completed', tokens: 1 }, 'model-b': { status: 'failed', code: 'timeout' } } })}\n\n`,
        ].join(''))); controller.close()
      } }), { status: 200, headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' } })
    }
    return sseResponse([
      `event: meta\ndata: ${JSON.stringify({ schema: 'platform-chat-sse.v2', generation_id: id, conversation_guid: A, models: ['model-a', 'model-b'] })}\n\n`,
      `event: delta\ndata: ${JSON.stringify({ generation_id: id, model: 'model-a', seq: 1, delta: 'next a' })}\n\n`,
      `event: delta\ndata: ${JSON.stringify({ generation_id: id, model: 'model-b', seq: 1, delta: 'next b' })}\n\n`,
      `event: model_done\ndata: ${JSON.stringify({ generation_id: id, model: 'model-a', last_seq: 1 })}\n\n`,
      `event: model_done\ndata: ${JSON.stringify({ generation_id: id, model: 'model-b', last_seq: 1 })}\n\n`,
      `event: done\ndata: ${JSON.stringify({ generation_id: id, status: 'completed', conversation_guid: A, total_tokens_used: 2, models: { 'model-a': { status: 'completed', tokens: 1 }, 'model-b': { status: 'completed', tokens: 1 } } })}\n\n`,
    ].join(''))
  }
  try {
    await store.sendMessage('compare'); await waitFor(() => store.generationState?.status === 'completed')
    const assistant = store.getActive().messages.at(-1)
    const failedOverlay = assistant.replies['model-b']
    assert.match(failedOverlay, /^failed secret partia/)
    assert.deepEqual(assistant.modelStates['model-b'], { status: 'failed', code: 'timeout' })
    assert.equal(JSON.stringify(projectConversationForPersistence(store.getActive())).includes(failedOverlay), false)
    assert.equal(JSON.stringify(projectConversationForPersistence(store.getActive())).includes('timeout'), false)
    await store.sendMessage('follow-up'); await waitFor(() => requestNumber === 2 && store.generationState?.status === 'completed')
    assert.equal(JSON.stringify(bodies[1].messages).includes(failedOverlay), false)
    assert.equal(JSON.stringify(bodies[1].messages).includes('timeout'), false)
    assert.equal(JSON.stringify(bodies[1].messages).includes('authoritative success'), true)
  } finally { globalThis.document.visibilityState = undefined; globalThis.fetch = originalFetch }
})

test('cancel aborts local playback, keeps the user message, and converges from authoritative 200', async () => {
  const store = useChatStore(); useSettingsStore().selectedModelId = 'fixture-model'
  store.conversations = [{ ...summary(A), messages: [] }]; store.activeId = A
  const originalFetch = globalThis.fetch; const started = deferred(); let generationId; let cancelCalls = 0
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).endsWith('/cancel')) {
      cancelCalls += 1
      return jsonResponse({ generation_id: generationId, status: 'cancelled', mode: 'single', conversation_guid: null })
    }
    generationId = JSON.parse(options.body).generation_id
    const encoder = new TextEncoder()
    return new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(`event: meta\ndata: ${JSON.stringify({ schema: 'platform-chat-sse.v2', generation_id: generationId, conversation_guid: A, models: ['fixture-model'] })}\n\nevent: delta\ndata: ${JSON.stringify({ generation_id: generationId, model: 'fixture-model', seq: 1, delta: 'partial' })}\n\n`))
        started.resolve()
      },
    }), { status: 200, headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' } })
  }
  try {
    const sending = store.sendMessage('keep me'); await started.promise
    await store.cancelStream(); await sending
    assert.equal(cancelCalls, 1); assert.equal(store.generationState.status, 'cancelled')
    assert.equal(store.getActive().messages.at(-2).content, 'keep me')
    assert.equal(store.getActive().messages.at(-1).viewOnly, true)
  } finally { globalThis.fetch = originalFetch }
})

test('indeterminate cancel performs one cancel POST then recovers only through GET', async () => {
  const store = useChatStore(); useSettingsStore().selectedModelId = 'fixture-model'
  store.conversations = [{ ...summary(A), messages: [] }]; store.activeId = A
  const originalFetch = globalThis.fetch; const started = deferred(); let generationId; let cancelPosts = 0; let gets = 0
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).endsWith('/cancel')) { cancelPosts += 1; throw new TypeError('ambiguous network') }
    if ((options.method || 'GET') === 'GET') {
      gets += 1
      return jsonResponse({ generation_id: generationId, status: 'cancelled', mode: 'single', conversation_guid: null })
    }
    generationId = JSON.parse(options.body).generation_id; started.resolve()
    return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true }))
  }
  try {
    const sending = store.sendMessage('cancel me'); await started.promise
    await store.cancelStream(); await sending
    assert.equal(cancelPosts, 1); assert.equal(gets, 1)
    assert.equal(store.generationState.status, 'cancelled')
  } finally { globalThis.fetch = originalFetch }
})

test('generation projection preserves receiving and draining while transport phase stays separate', async () => {
  const store = useChatStore(); useSettingsStore().selectedModelId = 'fixture-model'
  store.conversations = [{ ...summary(A), messages: [] }]; store.activeId = A
  const originalFetch = globalThis.fetch; const metaSent = deferred(); const sendDone = deferred()
  globalThis.document.visibilityState = 'visible'
  globalThis.fetch = async (_url, options) => {
    const id = JSON.parse(options.body).generation_id
    const encoder = new TextEncoder()
    return new Response(new ReadableStream({ async start(controller) {
      controller.enqueue(encoder.encode(`event: meta\ndata: ${JSON.stringify({ schema: 'platform-chat-sse.v2', generation_id: id, conversation_guid: A, models: ['fixture-model'] })}\n\nevent: delta\ndata: ${JSON.stringify({ generation_id: id, model: 'fixture-model', seq: 1, delta: 'abcdef' })}\n\n`)); metaSent.resolve()
      await sendDone.promise
      controller.enqueue(encoder.encode(`event: model_done\ndata: ${JSON.stringify({ generation_id: id, model: 'fixture-model', last_seq: 1 })}\n\nevent: done\ndata: ${JSON.stringify({ generation_id: id, status: 'completed', conversation_guid: A, tokens: 1, total_tokens_used: 1 })}\n\n`)); controller.close()
    } }), { status: 200, headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' } })
  }
  try {
    const sending = store.sendMessage('state'); await metaSent.promise; await waitFor(() => store.generationState?.status === 'receiving')
    assert.equal(store.generationState.phase, 'streaming')
    sendDone.resolve(); await sending
    assert.equal(store.generationState.status, 'draining'); assert.equal(store.generationState.phase, 'streaming')
    await waitFor(() => store.generationState?.status === 'completed')
  } finally { sendDone.resolve(); globalThis.document.visibilityState = undefined; globalThis.fetch = originalFetch }
})

test('identity invalidation makes late stream callbacks unable to write into the next user store', async () => {
  const store = useChatStore(); useSettingsStore().selectedModelId = 'fixture-model'
  store.conversations = [{ ...summary(A), messages: [] }]; store.activeId = A
  const originalFetch = globalThis.fetch; const started = deferred(); let release
  globalThis.fetch = async (_url, options) => {
    const id = JSON.parse(options.body).generation_id
    await new Promise(resolve => { release = resolve; started.resolve() })
    return sseResponse(`event: meta\ndata: ${JSON.stringify({ schema: 'platform-chat-sse.v2', generation_id: id, conversation_guid: A, models: ['fixture-model'] })}\n\nevent: delta\ndata: ${JSON.stringify({ generation_id: id, model: 'fixture-model', seq: 1, delta: 'late secret' })}\n\n`)
  }
  try {
    const sending = store.sendMessage('old'); await started.promise
    authSession.clearSession()
    authSession.setSession({ accessToken: 'next-account', user: { guid: '2', username: 'next', nickname: null, role: 'user', status: 'active' } })
    store.conversations = [{ ...summary(B), messages: [] }]; store.activeId = B
    release(); await sending; await new Promise(resolve => setTimeout(resolve, 25))
    assert.equal(store.activeId, B); assert.equal(store.getActive().messages.length, 0)
    assert.equal(writes.some(([, value]) => value.includes('late secret')), false)
  } finally { release?.(); globalThis.fetch = originalFetch }
})

test('session-local generation metadata resumes through authoritative GET without storing partial content', async () => {
  const store = useChatStore(); store.conversations = [{ ...summary(A), messages: [] }]; store.activeId = A
  const generationId = '123e4567-e89b-42d3-a456-426614174000'
  sessionStorage.setItem('llm_platform_active_generation_v2', JSON.stringify({ generationId, mode: 'single', models: ['fixture-model'], conversationGuid: A, messageKey: 'resume-message', ownerGuid: '1', ownerEpoch: authSession.capture().epoch }))
  const originalFetch = globalThis.fetch; const response = deferred(); const started = deferred(); let followUpBody
  route = ({ url }) => {
    if (url !== `${listPath}/${A}`) throw new Error(`Unexpected history request: ${url}`)
    return { ...summary(A), messages: [
      { guid: C, role: 'user', content: 'original prompt', model: 'fixture-model', tokens: 0, created_at: 1 },
      { guid: B, role: 'assistant', content: 'restored', model: 'fixture-model', tokens: 2, created_at: 2 },
    ] }
  }
  globalThis.fetch = async (_url, options = {}) => {
    if (!options.body) { started.resolve(); return response.promise }
    followUpBody = JSON.parse(options.body); const id = followUpBody.generation_id
    return sseResponse(`event: meta\ndata: ${JSON.stringify({ schema: 'platform-chat-sse.v2', generation_id: id, conversation_guid: A, models: ['fixture-model'] })}\n\nevent: delta\ndata: ${JSON.stringify({ generation_id: id, model: 'fixture-model', seq: 1, delta: 'follow-up answer' })}\n\nevent: model_done\ndata: ${JSON.stringify({ generation_id: id, model: 'fixture-model', last_seq: 1 })}\n\nevent: done\ndata: ${JSON.stringify({ generation_id: id, status: 'completed', conversation_guid: A, tokens: 1, total_tokens_used: 3 })}\n\n`)
  }
  try {
    const resuming = store.resumePendingGeneration(); await started.promise
    assert.equal(store.getActive().messages.at(-1).transientAttempt, generationId)
    response.resolve(jsonResponse({ generation_id: generationId, status: 'completed', mode: 'single', conversation_guid: A, total_tokens_used: 2, result: { model: 'fixture-model', status: 'completed', assistant_message_guid: B, content: 'restored', tokens: 2 } }))
    assert.equal(await resuming, true)
    await waitFor(() => store.generationState?.status === 'completed')
    assert.equal(store.getActive().messages.at(-1).content, 'restored')
    assert.equal(sessionStorage.getItem('llm_platform_active_generation_v2'), null)
    useSettingsStore().selectedModelId = 'fixture-model'
    await store.sendMessage('follow-up'); await waitFor(() => store.generationState?.status === 'completed')
    assert.deepEqual(followUpBody.messages.map(message => message.role), ['user', 'assistant', 'user'])
    assert.deepEqual(followUpBody.messages.map(message => message.content), ['original prompt', 'restored', 'follow-up'])
  } finally { globalThis.fetch = originalFetch }
})

test('recovered compare matches the exact tail attempt and preserves per-assistant tokens while accounting once', async () => {
  const store = useChatStore(); store.conversations = [{ ...summary(A), messages: [] }]; store.activeId = A
  const generationId = '123e4567-e89b-42d3-a456-426614174000'
  sessionStorage.setItem('llm_platform_active_generation_v2', JSON.stringify({ generationId, mode: 'compare', models: ['model-a', 'model-b', 'model-c'], conversationGuid: A, messageKey: 'resume-compare', ownerGuid: '1', ownerEpoch: authSession.capture().epoch }))
  route = () => ({ ...summary(A), messages: [
    { guid: '11', role: 'user', content: 'older prompt', model: 'model-old', tokens: 0, created_at: 1 },
    { guid: '12', role: 'assistant', content: 'older answer', model: 'model-old', tokens: 1, created_at: 2 },
    { guid: C, role: 'user', content: 'compare prompt', model: 'model-a', tokens: 0, created_at: 3 },
    { guid: B, role: 'assistant', content: 'answer a', model: 'model-a', tokens: 2, created_at: 4 },
    { guid: D, role: 'assistant', content: 'answer c', model: 'model-c', tokens: 5, created_at: 5 },
  ] })
  const completed = { generation_id: generationId, status: 'completed', mode: 'compare', conversation_guid: A, total_tokens_used: 101, results: [
    { model: 'model-a', status: 'completed', assistant_message_guid: B, content: 'answer a', tokens: 2 },
    { model: 'model-b', status: 'failed', code: 'timeout' },
    { model: 'model-c', status: 'completed', assistant_message_guid: D, content: 'answer c', tokens: 5 },
  ] }
  const originalFetch = globalThis.fetch; globalThis.fetch = async () => jsonResponse(completed)
  const user = useUserStore(); const usageCalls = []; user.applyTokensUsed = (...args) => usageCalls.push(args)
  try {
    assert.equal(await store.resumePendingGeneration(), true)
    await waitFor(() => store.generationState?.status === 'completed')
    const assistants = store.getActive().messages.filter(message => message.role === 'assistant').slice(-2)
    assert.deepEqual(assistants.map(message => [message.guid, message.model, message.content, message.tokens]), [
      [B, 'model-a', 'answer a', 2],
      [D, 'model-c', 'answer c', 5],
    ])
    assert.deepEqual(usageCalls, [[7, 101]])
    assert.equal(await store.resumePendingGeneration(), false)
    assert.deepEqual(usageCalls, [[7, 101]])
  } finally { globalThis.fetch = originalFetch }
})

test('recovered completion rejects any non-exact or non-tail authoritative attempt graph', async () => {
  const generationId = '123e4567-e89b-42d3-a456-426614174000'
  const baseResult = () => ({ generation_id: generationId, status: 'completed', mode: 'compare', conversation_guid: A, total_tokens_used: 7, results: [
    { model: 'model-a', status: 'completed', assistant_message_guid: B, content: 'answer a', tokens: 2 },
    { model: 'model-b', status: 'completed', assistant_message_guid: D, content: 'answer b', tokens: 5 },
  ] })
  const baseMessages = () => [
    { guid: C, role: 'user', content: 'target prompt', model: 'model-a', tokens: 0, created_at: 1 },
    { guid: B, role: 'assistant', content: 'answer a', model: 'model-a', tokens: 2, created_at: 2 },
    { guid: D, role: 'assistant', content: 'answer b', model: 'model-b', tokens: 5, created_at: 3 },
  ]
  const cases = [
    ['old result followed by a newer round', result => result, messages => [...messages, { guid: '21', role: 'user', content: 'new prompt', model: 'model-a', tokens: 0, created_at: 4 }, { guid: '22', role: 'assistant', content: 'new answer', model: 'model-a', tokens: 1, created_at: 5 }]],
    ['wrong model', result => result, messages => { messages[1].model = 'wrong-model'; return messages }],
    ['wrong content', result => result, messages => { messages[1].content = 'wrong content'; return messages }],
    ['wrong tokens', result => result, messages => { messages[1].tokens = 99; return messages }],
    ['wrong assistant order', result => result, messages => [messages[0], messages[2], messages[1]]],
    ['duplicate result and message GUID', result => { result.results[1].assistant_message_guid = B; return result }, messages => { messages[2].guid = B; return messages }],
    ['missing result GUID in history', result => result, messages => messages.slice(0, 2)],
    ['assistant block not directly adjacent to its user', result => result, messages => [messages[0], { guid: '31', role: 'system', content: 'boundary', model: null, tokens: 0, created_at: 2 }, ...messages.slice(1)]],
  ]
  const originalFetch = globalThis.fetch
  try {
    for (const [name, mutateResult, mutateMessages] of cases) {
      setActivePinia(createPinia())
      const store = useChatStore(); store.conversations = [{ ...summary(A), messages: [] }]; store.activeId = A
      sessionStorage.setItem('llm_platform_active_generation_v2', JSON.stringify({ generationId, mode: 'compare', models: ['model-a', 'model-b'], conversationGuid: A, messageKey: `resume-${name}`, ownerGuid: '1', ownerEpoch: authSession.capture().epoch }))
      const result = mutateResult(baseResult()); const messages = mutateMessages(baseMessages())
      route = () => ({ ...summary(A), messages })
      globalThis.fetch = async () => jsonResponse(result)
      assert.equal(await store.resumePendingGeneration(), true, name)
      await waitFor(() => store.streaming === false)
      assert.notEqual(sessionStorage.getItem('llm_platform_active_generation_v2'), null, name)
      assert.equal(store.getActive().messages.some(message => message.guid === B), false, name)
      assert.notEqual(store.generationState?.status, 'completed', name)
    }
  } finally { globalThis.fetch = originalFetch }
})

test('resume completed history reload failure keeps the orphan assistant view-only and recoverable', async () => {
  const store = useChatStore(); store.conversations = [{ ...summary(A), messages: [] }]; store.activeId = A
  const generationId = '123e4567-e89b-42d3-a456-426614174000'
  sessionStorage.setItem('llm_platform_active_generation_v2', JSON.stringify({ generationId, mode: 'single', models: ['fixture-model'], conversationGuid: A, messageKey: 'resume-message', ownerGuid: '1', ownerEpoch: authSession.capture().epoch }))
  route = () => { throw httpError(500) }
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => jsonResponse({ generation_id: generationId, status: 'completed', mode: 'single', conversation_guid: A, total_tokens_used: 2, result: { model: 'fixture-model', status: 'completed', assistant_message_guid: B, content: 'orphan result', tokens: 2 } })
  try {
    await store.resumePendingGeneration()
    await waitFor(() => store.getActive().messages.at(-1)?.content === 'orphan result')
    const orphan = store.getActive().messages.at(-1)
    assert.equal(orphan.content, 'orphan result')
    assert.equal(orphan.viewOnly, true)
    assert.equal(orphan.transientAttempt, generationId)
    assert.notEqual(sessionStorage.getItem('llm_platform_active_generation_v2'), null)
    assert.notEqual(store.generationState?.status, 'completed')
    route = () => ({ ...summary(A), messages: [
      { guid: C, role: 'user', content: 'recovered prompt', model: 'fixture-model', tokens: 0, created_at: 1 },
      { guid: B, role: 'assistant', content: 'orphan result', model: 'fixture-model', tokens: 2, created_at: 2 },
    ] })
    assert.equal(await store.resumePendingGeneration(), true)
    await waitFor(() => store.generationState?.status === 'completed')
    assert.deepEqual(store.getActive().messages.map(message => message.content), ['recovered prompt', 'orphan result'])
  } finally { globalThis.fetch = originalFetch }
})

test('resume rejects mismatched owner metadata before UI mutation or GET', async () => {
  const store = useChatStore(); store.conversations = [{ ...summary(A), messages: [] }]; store.activeId = A
  sessionStorage.setItem('llm_platform_active_generation_v2', JSON.stringify({ generationId: '123e4567-e89b-42d3-a456-426614174000', mode: 'single', models: ['fixture-model'], conversationGuid: A, messageKey: 'foreign', ownerGuid: '2', ownerEpoch: authSession.capture().epoch }))
  const originalFetch = globalThis.fetch; let requests = 0
  globalThis.fetch = async () => { requests += 1; throw new Error('must not GET') }
  try {
    assert.equal(await store.resumePendingGeneration(), false); assert.equal(requests, 0)
    assert.equal(store.getActive().messages.length, 0); assert.equal(sessionStorage.getItem('llm_platform_active_generation_v2'), null)
  } finally { globalThis.fetch = originalFetch }
})

test('server refresh discards transient attempts instead of replacing authoritative history', async () => {
  const store = useChatStore()
  store.conversations = [{ ...summary(A), messages: [
    { localKey: 'temporary-user', role: 'user', content: 'temporary', transientAttempt: 'gen' },
    { localKey: 'temporary-assistant', role: 'assistant', content: 'partial', generationStatus: 'failed', transientAttempt: 'gen' },
  ] }]
  store.activeId = A
  route = () => detail(A)
  await store.refreshActiveConversation()
  assert.deepEqual(store.getActive().messages.map(message => message.content), [`Message ${A}`])
})

test('next POST excludes a failed transient attempt while retaining valid history and current user once', async () => {
  const store = useChatStore(); useSettingsStore().selectedModelId = 'fixture-model'
  store.conversations = [{ ...summary(A), messages: [
    { localKey: 'old-user', role: 'user', content: 'valid question' },
    { localKey: 'old-assistant', role: 'assistant', content: 'valid answer' },
    { localKey: 'failed-user', role: 'user', content: 'failed question', transientAttempt: 'old-gen' },
    { localKey: 'failed-assistant', role: 'assistant', content: 'failed partial', generationStatus: 'failed', transientAttempt: 'old-gen' },
  ] }]; store.activeId = A
  const originalFetch = globalThis.fetch; let sent
  globalThis.fetch = async (_url, options) => {
    sent = JSON.parse(options.body); const id = sent.generation_id
    return sseResponse(`event: meta\ndata: ${JSON.stringify({ schema: 'platform-chat-sse.v2', generation_id: id, conversation_guid: A, models: ['fixture-model'] })}\n\nevent: delta\ndata: ${JSON.stringify({ generation_id: id, model: 'fixture-model', seq: 1, delta: 'new answer' })}\n\nevent: model_done\ndata: ${JSON.stringify({ generation_id: id, model: 'fixture-model', last_seq: 1 })}\n\nevent: done\ndata: ${JSON.stringify({ generation_id: id, status: 'completed', conversation_guid: A, tokens: 1, total_tokens_used: 1 })}\n\n`)
  }
  try {
    await store.sendMessage('current question'); await waitFor(() => store.generationState?.status === 'completed')
    assert.deepEqual(sent.messages.map(message => message.content), ['valid question', 'valid answer', 'current question'])
    assert.deepEqual(store.getActive().messages.slice(-2).map(message => message.content), ['current question', 'new answer'])
  } finally { globalThis.fetch = originalFetch }
})

test('switching conversations detaches local generation without cancel POST and drops transient attempt UI', async () => {
  const store = useChatStore(); useSettingsStore().selectedModelId = 'fixture-model'
  store.conversations = [{ ...summary(A), messages: [] }, { ...summary(B), messages: [] }]; store.activeId = A
  const originalFetch = globalThis.fetch; const started = deferred(); let cancelCalls = 0; let aborted = 0
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).endsWith('/cancel')) { cancelCalls += 1; throw new Error('must not cancel') }
    const id = JSON.parse(options.body).generation_id
    const encoder = new TextEncoder()
    return new Response(new ReadableStream({ start(controller) { controller.enqueue(encoder.encode(`event: meta\ndata: ${JSON.stringify({ schema: 'platform-chat-sse.v2', generation_id: id, conversation_guid: A, models: ['fixture-model'] })}\n\nevent: delta\ndata: ${JSON.stringify({ generation_id: id, model: 'fixture-model', seq: 1, delta: 'secret partial' })}\n\n`)); started.resolve() }, cancel() { aborted += 1 } }), { status: 200, headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' } })
  }
  try {
    const sending = store.sendMessage('old question'); await started.promise
    await store.selectConversation(B); await sending
    assert.equal(cancelCalls, 0); assert.equal(aborted, 1)
    assert.equal(store.activeId, B); assert.equal(store.conversations.find(item => item.guid === A).messages.length, 0)
    assert.notEqual(sessionStorage.getItem('llm_platform_active_generation_v2'), null)
    const recovery = JSON.parse(sessionStorage.getItem('llm_platform_active_generation_v2'))
    assert.deepEqual(Object.keys(recovery).sort(), ['conversationGuid', 'generationId', 'messageKey', 'mode', 'models', 'ownerEpoch', 'ownerGuid'])
    assert.equal(JSON.stringify(recovery).includes('secret partial'), false)
  } finally { globalThis.fetch = originalFetch }
})

test('switching during a 202 cancel aborts its controller before polling or late mutation', async () => {
  const store = useChatStore(); useSettingsStore().selectedModelId = 'fixture-model'
  store.conversations = [{ ...summary(A), messages: [] }, { ...summary(B), messages: [] }]; store.activeId = A
  const originalFetch = globalThis.fetch; const streamStarted = deferred(); const cancelStarted = deferred()
  let generationId; let cancelPosts = 0; let gets = 0; let cancelSignal
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).endsWith('/cancel')) {
      cancelPosts += 1; cancelSignal = options.signal; cancelStarted.resolve()
      return jsonResponse({ generation_id: generationId, status: 'cancelling', mode: 'single', conversation_guid: null }, 202, { 'Retry-After': '1' })
    }
    if ((options.method || 'GET') === 'GET') { gets += 1; throw new Error('cancel polling must be detached') }
    generationId = JSON.parse(options.body).generation_id; streamStarted.resolve()
    return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true }))
  }
  try {
    const sending = store.sendMessage('cancel then switch'); await streamStarted.promise
    const cancelling = store.cancelStream(); await cancelStarted.promise
    await store.selectConversation(B); await Promise.all([sending, cancelling])
    assert.equal(cancelPosts, 1); assert.equal(gets, 0); assert.equal(cancelSignal.aborted, true)
    assert.equal(store.activeId, B); assert.equal(store.generationState, null)
    await new Promise(resolve => setTimeout(resolve, 10))
    assert.equal(store.activeId, B); assert.equal(gets, 0)
  } finally { globalThis.fetch = originalFetch }
})

test('logout during a 202 cancel aborts its controller before polling or late mutation', async () => {
  const store = useChatStore(); useSettingsStore().selectedModelId = 'fixture-model'
  store.conversations = [{ ...summary(A), messages: [] }]; store.activeId = A
  const originalFetch = globalThis.fetch; const streamStarted = deferred(); const cancelStarted = deferred()
  let generationId; let cancelPosts = 0; let gets = 0; let cancelSignal
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).endsWith('/cancel')) {
      cancelPosts += 1; cancelSignal = options.signal; cancelStarted.resolve()
      return jsonResponse({ generation_id: generationId, status: 'cancelling', mode: 'single', conversation_guid: null }, 202, { 'Retry-After': '1' })
    }
    if ((options.method || 'GET') === 'GET') { gets += 1; throw new Error('cancel polling must stop after logout') }
    generationId = JSON.parse(options.body).generation_id; streamStarted.resolve()
    return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true }))
  }
  try {
    const sending = store.sendMessage('cancel then logout'); await streamStarted.promise
    const cancelling = store.cancelStream(); await cancelStarted.promise
    authSession.clearSession(); await Promise.all([sending, cancelling])
    assert.equal(cancelPosts, 1); assert.equal(gets, 0); assert.equal(cancelSignal.aborted, true)
    assert.deepEqual(store.conversations, []); assert.equal(store.activeId, null); assert.equal(store.generationState, null)
    await new Promise(resolve => setTimeout(resolve, 10))
    assert.equal(gets, 0); assert.deepEqual(store.conversations, [])
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
