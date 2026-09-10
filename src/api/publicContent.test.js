import test from 'node:test'
import assert from 'node:assert/strict'
import { createPublicContentClient, PublicContentError } from './publicContent.js'
import { createPublicContentState } from '../stores/publicContent.js'

const headers = { ETag: '"abc"', 'X-Public-Release-Version': '7', 'Cache-Control': 'public, max-age=60, stale-while-revalidate=300' }
const response = (body, options = {}) => new Response(body === null ? null : JSON.stringify(body), { status: options.status || 200, headers: { ...headers, ...(options.headers || {}) } })
const documentBody = { document: '# hello', release_version: 7 }

test('uses all seven exact public paths, query encoding, conditional headers and optional auth', async () => {
  const calls = []
  const client = createPublicContentClient({ fetchImpl: async (url, options) => { calls.push([url, options]); return response(url.includes('/models/') ? { model: { model_key: 'key', display_name: 'M', provider: 'P', capabilities: [], context_window: 1, price_visibility: 'authenticated_only', release_version: 7 } } : url.includes('/models?') ? { items: [], page: 1, page_size: 20, total: 0, release_version: 7 } : url.endsWith('/site') ? { content_release_version: 7, price_release_version: 7, price_visibility: 'authenticated_only' } : documentBody) }, getAuthorization: () => 'Bearer token' })
  await client.getSite(); await client.getHome(); await client.getModels({ search: 'a&b', provider: 'P', capability: 'chat', page: 1, pageSize: 20 }, { etag: '"old"', authenticated: true }); await client.getModel('key'); await client.getAbout(); await client.getTerms(); await client.getPrivacy()
  assert.deepEqual(calls.map(c => c[0]), ['/api/v1/public/site', '/api/v1/public/home', '/api/v1/public/models?search=a%26b&provider=P&capability=chat&page=1&page_size=20', '/api/v1/public/models/key', '/api/v1/public/pages/about', '/api/v1/public/pages/terms', '/api/v1/public/pages/privacy'])
  assert.equal(calls[2][1].headers['If-None-Match'], '"old"'); assert.equal(calls[2][1].headers.Authorization, 'Bearer token')
  assert.equal(calls[0][1].headers.Authorization, undefined)
})

test('304 reuses cached value and retains ETag and release version', async () => {
  const cached = { data: documentBody, etag: '"abc"', releaseVersion: 7 }
  const client = createPublicContentClient({ fetchImpl: async () => new Response(null, { status: 304 }) })
  assert.deepEqual(await client.getHome({ cached }), { ...cached, notModified: true })
})

test('normalizes status/network errors without leaking response bodies and preserves aborts', async () => {
  for (const [status, code] of [[404, 'not_found'], [410, 'gone'], [503, 'unavailable']]) {
    const client = createPublicContentClient({ fetchImpl: async () => response({ error: { message: 'secret body' } }, { status }) })
    await assert.rejects(() => client.getHome(), e => e instanceof PublicContentError && e.code === code && !e.message.includes('secret'))
  }
  const abort = new DOMException('aborted', 'AbortError')
  await assert.rejects(() => createPublicContentClient({ fetchImpl: async () => { throw abort } }).getHome(), e => e === abort)
  await assert.rejects(() => createPublicContentClient({ fetchImpl: async () => { throw new Error('host secret') } }).getHome(), e => e.code === 'network_error' && e.message === 'public_content_network_error')
})

test('store distinguishes empty/error/not-found/gone and suppresses stale request completion', async () => {
  let resolveOld
  const old = new Promise(resolve => { resolveOld = resolve })
  let call = 0
  const state = createPublicContentState({ api: { getModels: async () => ++call === 1 ? old : { data: { items: [], page: 1, pageSize: 20, total: 0, releaseVersion: 7 }, etag: 'b', releaseVersion: 7 } } })
  const first = state.loadModels(); const second = state.loadModels(); await second; resolveOld({ data: { items: [{ modelKey: 'late', releaseVersion: 7 }], page: 1, pageSize: 20, total: 1, releaseVersion: 7 }, etag: 'a', releaseVersion: 7 }); await first
  assert.equal(state.value.models.status, 'ready-empty'); assert.deepEqual(state.value.models.data.items, [])
  for (const [code, expected] of [['not_found', 'not_found'], ['gone', 'gone'], ['unavailable', 'error']]) { state.setApi({ getModels: async () => { throw Object.assign(new Error(), { code }) } }); await state.loadModels(); assert.equal(state.value.models.status, expected) }
})

test('store partitions auth representations and rejects mixed publication generations', async () => {
  const state = createPublicContentState({ api: { getSite: async () => ({ data: { contentReleaseVersion: 7, priceReleaseVersion: 7, priceVisibility: 'visible' }, etag: 's', releaseVersion: 7 }), getHome: async () => ({ data: { document: 'x', releaseVersion: 8 }, etag: 'h', releaseVersion: 8 }) } })
  await state.loadSite()
  await assert.rejects(() => state.loadHome(), /mixed_publication_generation/)
  assert.equal(state.value.home.status, 'error')
  assert.equal(Object.keys(state.value.cache).some(key => key.includes('token')), false)
})

test('site retains independently versioned content and pricing bound by the response generation', async () => {
  const client = createPublicContentClient({ fetchImpl: async () => response({ content_release_version: 5, price_release_version: 7, price_visibility: 'visible' }) })
  const result = await client.getSite()
  assert.deepEqual(result.data, { contentReleaseVersion: 5, priceReleaseVersion: 7, priceVisibility: 'visible' })
  assert.equal(result.releaseVersion, 7)
})

test('explicit cancellation returns the store to its prior stable state', async () => {
  const state = createPublicContentState({ api: { getHome: (_options) => new Promise((_resolve, reject) => _options.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))) } })
  const pending = state.loadHome()
  assert.equal(state.value.home.status, 'loading')
  state.cancel('home'); await pending
  assert.equal(state.value.home.status, 'idle')
})
