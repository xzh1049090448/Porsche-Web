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
  const api = createPublicHomeContentAdminApi({ request: async input => { calls.push(input); if (input.method === 'DELETE') return ok(null, 204, { 'X-Content-Draft-Revision': '5' }); if (input.path.includes('documents-draft')) return ok(documents); if (input.path.includes('home-preview')) return ok(home, 200, { 'X-Robots-Tag': 'noindex,nofollow' }); if (input.path.includes('/releases/')) return ok(publicHome); return ok(home, input.method === 'POST' ? 201 : 200) } })
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

test('production adapter uses bearer direct fetch for mutations without replay', async () => {
  const calls=[]; const adapter=createPublicHomeContentAdminProductionRequest({fetchImpl:async(...args)=>{calls.push(args);return new Response(JSON.stringify(home),{status:201,headers:headers()})},baseURL:'/base',getAuthorization:()=> 'Bearer in-memory'})
  const result=await adapter({method:'POST',path:'/admin/v2/public-content/home-draft/announcements',body:{expected_revision:1},signal:undefined})
  assert.equal(result.status,201);assert.equal(calls.length,1);assert.equal(calls[0][1].headers.Authorization,'Bearer in-memory');assert.equal(calls[0][1].credentials,'include');assert.equal(calls[0][1].headers['Content-Type'],'application/json')
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
