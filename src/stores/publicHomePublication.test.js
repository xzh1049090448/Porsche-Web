import test from 'node:test'
import assert from 'node:assert/strict'
import { createPublicContentState } from './publicContent.js'
import { createPublicHomePublication, loadVerifiedPublicPage, verifiedPublicPageData } from './publicHomePublication.js'

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
const response = (data, versions) => ({ data, etag: '"x"', releaseVersion: Object.values(versions)[0], publicationVersions: versions })

test('out-of-order site and home responses cannot expose a mixed shell and body generation', async () => {
  const siteV1 = deferred(); const homeV2 = deferred(); let siteCalls = 0; let homeCalls = 0; const decoded = []
  const store = createPublicContentState({ api: { getSite: () => ++siteCalls === 1 ? siteV1.promise : Promise.resolve(response({ contentReleaseVersion: 2, priceReleaseVersion: 4, priceVisibility: 'visible' }, { content: 2, price: 4 })), getHome: () => ++homeCalls === 1 ? homeV2.promise : Promise.resolve(response({ document: 'generation-2', releaseVersion: 2 }, { content: 2 })), getModel: () => Promise.reject(new Error('unexpected_model')) } })
  const publication = createPublicHomePublication({ store, decode: document => { decoded.push(document); return { marker: document, shellLinks: [{ label: document }], modelKeys: [] } } })
  const loading = publication.load(); siteV1.resolve(response({ contentReleaseVersion: 1, priceReleaseVersion: 3, priceVisibility: 'visible' }, { content: 1, price: 3 })); await Promise.resolve(); assert.equal(publication.home.value, null); homeV2.resolve(response({ document: 'generation-2', releaseVersion: 2 }, { content: 2 })); await loading
  assert.deepEqual(decoded, ['generation-2']); assert.equal(publication.home.value.marker, 'generation-2'); assert.equal(publication.home.value.shellLinks[0].label, 'generation-2'); assert.equal(siteCalls, 2); assert.equal(homeCalls, 2)
})

test('one verified decoded projection supplies shell and home content', async () => {
  const store = createPublicContentState({ api: { getSite: () => Promise.resolve(response({ contentReleaseVersion: 2, priceReleaseVersion: 4, priceVisibility: 'visible' }, { content: 2, price: 4 })), getHome: () => Promise.resolve(response({ document: 'generation-2', releaseVersion: 2 }, { content: 2 })), getModel: () => Promise.reject(new Error('unexpected_model')) } })
  const publication = createPublicHomePublication({ store, decode: document => ({ marker: document, shellLinks: [{ label: document }], modelKeys: [] }) })
  const projected = await publication.load(); assert.equal(projected, publication.home.value); assert.equal(projected.marker, projected.shellLinks[0].label)
})

test('shell content v2 rejects a stale page v1 instead of rendering mixed publication content', async () => {
  const store = createPublicContentState({ api: { getSite: () => Promise.resolve(response({ contentReleaseVersion: 2, priceReleaseVersion: 4, priceVisibility: 'visible' }, { content: 2, price: 4 })), getAbout: () => Promise.resolve(response({ document: 'about-v1', releaseVersion: 1 }, { content: 1 })) } })
  await store.loadSite(); assert.equal(await loadVerifiedPublicPage(store, 'about'), null); assert.equal(verifiedPublicPageData(store, 'about'), null); assert.equal(store.value.pages.about.status, 'error')
})

test('an out-of-order page upgrade refetches site and page before exposing v2', async () => {
  let siteCalls = 0; let pageCalls = 0
  const store = createPublicContentState({ api: { getSite: () => Promise.resolve(++siteCalls === 1 ? response({ contentReleaseVersion: 1, priceReleaseVersion: 4, priceVisibility: 'visible' }, { content: 1, price: 4 }) : response({ contentReleaseVersion: 2, priceReleaseVersion: 4, priceVisibility: 'visible' }, { content: 2, price: 4 })), getPrivacy: () => Promise.resolve(++pageCalls === 1 ? response({ document: 'privacy-v2', releaseVersion: 2 }, { content: 2 }) : response({ document: 'privacy-v2', releaseVersion: 2 }, { content: 2 })) } })
  await store.loadSite(); const page = await loadVerifiedPublicPage(store, 'privacy'); assert.equal(page.document, 'privacy-v2'); assert.equal(siteCalls, 2); assert.equal(pageCalls, 2)
})

test('route cleanup invalidates pending terms so it cannot survive after privacy wins', async () => {
  const terms = deferred()
  const store = createPublicContentState({ api: { getSite: () => Promise.resolve(response({ contentReleaseVersion: 2, priceReleaseVersion: 4, priceVisibility: 'visible' }, { content: 2, price: 4 })), getTerms: () => terms.promise, getPrivacy: () => Promise.resolve(response({ document: 'privacy-v2', releaseVersion: 2 }, { content: 2 })) } })
  await store.loadSite(); const pending = store.loadPage('terms'); store.invalidatePage('terms'); const privacy = await loadVerifiedPublicPage(store, 'privacy'); terms.resolve(response({ document: 'terms-v2', releaseVersion: 2 }, { content: 2 })); await pending
  assert.equal(store.value.pages.terms.data, null); assert.equal(store.value.pages.terms.status, 'idle'); assert.equal(privacy.document, 'privacy-v2')
})
