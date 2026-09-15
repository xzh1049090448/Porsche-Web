import test from 'node:test'
import assert from 'node:assert/strict'
import { createPublicHomeContentAdminApi, createPublicHomeContentAdminProductionRequest, PublicHomeContentAdminError } from './publicHomeContentAdmin.js'

const headers = extra => new Headers({ 'Cache-Control': 'no-store', 'X-Request-ID': 'req-home', ...extra })
const ok = (data, status = 200, extra = {}) => ({ data, status, headers: headers(extra) })
const announcement = { guid: '7', title: 'Notice', body_markdown: '**text**', effective_at: null, is_visible: true, sort_order: 1 }
const faq = { guid: '8', question: 'How?', answer_markdown: 'Safely', is_visible: true, sort_order: 2 }
const home = { revision: 4, announcements: [announcement], faqs: [faq], featured_model_keys: ['deepseek-chat'] }
const documents = { revision: 4, about: '# About', terms: '# Terms', privacy: '# Privacy', legal_reviewed: true }
const publicHome = { announcements: [{ guid: '7', title: 'Notice', body_html: '<p>text</p>\n', effective_at: null, sort_order: 1 }], faqs: [{ guid: '8', question: 'How?', answer_html: '<p>Safely</p>\n', sort_order: 2 }], featured_model_keys: ['deepseek-chat'], content_release_version: 5, price_release_version: 6 }

test('root home client maps all routes and exact snake case request bodies', async () => {
  const calls = []
  const api = createPublicHomeContentAdminApi({ request: async input => { calls.push(input); if (input.method === 'DELETE') return ok(null, 204, { 'X-Content-Draft-Revision': '5' }); if (input.path.includes('documents-draft')) return ok(documents); if (input.path.includes('home-preview')) return ok(home, 200, { 'X-Robots-Tag': 'noindex, nofollow' }); if (input.path.includes('/releases/')) return ok(publicHome); return ok(home, input.method === 'POST' ? 201 : 200) } })
  assert.equal((await api.getHomeDraft()).announcements[0].bodyMarkdown, '**text**')
  await api.createAnnouncement({ expectedRevision: 4, title: 'Next', bodyMarkdown: 'Body', effectiveAt: null, isVisible: true, sortOrder: 3 })
  await api.updateAnnouncement('7', { expectedRevision: 4, title: 'Changed' })
  assert.equal(await api.deleteAnnouncement('7', 4), 5)
  await api.createFAQ({ expectedRevision: 4, question: 'Q', answerMarkdown: 'A', isVisible: true, sortOrder: 1 })
  await api.updateFAQ('8', { expectedRevision: 4, isVisible: false })
  assert.equal(await api.deleteFAQ('8', 4), 5)
  await api.saveFeaturedModels(4, ['deepseek-chat'])
  await api.previewHome(4)
  assert.equal((await api.getReleaseHomeConfig('9')).contentReleaseVersion, 5)
  assert.equal((await api.getDocumentsDraft()).legalReviewed, true)
  await api.saveDocumentsDraft({ expectedRevision: 4, about: '# A', terms: '# T', privacy: '# P', legalReviewed: true })
  assert.deepEqual(calls[1].body, { expected_revision: 4, title: 'Next', body_markdown: 'Body', effective_at: null, is_visible: true, sort_order: 3 })
  assert.deepEqual(calls[2].body, { expected_revision: 4, title: 'Changed' })
  assert.equal(calls[8].path, '/admin/v2/public-content/home-preview?revision=4')
  assert.ok(Object.isFrozen((await api.getHomeDraft()).announcements[0]))
})

test('root client validates inputs before transport and requires strict success metadata', async () => {
  let calls = 0; const api = createPublicHomeContentAdminApi({ request: async () => { calls++; return ok(home) } })
  for (const run of [
    () => api.createAnnouncement({ expectedRevision: 0, title: 'x', bodyMarkdown: '', effectiveAt: null, isVisible: true, sortOrder: 0 }),
    () => api.createAnnouncement({ expectedRevision: 1, title: 'bad\u0000', bodyMarkdown: '', effectiveAt: null, isVisible: true, sortOrder: 0 }),
    () => api.createAnnouncement({ expectedRevision: 1, title: 'x', bodyMarkdown: 'x'.repeat(16385), effectiveAt: null, isVisible: true, sortOrder: 0 }),
    () => api.createAnnouncement({ expectedRevision: 1, title: 'x', bodyMarkdown: '', effectiveAt: '2026-02-30T00:00:00Z', isVisible: true, sortOrder: 0 }),
    () => api.updateAnnouncement('0', { expectedRevision: 1, title: 'x' }),
    () => api.updateAnnouncement(7, { expectedRevision: 1, title: 'x' }),
    () => api.updateFAQ('8', { expectedRevision: 1, unknown: true }),
    () => api.saveFeaturedModels(1, ['Deep_seek']),
    () => api.saveFeaturedModels(1, ['deepseek-chat', 'deepseek-chat']),
    () => api.saveFeaturedModels(1, Array.from({ length: 13 }, (_, index) => `model-${index}`)),
    () => api.previewHome(0),
    () => api.getReleaseHomeConfig(9),
    () => api.saveDocumentsDraft({ expectedRevision: 1, about: '', terms: '', privacy: '', legalReviewed: true, unknown: true }),
  ]) assert.throws(run, /invalid_public_home_content_admin_request/)
  assert.equal(calls, 0)
  for (const bad of [ok({ ...home, unknown: true }), { data: home, status: 200, headers: headers({ 'Cache-Control': 'private' }) }, { data: home, status: 200, headers: headers({ 'X-Request-ID': ' ' }) }]) await assert.rejects(() => createPublicHomeContentAdminApi({ request: async () => bad }).getHomeDraft(), /invalid_public_home_content_admin_response/)
  await assert.rejects(
    () => createPublicHomeContentAdminApi({ request: async () => ok(home, 200, { 'X-Robots-Tag': 'noindex,nofollow' }) }).previewHome(),
    /invalid_public_home_content_admin_response/,
  )
})

test('root errors are allowlisted and sanitized while AbortError identity is preserved', async () => {
  const error = status => ({ response: ok({ error: { code: ({400:'invalid_request',401:'authentication_required',403:'root_role_required',404:'not_found',409:'conflict',410:'gone',422:'validation_failed',503:'unavailable'})[status], message: 'secret markdown password', request_id: 'req-home' } }, status) })
  for (const [status, code] of [[400,'invalid_request'],[401,'authentication_required'],[403,'root_required'],[404,'not_found'],[409,'revision_conflict'],[410,'gone'],[422,'validation_failed'],[503,'unavailable']]) {
    const api = createPublicHomeContentAdminApi({ request: async () => { throw error(status) } })
    await assert.rejects(() => api.getHomeDraft(), e => e instanceof PublicHomeContentAdminError && e.code === code && e.requestId === 'req-home' && !e.message.includes('secret'))
  }
  const abort = new DOMException('stop', 'AbortError')
  await assert.rejects(() => createPublicHomeContentAdminApi({ request: async () => { throw abort } }).getHomeDraft(), e => e === abort)
  await assert.rejects(() => createPublicHomeContentAdminApi({ request: async () => { throw new Error('token=secret') } }).getHomeDraft(), e => e.code === 'network_error' && !e.message.includes('secret'))
})

test('root cancellation preserves only genuine DOMException identity without reading forged names', async () => {
  let nameReads = 0
  const accessorForgery = {}; Object.defineProperty(accessorForgery, 'name', { enumerable: true, get: () => { nameReads++; return 'AbortError' } })
  const errorForgery = new Error('forged'); Object.defineProperty(errorForgery, 'name', { value: 'AbortError', enumerable: true })
  for (const forged of [accessorForgery, errorForgery]) await assert.rejects(() => createPublicHomeContentAdminApi({ request: async () => { throw forged } }).getHomeDraft(), error => error instanceof PublicHomeContentAdminError && error.code === 'network_error' && error !== forged)
  assert.equal(nameReads, 0)
  let genuineNameReads = 0
  const genuine = new DOMException('stop', 'AbortError')
  Object.defineProperty(genuine, 'name', { configurable: true, get: () => { genuineNameReads++; throw new Error('overridden') } })
  await assert.rejects(() => createPublicHomeContentAdminApi({ request: async () => { throw genuine } }).getHomeDraft(), error => error === genuine)
  assert.equal(genuineNameReads, 0)

  let transportNameReads = 0
  const transportForgery = {}; Object.defineProperty(transportForgery, 'name', { enumerable: true, get: () => { transportNameReads++; return 'AbortError' } })
  const adapter = createPublicHomeContentAdminProductionRequest({ fetchImpl: async () => { throw transportForgery } })
  await assert.rejects(() => adapter({ method: 'GET', path: '/admin/v2/public-content/home-draft' }), error => error instanceof PublicHomeContentAdminError && error.code === 'network_error')
  assert.equal(transportNameReads, 0)
})

test('root response headers use native intrinsic access and reject unsafe plain metadata', async () => {
  const overridden = headers(); Object.defineProperty(overridden, 'get', { value: () => { throw new Error('overridden') } })
  assert.equal((await createPublicHomeContentAdminApi({ request: async () => ({ data: home, status: 200, headers: overridden }) }).getHomeDraft()).revision, 4)

  let cacheControlReads = 0
  const accessorHeaders = { 'X-Request-ID': 'req-home' }
  Object.defineProperty(accessorHeaders, 'Cache-Control', { enumerable: true, get: () => { cacheControlReads++; throw new Error('secret') } })
  const duplicateHeaders = { 'Cache-Control': 'no-store', 'cache-control': 'no-store', 'X-Request-ID': 'req-home' }
  const symbolHeaders = { 'Cache-Control': 'no-store', 'X-Request-ID': 'req-home', [Symbol('hidden')]: 'secret' }
  for (const unsafe of [accessorHeaders, duplicateHeaders, symbolHeaders]) await assert.rejects(() => createPublicHomeContentAdminApi({ request: async () => ({ data: home, status: 200, headers: unsafe }) }).getHomeDraft(), error => /invalid_public_home_content_admin_response/.test(error.message) && error.code === undefined)
  assert.equal(cacheControlReads, 0)
  const plain = { 'cache-control': 'no-store', 'x-request-id': 'req-home' }
  assert.equal((await createPublicHomeContentAdminApi({ request: async () => ({ data: home, status: 200, headers: plain }) }).getHomeDraft()).revision, 4)
})

test('malformed thrown response accessors are never invoked and remain sanitized', async () => {
  let responseReads = 0
  const thrown = {}; Object.defineProperty(thrown, 'response', { enumerable: true, get: () => { responseReads++; throw new Error('secret') } })
  await assert.rejects(() => createPublicHomeContentAdminApi({ request: async () => { throw thrown } }).getHomeDraft(), error => error.code === 'network_error' && !error.message.includes('secret'))
  assert.equal(responseReads, 0)
})

test('production adapter uses bearer direct fetch for mutations without replay', async () => {
  const calls=[]; const adapter=createPublicHomeContentAdminProductionRequest({fetchImpl:async(...args)=>{calls.push(args);return new Response(JSON.stringify(home),{status:201,headers:headers()})},baseURL:'/base',getAuthorization:()=> 'Bearer in-memory'})
  const result=await adapter({method:'POST',path:'/admin/v2/public-content/home-draft/announcements',body:{expected_revision:1},signal:undefined})
  assert.equal(result.status,201);assert.equal(calls.length,1);assert.equal(calls[0][1].headers.Authorization,'Bearer in-memory');assert.equal(calls[0][1].credentials,'include');assert.equal(calls[0][1].headers['Content-Type'],'application/json')
})

test('production adapter uses genuine Response intrinsics and rejects unsafe plain responses', async () => {
  const nativeResponse = new Response(JSON.stringify(home), { status: 201, headers: headers() })
  const reads = { status: 0, ok: 0, headers: 0, json: 0 }
  Object.defineProperties(nativeResponse, {
    status: { configurable: true, get: () => { reads.status++; throw new Error('secret status') } },
    ok: { configurable: true, get: () => { reads.ok++; throw new Error('secret ok') } },
    headers: { configurable: true, get: () => { reads.headers++; throw new Error('secret headers') } },
    json: { configurable: true, get: () => { reads.json++; throw new Error('secret json') } },
  })
  const adapter = createPublicHomeContentAdminProductionRequest({ fetchImpl: async () => nativeResponse })
  const result = await adapter({ method: 'POST', path: '/admin/v2/public-content/home-draft/announcements', body: {} })
  assert.equal(result.status, 201)
  assert.deepEqual(result.data, home)
  assert.deepEqual(reads, { status: 0, ok: 0, headers: 0, json: 0 })

  const failedResponse = new Response(JSON.stringify({ error: { code: 'unavailable', message: 'secret markdown password', request_id: 'req-home' } }), { status: 503, headers: headers() })
  const failedReads = { status: 0, ok: 0, headers: 0, json: 0 }
  Object.defineProperties(failedResponse, {
    status: { configurable: true, get: () => { failedReads.status++; return 200 } },
    ok: { configurable: true, get: () => { failedReads.ok++; return true } },
    headers: { configurable: true, get: () => { failedReads.headers++; return new Headers() } },
    json: { configurable: true, get: () => { failedReads.json++; return async () => home } },
  })
  const failedApi = createPublicHomeContentAdminApi({ request: createPublicHomeContentAdminProductionRequest({ fetchImpl: async () => failedResponse }) })
  await assert.rejects(() => failedApi.getHomeDraft(), error => error.code === 'unavailable' && error.requestId === 'req-home' && !error.message.includes('secret'))
  assert.deepEqual(failedReads, { status: 0, ok: 0, headers: 0, json: 0 })

  const emptyResponse = new Response(null, { status: 204, headers: headers({ 'X-Content-Draft-Revision': '5' }) })
  let emptyJSONReads = 0
  Object.defineProperty(emptyResponse, 'json', { configurable: true, get: () => { emptyJSONReads++; throw new Error('secret json') } })
  const empty = await createPublicHomeContentAdminProductionRequest({ fetchImpl: async () => emptyResponse })({ method: 'DELETE', path: '/admin/v2/public-content/home-draft/faqs/8', body: { expected_revision: 4 } })
  assert.deepEqual({ data: empty.data, status: empty.status }, { data: null, status: 204 })
  assert.equal(emptyJSONReads, 0)

  const plain = { status: 201, ok: true, headers: { 'Cache-Control': 'no-store', 'X-Request-ID': 'req-home' }, json: async () => home }
  assert.equal((await createPublicHomeContentAdminProductionRequest({ fetchImpl: async () => plain })({ method: 'POST', path: '/admin/v2/public-content/home-draft/announcements', body: {} })).status, 201)

  let statusReads = 0
  const accessor = { ...plain }
  Object.defineProperty(accessor, 'status', { enumerable: true, get: () => { statusReads++; return 201 } })
  const symbol = { ...plain, [Symbol('hidden')]: 'secret' }
  const extra = { ...plain, extra: 'secret' }
  const exotic = Object.assign(Object.create({ inherited: true }), plain)
  for (const unsafe of [accessor, symbol, extra, exotic]) {
    const unsafeAdapter = createPublicHomeContentAdminProductionRequest({ fetchImpl: async () => unsafe })
    await assert.rejects(() => unsafeAdapter({ method: 'GET', path: '/admin/v2/public-content/home-draft' }), error => error instanceof PublicHomeContentAdminError && error.code === 'request_failed' && !error.message.includes('secret'))
  }
  assert.equal(statusReads, 0)
})

test('root input objects and options reject inherited or exotic properties before transport', () => {
  let calls = 0; const api = createPublicHomeContentAdminApi({ request: async () => { calls++; return ok(home) } })
  const inheritedRevision = Object.assign(Object.create({ expectedRevision: 4 }), { title: 'Changed' })
  const inheritedUnknown = Object.assign(Object.create({ hidden: 'secret' }), { expectedRevision: 4, title: 'Next', bodyMarkdown: '', effectiveAt: null, isVisible: true, sortOrder: 0 })
  const inheritedDocument = Object.assign(Object.create({ expectedRevision: 4 }), { about: '', terms: '', privacy: '', legalReviewed: true })
  const inheritedOptions = Object.create({ signal: new AbortController().signal })
  const exoticFeatured = Object.setPrototypeOf(['deepseek-chat'], { inherited: true })
  for (const run of [
    () => api.updateAnnouncement('7', inheritedRevision),
    () => api.createAnnouncement(inheritedUnknown),
    () => api.updateFAQ('8', Object.assign(Object.create({ expectedRevision: 4 }), { isVisible: false })),
    () => api.saveDocumentsDraft(inheritedDocument),
    () => api.getHomeDraft(inheritedOptions),
    () => api.deleteFAQ('8', 4, inheritedOptions),
    () => api.saveFeaturedModels(4, exoticFeatured),
  ]) assert.throws(run, /invalid_public_home_content_admin_request/)
  assert.equal(calls, 0)
})

test('root draft and release mappings reject fractional time and unstable ordering', async () => {
  const ann = (guid, sortOrder, effectiveAt = null) => ({ guid, title: `N${guid}`, body_markdown: '', effective_at: effectiveAt, is_visible: true, sort_order: sortOrder })
  const faqItem = (guid, sortOrder) => ({ guid, question: `Q${guid}`, answer_markdown: '', is_visible: true, sort_order: sortOrder })
  const invalidDrafts = [
    { ...home, announcements: [ann('2', 2), ann('1', 1)] },
    { ...home, announcements: [ann('1', 1, '2026-09-15T00:00:00Z'), ann('2', 1, null)] },
    { ...home, announcements: [ann('9223372036854775807', 1), ann('9223372036854775806', 1)] },
    { ...home, announcements: [ann('1', 1, '2026-09-15T00:00:00.123Z')] },
    { ...home, faqs: [faqItem('9223372036854775807', 1), faqItem('9223372036854775806', 1)] },
  ]
  for (const raw of invalidDrafts) await assert.rejects(() => createPublicHomeContentAdminApi({ request: async () => ok(raw) }).getHomeDraft(), /invalid_public_home_content_admin_response/)
  const invalidReleases = [
    { ...publicHome, announcements: [{ guid:'2',title:'N2',body_html:'<p>x</p>\n',effective_at:null,sort_order:2 }, { guid:'1',title:'N1',body_html:'<p>x</p>\n',effective_at:null,sort_order:1 }] },
    { ...publicHome, announcements: [{ ...publicHome.announcements[0], effective_at:'2026-09-15T00:00:00.123Z' }] },
  ]
  for (const raw of invalidReleases) await assert.rejects(() => createPublicHomeContentAdminApi({ request: async () => ok(raw) }).getReleaseHomeConfig('9'), /invalid_public_home_content_admin_response/)
  assert.throws(() => createPublicHomeContentAdminApi().createAnnouncement({ expectedRevision: 1, title: 'x', bodyMarkdown: '', effectiveAt: '2026-09-15T00:00:00.123Z', isVisible: true, sortOrder: 0 }), /invalid_public_home_content_admin_request/)
  assert.throws(() => createPublicHomeContentAdminApi().createAnnouncement({ expectedRevision: 1, title: 'x', bodyMarkdown: 'bad\u0085text', effectiveAt: null, isVisible: true, sortOrder: 0 }), /invalid_public_home_content_admin_request/)
})

test('root structured arrays reject holes and extra properties before mapping or transport', async () => {
  const sparseAnnouncements = [...home.announcements]; delete sparseAnnouncements[0]
  const sparseFAQs = [...home.faqs]; delete sparseFAQs[0]
  const sparseFeaturedResponse = [...home.featured_model_keys]; delete sparseFeaturedResponse[0]
  const adornedFAQs = [...home.faqs]; adornedFAQs.extra = true
  for (const raw of [
    { ...home, announcements: sparseAnnouncements },
    { ...home, faqs: sparseFAQs },
    { ...home, featured_model_keys: sparseFeaturedResponse },
    { ...home, faqs: adornedFAQs },
  ]) await assert.rejects(() => createPublicHomeContentAdminApi({ request: async () => ok(raw) }).getHomeDraft(), /invalid_public_home_content_admin_response/)
  const sparseReleaseAnnouncements = [...publicHome.announcements]; delete sparseReleaseAnnouncements[0]
  await assert.rejects(() => createPublicHomeContentAdminApi({ request: async () => ok({ ...publicHome, announcements: sparseReleaseAnnouncements }) }).getReleaseHomeConfig('9'), /invalid_public_home_content_admin_response/)

  let calls = 0
  const api = createPublicHomeContentAdminApi({ request: async () => { calls++; return ok(home) } })
  const sparseFeaturedInput = ['deepseek-chat']; delete sparseFeaturedInput[0]
  const adornedFeaturedInput = ['deepseek-chat']; adornedFeaturedInput.extra = true
  assert.throws(() => api.saveFeaturedModels(4, sparseFeaturedInput), /invalid_public_home_content_admin_request/)
  assert.throws(() => api.saveFeaturedModels(4, adornedFeaturedInput), /invalid_public_home_content_admin_request/)
  assert.equal(calls, 0)
})

test('root inputs reject accessors and symbols before every shared transport path', async () => {
  let calls = 0
  const api = createPublicHomeContentAdminApi({ request: async input => { calls++; return ok(home, input.method === 'POST' ? 201 : 200) } })
  const announcementInput = { expectedRevision: 1, title: 'N', bodyMarkdown: '', effectiveAt: null, isVisible: true, sortOrder: 0 }; let announcementRevisionReads = 0
  Object.defineProperty(announcementInput, 'expectedRevision', { enumerable: true, configurable: true, get: () => ++announcementRevisionReads === 1 ? 1 : 0 })
  const faqInput = { expectedRevision: 1, question: 'Q', answerMarkdown: '', isVisible: true, sortOrder: 0 }; let faqRevisionReads = 0
  Object.defineProperty(faqInput, 'expectedRevision', { enumerable: true, configurable: true, get: () => ++faqRevisionReads === 1 ? 1 : 0 })
  const documentsInput = { expectedRevision: 1, about: '# A', terms: '# T', privacy: '# P', legalReviewed: true }; let aboutReads = 0
  Object.defineProperty(documentsInput, 'about', { enumerable: true, configurable: true, get: () => ++aboutReads === 1 ? '# A' : 0 })
  const throwingInput = { expectedRevision: 1, title: 'N', bodyMarkdown: '', effectiveAt: null, isVisible: true, sortOrder: 0 }
  Object.defineProperty(throwingInput, 'expectedRevision', { enumerable: true, configurable: true, get: () => { throw new Error('secret') } })
  const symbolInput = { expectedRevision: 1, title: 'N', bodyMarkdown: '', effectiveAt: null, isVisible: true, sortOrder: 0, [Symbol('hidden')]: true }
  const throwingOptions = {}; Object.defineProperty(throwingOptions, 'signal', { enumerable: true, configurable: true, get: () => { throw new Error('secret') } })
  const symbolOptions = { [Symbol('hidden')]: true }
  const accessorFeatured = ['deepseek-chat']; Object.defineProperty(accessorFeatured, '0', { enumerable: true, configurable: true, get: () => 'deepseek-chat' })
  for (const run of [
    () => api.createAnnouncement(announcementInput),
    () => api.createFAQ(faqInput),
    () => api.saveDocumentsDraft(documentsInput),
    () => api.createAnnouncement(throwingInput),
    () => api.createAnnouncement(symbolInput),
    () => api.getHomeDraft(throwingOptions),
    () => api.previewHome(undefined, symbolOptions),
    () => api.saveFeaturedModels(1, accessorFeatured),
  ]) assert.throws(run, /invalid_public_home_content_admin_request/)
  assert.equal(calls, 0)

  const frozen = Object.freeze({ expectedRevision: 1, title: 'N', bodyMarkdown: '', effectiveAt: null, isVisible: true, sortOrder: 0 })
  await api.createAnnouncement(frozen)
  assert.equal(calls, 1)
})

test('root response mapping rejects accessor DTOs before values can change', async () => {
  const changingHome = { ...home }; let revisionReads = 0
  Object.defineProperty(changingHome, 'revision', { enumerable: true, configurable: true, get: () => ++revisionReads === 1 ? 4 : 0 })
  await assert.rejects(() => createPublicHomeContentAdminApi({ request: async () => ok(changingHome) }).getHomeDraft(), /invalid_public_home_content_admin_response/)

  const changingAnnouncement = { ...announcement }; let bodyReads = 0
  Object.defineProperty(changingAnnouncement, 'body_markdown', { enumerable: true, configurable: true, get: () => ++bodyReads === 1 ? 'safe' : '\u0000' })
  await assert.rejects(() => createPublicHomeContentAdminApi({ request: async () => ok({ ...home, announcements: [changingAnnouncement] }) }).getHomeDraft(), /invalid_public_home_content_admin_response/)
  const accessorAnnouncements = [...home.announcements]
  Object.defineProperty(accessorAnnouncements, '0', { enumerable: true, configurable: true, get: () => announcement })
  await assert.rejects(() => createPublicHomeContentAdminApi({ request: async () => ok({ ...home, announcements: accessorAnnouncements }) }).getHomeDraft(), /invalid_public_home_content_admin_response/)
  const throwingDocuments = { ...documents }
  Object.defineProperty(throwingDocuments, 'about', { enumerable: true, configurable: true, get: () => { throw new Error('secret') } })
  await assert.rejects(() => createPublicHomeContentAdminApi({ request: async () => ok(throwingDocuments) }).getDocumentsDraft(), error => /invalid_public_home_content_admin_response/.test(error.message) && !error.message.includes('secret'))
})
