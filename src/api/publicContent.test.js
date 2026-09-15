import test from 'node:test'
import assert from 'node:assert/strict'
import { createPublicContentClient, PublicContentError } from './publicContent.js'
import { createPublicContentState } from '../stores/publicContent.js'

const headers = { ETag: '"abc"', 'X-Public-Release-Version': '7', 'Cache-Control': 'public, max-age=60, stale-while-revalidate=300' }
const response = (body, options = {}) => new Response(body === null ? null : JSON.stringify(body), { status: options.status || 200, headers: { ...headers, ...(options.headers || {}) } })
const documentBody = { document: '# hello', release_version: 7 }

test('uses all seven exact public paths, query encoding, conditional headers and optional auth', async () => {
  const calls = []
  const client = createPublicContentClient({ fetchImpl: async (url, options) => { calls.push([url, options]); const body = url.includes('/models/') ? { model: { model_key: 'key', display_name: 'M', provider: 'P', capabilities: [], context_window: 1, price_visibility: 'authenticated_only', release_version: 7, pricing_type: 'token', endpoint_types: ['responses'], updated_at: '2026-09-10T00:00:00Z' } } : url.includes('/models?') ? { items: [], page: 1, page_size: 20, total: 0, release_version: 7, facets: { providers: [], capabilities: [], endpoint_types: [], public_display_groups: [] } } : url.endsWith('/site') ? { content_release_version: 7, price_release_version: 7, price_visibility: 'authenticated_only' } : documentBody; return response(body, { headers: { ...(options.headers.Authorization ? { 'Cache-Control': 'private, no-store' } : {}), ...((url.endsWith('/site') || url.includes('/models')) ? { Vary: 'Authorization' } : {}) } }) }, getAuthorization: () => 'Bearer token' })
  await client.getSite(); await client.getHome(); await client.getModels({ search: 'a&b', provider: 'P', capability: 'chat', endpointType: 'responses', publicDisplayGroup: 'featured', pricingType: 'token', sort: 'input_price', order: 'desc', page: 1, pageSize: 20 }, { etag: '"old"', authenticated: true, varyAuthorization: true }); await client.getModel('key'); await client.getAbout(); await client.getTerms(); await client.getPrivacy()
  assert.deepEqual(calls.map(c => c[0]), ['/api/v1/public/site', '/api/v1/public/home', '/api/v1/public/models?search=a%26b&provider=P&capability=chat&endpoint_type=responses&public_display_group=featured&pricing_type=token&sort=input_price&order=desc&page=1&page_size=20', '/api/v1/public/models/key', '/api/v1/public/pages/about', '/api/v1/public/pages/terms', '/api/v1/public/pages/privacy'])
  assert.equal(calls[2][1].headers['If-None-Match'], undefined); assert.equal(calls[2][1].headers.Authorization, 'Bearer token')
  assert.equal(calls[0][1].headers.Authorization, undefined)
})

test('304 reuses cached value and retains ETag and release version', async () => {
  const cached = { data: documentBody, etag: '"abc"', releaseVersion: 7 }
  const client = createPublicContentClient({ fetchImpl: async () => new Response(null, { status: 304 }) })
  assert.deepEqual(await client.getHome({ cached }), { ...cached, notModified: true })
})

test('authenticated responses require private no-store and never use ETag revalidation or 304', async () => {
  const calls = []
  const client = createPublicContentClient({ authenticatedFetch: async (_url, init) => { calls.push(init); return response(documentBody, { headers: { 'Cache-Control': 'private, no-store' } }) } })
  const result = await client.getHome({ authenticated: true, etag: '"old"', cached: { data: documentBody } })
  assert.equal(calls[0].headers['If-None-Match'], undefined); assert.equal(result.etag, undefined)
  const notModified = createPublicContentClient({ authenticatedFetch: async () => new Response(null, { status: 304 }) })
  await assert.rejects(() => notModified.getHome({ authenticated: true, cached: { data: documentBody } }), error => error.code === 'invalid_304')
  const publicForAuth = createPublicContentClient({ authenticatedFetch: async () => response(documentBody) })
  await assert.rejects(() => publicForAuth.getHome({ authenticated: true }), error => error.code === 'invalid_response_headers')
  const privateForAnonymous = createPublicContentClient({ fetchImpl: async () => response(documentBody, { headers: { 'Cache-Control': 'private, no-store' } }) })
  await assert.rejects(() => privateForAnonymous.getHome(), error => error.code === 'invalid_response_headers')
})

test('client and store render private site list detail without retaining authenticated response cache', async () => {
  const calls = []
  const priced = { model_key: 'priced', display_name: 'Priced', provider: 'P', capabilities: [], context_window: 1, price_visibility: 'visible', release_version: 7, pricing_type: 'token', endpoint_types: ['responses'], updated_at: '2026-09-10T00:00:00Z', input_price_usd_per_million_tokens: '1', price_source: 'upstream', price_reviewer: 'root', effective_at: '2026-09-10T00:00:00Z' }
  const facets = { providers: ['P'], capabilities: [], endpoint_types: ['responses'], public_display_groups: [] }
  const client = createPublicContentClient({ authenticatedFetch: async (url, init) => { calls.push([url, init]); const body = url.endsWith('/site') ? { content_release_version: 7, price_release_version: 7, price_visibility: 'authenticated_only' } : url.includes('/models/') ? { model: priced } : { items: [priced], page: 1, page_size: 20, total: 1, release_version: 7, facets }; return response(body, { headers: { 'Cache-Control': 'private, no-store', Vary: 'Authorization' } }) } })
  const state = createPublicContentState({ api: client })
  const auth = { authenticated: true, authContext: { epoch: 'account', generation: 1, permissionRevision: 1, token: 'access' } }
  await state.loadSite(auth); await state.loadModels({}, auth); await state.loadModel('priced', auth); await state.loadModels({}, auth)
  assert.equal(state.value.models.data.items[0].inputPrice, '1'); assert.equal(state.value.details.priced.data.model.modelKey, 'priced')
  assert.deepEqual(state.value.cache, {})
  assert.ok(calls.every(([, init]) => init.headers['If-None-Match'] === undefined))
  const wrongVary = createPublicContentClient({ authenticatedFetch: async () => response({ items: [priced], page: 1, page_size: 20, total: 1, release_version: 7, facets }, { headers: { 'Cache-Control': 'private, no-store' } }) })
  await assert.rejects(() => wrongVary.getModels({}, { authenticated: true, varyAuthorization: true }), error => error.code === 'invalid_response_headers')
})

test('normalizes status/network errors without leaking response bodies and preserves aborts', async () => {
  for (const [status, code] of [[401, 'authentication_required'], [404, 'not_found'], [410, 'gone'], [503, 'unavailable']]) {
    const client = createPublicContentClient({ fetchImpl: async () => response({ error: { message: 'secret body' } }, { status }) })
    await assert.rejects(() => client.getHome(), e => e instanceof PublicContentError && e.code === code && !e.message.includes('secret'))
  }
  const abort = new DOMException('aborted', 'AbortError')
  await assert.rejects(() => createPublicContentClient({ fetchImpl: async () => { throw abort } }).getHome(), e => e === abort)
  await assert.rejects(() => createPublicContentClient({ fetchImpl: async () => { throw new Error('host secret') } }).getHome(), e => e.code === 'network_error' && e.message === 'public_content_network_error')
})

test('list and detail fail closed when priced models omit required provenance', async () => {
  const priced = { model_key: 'priced', display_name: 'Priced', provider: 'P', capabilities: [], context_window: 1, price_visibility: 'visible', release_version: 7, pricing_type: 'token', endpoint_types: ['responses'], updated_at: '2026-09-10T00:00:00Z', input_price_usd_per_million_tokens: '1' }
  const facets = { providers: ['P'], capabilities: [], endpoint_types: ['responses'], public_display_groups: [] }
  const detail = createPublicContentClient({ fetchImpl: async () => response({ model: priced }) })
  await assert.rejects(() => detail.getModel('priced'), error => error.code === 'invalid_response')
  const list = createPublicContentClient({ fetchImpl: async () => response({ items: [priced], page: 1, page_size: 20, total: 1, release_version: 7, facets }) })
  await assert.rejects(() => list.getModels(), error => error.code === 'invalid_response')
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

test('auth to anonymous transition clears authenticated site list and detail before anonymous pending settles', async () => {
  let resolveAnonymous
  const pending = new Promise(resolve => { resolveAnonymous = resolve })
  const authenticatedModel = { modelKey: 'paid', inputPrice: '1', outputPrice: '2', priceVisibility: 'visible', releaseVersion: 7 }
  const redactedModel = { modelKey: 'paid', priceVisibility: 'authenticated_only', releaseVersion: 7 }
  let anonymous = false
  const state = createPublicContentState({ api: {
    getSite: async () => ({ data: { contentReleaseVersion: 5, priceReleaseVersion: 7, priceVisibility: anonymous ? 'authenticated_only' : 'visible' }, etag: 's', releaseVersion: 7, publicationVersions: { content: 5, price: 7 } }),
    getModels: async () => anonymous ? pending : ({ data: { items: [authenticatedModel], page: 1, pageSize: 20, total: 1, releaseVersion: 7 }, etag: 'm-auth', releaseVersion: 7, publicationVersions: { price: 7 } }),
    getModel: async () => ({ data: { model: authenticatedModel, releaseVersion: 7 }, etag: 'd-auth', releaseVersion: 7, publicationVersions: { price: 7 } }),
  } })
  const auth = { authenticated: true, authContext: { epoch: 'user-1', generation: 1, permissionRevision: 1, token: 'secret-1' } }
  await state.loadSite(auth); await state.loadModels({}, auth); await state.loadModel('paid', auth)
  anonymous = true
  const loading = state.loadModels({}, { authenticated: false })
  assert.equal(state.value.models.data, null); assert.deepEqual(state.value.details, {}); assert.equal(state.value.site.data, null)
  resolveAnonymous({ data: { items: [redactedModel], page: 1, pageSize: 20, total: 1, releaseVersion: 7 }, etag: 'm-anon', releaseVersion: 7, publicationVersions: { price: 7 } }); await loading
  assert.equal(state.value.models.data.items[0].inputPrice, undefined)
})

test('anonymous failure and cancel cannot restore an authenticated representation', async () => {
  const paid = { modelKey: 'paid', inputPrice: '1', priceVisibility: 'visible', releaseVersion: 7 }
  let mode = 'auth'
  const state = createPublicContentState({ api: { getModels: async (_filters, options) => {
    if (mode === 'auth') return { data: { items: [paid], page: 1, pageSize: 20, total: 1, releaseVersion: 7 }, etag: 'auth', releaseVersion: 7, publicationVersions: { price: 7 } }
    if (mode === 'fail') throw Object.assign(new Error(), { code: 'unavailable' })
    return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))
  } } })
  await state.loadModels({}, { authenticated: true, authContext: { epoch: 'user-1', generation: 1, permissionRevision: 1, token: 'secret-1' } })
  mode = 'fail'; await state.loadModels({}, { authenticated: false }); assert.equal(state.value.models.data, null); assert.equal(state.value.models.status, 'error')
  mode = 'pending'; const request = state.loadModels({}, { authenticated: true, authContext: { epoch: 'user-2', generation: 1, permissionRevision: 1, token: 'secret-2' } }); state.cancel('models'); await request
  assert.equal(state.value.models.data, null); assert.equal(state.value.models.status, 'idle')
})

test('authenticated identity generation change invalidates every old render response', async () => {
  let resolveOld
  const old = new Promise(resolve => { resolveOld = resolve })
  const state = createPublicContentState({ api: {
    getHome: async () => old,
    getModel: async () => ({ data: { model: { modelKey: 'safe', priceVisibility: 'authenticated_only', releaseVersion: 7 }, releaseVersion: 7 }, etag: 'new', releaseVersion: 7, publicationVersions: { price: 7 } }),
  } })
  const stale = state.loadHome({ authenticated: true, authContext: { epoch: 'same-account', generation: 1, permissionRevision: 1, token: 'old-token' } })
  await state.loadModel('paid', { authenticated: true, authContext: { epoch: 'same-account', generation: 2, permissionRevision: 1, token: 'new-token' } })
  resolveOld({ data: { document: 'private old user content', releaseVersion: 7 }, etag: 'old', releaseVersion: 7, publicationVersions: { content: 7 } }); await stale
  assert.equal(state.value.home.data, null)
  assert.equal(state.value.details.paid.data.model.inputPrice, undefined)
})

test('authenticated loads without an exact auth snapshot fail closed and clear rendered data', async () => {
  const state = createPublicContentState({ api: { getModels: async () => ({ data: { items: [], page: 1, pageSize: 20, total: 0, releaseVersion: 7 }, etag: 'x', releaseVersion: 7, publicationVersions: { price: 7 } }) } })
  const valid = { authenticated: true, authContext: { epoch: 'account-a', generation: 1, permissionRevision: 2, token: 'secret' } }
  await state.loadModels({}, valid)
  for (const authContext of [undefined, null, '[object Object]', {}, { epoch: 'a', generation: 1, permissionRevision: 2 }, { epoch: 'a', generation: -1, permissionRevision: 2, token: 'x' }, { epoch: 'a', generation: 1, permissionRevision: 2, token: 'x', guid: 'secret-guid' }]) {
    await assert.rejects(() => state.loadModels({}, { authenticated: true, authContext }), /invalid_auth_context/)
    assert.equal(state.value.models.data, null)
  }
})

test('distinct object auth snapshots never share ETag or 304 data across identities', async () => {
  const observations = []
  const state = createPublicContentState({ api: { getModels: async (_filters, options) => {
    observations.push({ etag: options.etag, cached: options.cached })
    if (observations.length === 1) return { data: { items: [{ modelKey: 'private-a', inputPrice: '9', releaseVersion: 7 }], page: 1, pageSize: 20, total: 1, releaseVersion: 7 }, etag: 'identity-a', releaseVersion: 7, publicationVersions: { price: 7 } }
    assert.equal(options.etag, undefined); assert.equal(options.cached, undefined)
    return { data: { items: [{ modelKey: 'redacted-b', priceVisibility: 'authenticated_only', releaseVersion: 7 }], page: 1, pageSize: 20, total: 1, releaseVersion: 7 }, etag: 'identity-b', releaseVersion: 7, publicationVersions: { price: 7 } }
  } } })
  await state.loadModels({}, { authenticated: true, authContext: { epoch: 'account-a', generation: 1, permissionRevision: 1, token: 'same-looking-token' } })
  await state.loadModels({}, { authenticated: true, authContext: { epoch: 'account-b', generation: 1, permissionRevision: 1, token: 'same-looking-token' } })
  assert.equal(state.value.models.data.items[0].modelKey, 'redacted-b')
  assert.equal(JSON.stringify(Object.keys(state.value.cache)).includes('same-looking-token'), false)
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

test('query-specific ETags and 304 values cannot cross model filters', async () => {
  const calls = []
  const api = {
    getModels: async (filters, options) => {
      calls.push({ filters, etag: options.etag, cached: options.cached })
      if (filters.search === 'alpha') return { data: { items: [{ modelKey: 'alpha', releaseVersion: 7 }], page: 1, pageSize: 20, total: 1, releaseVersion: 7 }, etag: 'alpha-tag', releaseVersion: 7, publicationVersions: { price: 7 } }
      assert.equal(options.etag, undefined)
      assert.equal(options.cached, undefined)
      return { data: { items: [{ modelKey: 'beta', releaseVersion: 7 }], page: 2, pageSize: 20, total: 1, releaseVersion: 7 }, etag: 'beta-tag', releaseVersion: 7, publicationVersions: { price: 7 } }
    },
  }
  const state = createPublicContentState({ api })
  await state.loadModels({ search: 'alpha', page: 1, pageSize: 20 })
  await state.loadModels({ search: 'beta', page: 2, pageSize: 20 })
  assert.equal(calls.length, 2)
  assert.equal(state.value.models.data.items[0].modelKey, 'beta')
})

test('content and price generations advance independently and reject only their own domain mismatch', async () => {
  const state = createPublicContentState({ api: {
    getSite: async () => ({ data: { contentReleaseVersion: 5, priceReleaseVersion: 7, priceVisibility: 'visible' }, etag: 'site', releaseVersion: 7, publicationVersions: { content: 5, price: 7 } }),
    getHome: async () => ({ data: { document: 'home', releaseVersion: 5 }, etag: 'home', releaseVersion: 5, publicationVersions: { content: 5 } }),
    getModels: async () => ({ data: { items: [], page: 1, pageSize: 20, total: 0, releaseVersion: 7 }, etag: 'models', releaseVersion: 7, publicationVersions: { price: 7 } }),
  } })
  await state.loadSite(); await state.loadHome(); await state.loadModels()
  assert.deepEqual(state.value.publicationVersions, { content: 5, price: 7 })
  state.setApi({ getHome: async () => ({ data: { document: 'old', releaseVersion: 4 }, etag: 'old', releaseVersion: 4, publicationVersions: { content: 4 } }) })
  await assert.rejects(() => state.loadHome(), /mixed_publication_generation/)
  assert.equal(state.value.models.status, 'ready-empty')
})

test('authenticated production requests delegate to the shared authenticated fetch adapter', async () => {
  const calls = []
  const authenticatedFetch = async (url, init) => { calls.push([url, init]); return response(documentBody, { headers: { 'Cache-Control': 'private, no-store' } }) }
  const rawFetch = async () => { throw new Error('anonymous transport must not run') }
  const client = createPublicContentClient({ fetchImpl: rawFetch, authenticatedFetch })
  await client.getHome({ authenticated: true })
  assert.equal(calls.length, 1)
  assert.equal(calls[0][0], '/api/v1/public/home')
  assert.equal(calls[0][1].signal, undefined)
})

test('authoritative site can atomically advance content and price from 5/7 to 6/8', async () => {
  let versions = { content: 5, price: 7 }
  const api = { getSite: async () => ({ data: { contentReleaseVersion: versions.content, priceReleaseVersion: versions.price, priceVisibility: 'visible' }, etag: `site-${versions.content}-${versions.price}`, releaseVersion: versions.price, publicationVersions: { ...versions } }) }
  const state = createPublicContentState({ api })
  await state.loadSite(); versions = { content: 6, price: 8 }; await state.loadSite()
  assert.deepEqual(state.value.publicationVersions, { content: 6, price: 8 })
  assert.equal(state.value.site.status, 'ready')
})

test('late or out-of-order site responses can never downgrade either publication domain', async () => {
  let resolveOld
  const old = new Promise(resolve => { resolveOld = resolve })
  let call = 0
  const state = createPublicContentState({ api: { getSite: async () => ++call === 1 ? old : ({ data: { contentReleaseVersion: 6, priceReleaseVersion: 8, priceVisibility: 'visible' }, etag: 'new', releaseVersion: 8, publicationVersions: { content: 6, price: 8 } }) } })
  const stale = state.loadSite(); await state.loadSite()
  resolveOld({ data: { contentReleaseVersion: 5, priceReleaseVersion: 7, priceVisibility: 'visible' }, etag: 'old', releaseVersion: 7, publicationVersions: { content: 5, price: 7 } }); await stale
  assert.deepEqual(state.value.publicationVersions, { content: 6, price: 8 })
  state.setApi({ getSite: async () => ({ data: { contentReleaseVersion: 5, priceReleaseVersion: 8, priceVisibility: 'visible' }, etag: 'downgrade', releaseVersion: 8, publicationVersions: { content: 5, price: 8 } }) })
  await assert.rejects(() => state.loadSite(), /mixed_publication_generation/)
  assert.deepEqual(state.value.publicationVersions, { content: 6, price: 8 })
})

test('a leading domain response refreshes site and refetches cleanly while a real mismatch stays rejected', async () => {
  let homeCalls = 0; let siteVersion = 5
  const state = createPublicContentState({ api: {
    getSite: async () => ({ data: { contentReleaseVersion: siteVersion, priceReleaseVersion: 7, priceVisibility: 'visible' }, etag: `s${siteVersion}`, releaseVersion: 7, publicationVersions: { content: siteVersion, price: 7 } }),
    getHome: async () => { homeCalls++; return { data: { document: 'new', releaseVersion: 6 }, etag: 'h6', releaseVersion: 6, publicationVersions: { content: 6 } } },
  } })
  await state.loadSite(); siteVersion = 6; await state.loadHome()
  assert.equal(homeCalls, 2)
  assert.equal(state.value.home.status, 'ready')
  assert.deepEqual(state.value.publicationVersions, { content: 6, price: 7 })
  state.setApi({ getHome: async () => ({ data: { document: 'bad', releaseVersion: 8 }, etag: 'h8', releaseVersion: 8, publicationVersions: { content: 8 } }) })
  await assert.rejects(() => state.loadHome(), /mixed_publication_generation/)
  assert.deepEqual(state.value.publicationVersions, { content: 6, price: 7 })
})

const homeConfigBody = () => ({
  announcements: [{ guid: '7', title: 'Notice', body_html: '<p>Ready</p>', effective_at: '2026-09-15T00:00:00Z', sort_order: 1 }],
  faqs: [{ guid: '8', question: 'How?', answer_html: '<p>Safely.</p>', sort_order: 2 }],
  featured_model_keys: ['deepseek-chat'], content_release_version: 2, price_release_version: 3,
})

test('public home config maps exact immutable DTO and binds header to content version', async () => {
  const client = createPublicContentClient({ fetchImpl: async () => response(homeConfigBody(), { headers: { 'X-Public-Release-Version': '2' } }) })
  const out = await client.getHomeConfig()
  assert.deepEqual(out.data, { announcements: [{ guid: '7', title: 'Notice', bodyHtml: '<p>Ready</p>', effectiveAt: '2026-09-15T00:00:00Z', sortOrder: 1 }], faqs: [{ guid: '8', question: 'How?', answerHtml: '<p>Safely.</p>', sortOrder: 2 }], featuredModelKeys: ['deepseek-chat'], contentReleaseVersion: 2, priceReleaseVersion: 3 })
  assert.deepEqual(out.publicationVersions, { content: 2, price: 3 })
  assert.equal(out.resourceKey, '/api/v1/public/home-config')
  assert.ok(Object.isFrozen(out.data) && Object.isFrozen(out.data.announcements) && Object.isFrozen(out.data.announcements[0]))
})

test('public home config rejects malformed, leaking, duplicate, invalid text and mixed headers', async () => {
  const invalid = [
    { ...homeConfigBody(), draft_markdown: 'secret' },
    { ...homeConfigBody(), announcements: [{ ...homeConfigBody().announcements[0], is_visible: true }] },
    { ...homeConfigBody(), announcements: [homeConfigBody().announcements[0], homeConfigBody().announcements[0]] },
    { ...homeConfigBody(), faqs: [homeConfigBody().faqs[0], homeConfigBody().faqs[0]] },
    { ...homeConfigBody(), featured_model_keys: ['deepseek-chat', 'deepseek-chat'] },
    { ...homeConfigBody(), featured_model_keys: ['DeepSeek_chat'] },
    { ...homeConfigBody(), announcements: [{ ...homeConfigBody().announcements[0], title: 'bad\u0000text' }] },
    { ...homeConfigBody(), announcements: [{ ...homeConfigBody().announcements[0], title: '\ufffd' }] },
    { ...homeConfigBody(), announcements: [{ ...homeConfigBody().announcements[0], effective_at: '2026-02-30T00:00:00Z' }] },
    { ...homeConfigBody(), announcements: Array.from({ length: 21 }, (_, index) => ({ ...homeConfigBody().announcements[0], guid: String(index + 1) })) },
    { ...homeConfigBody(), faqs: Array.from({ length: 51 }, (_, index) => ({ ...homeConfigBody().faqs[0], guid: String(index + 1) })) },
    { ...homeConfigBody(), featured_model_keys: Array.from({ length: 13 }, (_, index) => `model-${index}`) },
    { ...homeConfigBody(), content_release_version: 0 },
  ]
  for (const body of invalid) await assert.rejects(() => createPublicContentClient({ fetchImpl: async () => response(body, { headers: { 'X-Public-Release-Version': '2' } }) }).getHomeConfig(), e => e.code === 'invalid_response')
  await assert.rejects(() => createPublicContentClient({ fetchImpl: async () => response(homeConfigBody()) }).getHomeConfig(), e => e.code === 'mixed_publication_generation')
})

test('home config 304 requires a validated same-resource cache', async () => {
  const mapped = await createPublicContentClient({ fetchImpl: async () => response(homeConfigBody(), { headers: { 'X-Public-Release-Version': '2' } }) }).getHomeConfig()
  const client = createPublicContentClient({ fetchImpl: async () => new Response(null, { status: 304 }) })
  const cached = mapped
  assert.equal((await client.getHomeConfig({ etag: cached.etag, cached })).notModified, true)
  for (const bad of [undefined, { ...cached, resourceKey: '/api/v1/public/home' }, { ...cached, data: { leaked: true } }]) await assert.rejects(() => client.getHomeConfig({ etag: cached.etag, cached: bad }), e => e.code === 'invalid_304')
  await assert.rejects(() => client.getHomeConfig({ cached }), e => e.code === 'invalid_304')
})

test('home config exposes only allowlisted public failure metadata and preserves abort identity', async () => {
  const failed = createPublicContentClient({ fetchImpl: async () => response({ error: { code: 'unavailable', message: 'password=hidden markdown', request_id: 'req-public' } }, { status: 503, headers: { 'Cache-Control': 'no-store', 'X-Request-ID': 'req-public' } }) })
  await assert.rejects(() => failed.getHomeConfig(), error => error.code === 'unavailable' && error.status === 503 && error.requestId === 'req-public' && !error.message.includes('hidden'))
  const malformed = createPublicContentClient({ fetchImpl: async () => response({ error: { code: 'password_secret', message: 'hidden', request_id: 'bad id' } }, { status: 503, headers: { 'X-Request-ID': 'bad id' } }) })
  await assert.rejects(() => malformed.getHomeConfig(), error => error.code === 'unavailable' && error.requestId === null)
  const abort = new DOMException('stop', 'AbortError')
  await assert.rejects(() => createPublicContentClient({ fetchImpl: async () => { throw abort } }).getHomeConfig(), error => error === abort)
})
