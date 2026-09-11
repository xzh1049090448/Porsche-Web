import test from 'node:test'
import assert from 'node:assert/strict'
import { createPublicContentState } from './publicContent.js'
import { createPublicHomePublication, createPublicLayoutPublication, loadVerifiedPublicPage, verifiedPublicPageData } from './publicHomePublication.js'

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

test('a hanging homepage model cannot block a verified about page after site readiness', async () => {
  const never = new Promise(() => {})
  const store = createPublicContentState({ api: {
    getSite: () => Promise.resolve(response({ contentReleaseVersion: 2, priceReleaseVersion: 4, priceVisibility: 'visible' }, { content: 2, price: 4 })),
    getHome: () => Promise.resolve(response({ document: 'home-v2', releaseVersion: 2 }, { content: 2 })),
    getModel: () => never,
    getAbout: () => Promise.resolve(response({ document: 'about-v2', releaseVersion: 2 }, { content: 2 })),
  } })
  const lifecycle = createPublicLayoutPublication({ store, loadCodec: async () => ({ decode: () => ({ shellLinks: [], modelKeys: ['slow-model'] }) }) })
  void lifecycle.init(); await lifecycle.siteReady
  const about = await loadVerifiedPublicPage(store, 'about')
  assert.equal(about.document, 'about-v2'); assert.equal(store.value.details['slow-model'].status, 'loading')
  lifecycle.dispose()
})

test('disposing during deferred codec initialization settles readiness without starting network', async () => {
  const codec = deferred(); let networkCalls = 0
  const store = createPublicContentState({ api: { getSite: () => { networkCalls++; return Promise.reject(new Error('unexpected_network')) } } })
  const lifecycle = createPublicLayoutPublication({ store, loadCodec: () => codec.promise })
  const initializing = lifecycle.init(); lifecycle.dispose(); codec.resolve({ decode: () => ({ shellLinks: [], modelKeys: [] }) })
  await initializing; await lifecycle.siteReady
  assert.equal(networkCalls, 0); assert.equal(lifecycle.publication.value, null); assert.equal(store.value.site.status, 'idle')
})

for (const name of ['about', 'privacy']) test(`hydrated v1 shell disappears while ${name} v2 reconciles and returns only as v2`, async () => {
  const homeV2 = deferred(); const pageRetry = deferred(); let siteCalls = 0; let homeCalls = 0; let pageCalls = 0
  const pageMethod = `get${name[0].toUpperCase()}${name.slice(1)}`
  const api = {
    getSite: () => Promise.resolve(++siteCalls === 1 ? response({ contentReleaseVersion: 1, priceReleaseVersion: 4, priceVisibility: 'visible' }, { content: 1, price: 4 }) : response({ contentReleaseVersion: 2, priceReleaseVersion: 4, priceVisibility: 'visible' }, { content: 2, price: 4 })),
    getHome: () => ++homeCalls === 1 ? Promise.resolve(response({ document: 'home-v1', releaseVersion: 1 }, { content: 1 })) : homeV2.promise,
    [pageMethod]: () => ++pageCalls === 1 ? Promise.resolve(response({ document: `${name}-v2`, releaseVersion: 2 }, { content: 2 })) : pageRetry.promise,
  }
  const store = createPublicContentState({ api }); const lifecycle = createPublicLayoutPublication({ store, loadCodec: async () => ({ decode: document => ({ marker: document, shellLinks: [{ label: document }], modelKeys: [] }) }) })
  await lifecycle.init(); assert.equal(lifecycle.publication.value.home.value.shellLinks[0].label, 'home-v1')
  const pagePromise = lifecycle.loadPage(name)
  for (let index = 0; index < 8 && pageCalls < 2; index++) await Promise.resolve()
  assert.equal(pageCalls, 2); assert.equal(lifecycle.publication.value.home.value, null)
  pageRetry.resolve(response({ document: `${name}-v2`, releaseVersion: 2 }, { content: 2 }))
  const page = await pagePromise; assert.equal(page.document, `${name}-v2`); assert.equal(lifecycle.publication.value.home.value, null)
  homeV2.resolve(response({ document: 'home-v2', releaseVersion: 2 }, { content: 2 })); await lifecycle.homeHydration.value
  assert.equal(lifecycle.publication.value.home.value.shellLinks[0].label, 'home-v2'); assert.equal(pageCalls, 2)
  lifecycle.dispose()
})

test('transient page failure retains the verified home without redundant hydration', async () => {
  let homeCalls = 0
  const store = createPublicContentState({ api: { getSite: () => Promise.resolve(response({ contentReleaseVersion: 1, priceReleaseVersion: 4, priceVisibility: 'visible' }, { content: 1, price: 4 })), getHome: () => { homeCalls++; return Promise.resolve(response({ document: 'home-v1', releaseVersion: 1 }, { content: 1 })) }, getAbout: () => Promise.reject(new Error('temporary')) } })
  const lifecycle = createPublicLayoutPublication({ store, loadCodec: async () => ({ decode: document => ({ marker: document, shellLinks: [{ label: document }], modelKeys: [] }) }) })
  await lifecycle.init(); const original = lifecycle.publication.value.home.value
  assert.equal(await lifecycle.loadPage('about'), null); assert.equal(lifecycle.publication.value.home.value, original); assert.equal(homeCalls, 1)
  lifecycle.dispose()
})

test('same-generation page success retains verified home and skips model/home rehydration', async () => {
  let homeCalls = 0
  const store = createPublicContentState({ api: { getSite: () => Promise.resolve(response({ contentReleaseVersion: 1, priceReleaseVersion: 4, priceVisibility: 'visible' }, { content: 1, price: 4 })), getHome: () => { homeCalls++; return Promise.resolve(response({ document: 'home-v1', releaseVersion: 1 }, { content: 1 })) }, getAbout: () => Promise.resolve(response({ document: 'about-v1', releaseVersion: 1 }, { content: 1 })) } })
  const lifecycle = createPublicLayoutPublication({ store, loadCodec: async () => ({ decode: document => ({ marker: document, shellLinks: [{ label: document }], modelKeys: [] }) }) })
  await lifecycle.init(); const original = lifecycle.publication.value.home.value
  assert.equal((await lifecycle.loadPage('about')).document, 'about-v1'); assert.equal(lifecycle.publication.value.home.value, original); assert.equal(homeCalls, 1)
  lifecycle.dispose()
})

test('fail-first site initialization recovers through one deduplicated explicit home retry', async () => {
  let siteCalls = 0; let homeCalls = 0
  const store = createPublicContentState({ api: { getSite: () => ++siteCalls === 1 ? Promise.reject(new Error('temporary')) : Promise.resolve(response({ contentReleaseVersion: 2, priceReleaseVersion: 4, priceVisibility: 'visible' }, { content: 2, price: 4 })), getHome: () => { homeCalls++; return Promise.resolve(response({ document: 'home-v2', releaseVersion: 2 }, { content: 2 })) } } })
  const lifecycle = createPublicLayoutPublication({ store, loadCodec: async () => ({ decode: document => ({ marker: document, shellLinks: [{ label: document }], modelKeys: [] }) }) })
  assert.equal(await lifecycle.init(), null); assert.equal(store.value.site.status, 'error'); assert.equal(lifecycle.publication.value, null)
  const first = lifecycle.loadHome(); const duplicate = lifecycle.loadHome(); assert.equal(first, duplicate); await first
  assert.equal(siteCalls, 2); assert.equal(homeCalls, 1); assert.equal(lifecycle.publication.value.home.value.shellLinks[0].label, 'home-v2')
  lifecycle.dispose()
})

test('a later verified About load recovers homepage publication after initial site failure', async () => {
  let siteCalls = 0; let homeCalls = 0
  const store = createPublicContentState({ api: { getSite: () => ++siteCalls === 1 ? Promise.reject(new Error('temporary')) : Promise.resolve(response({ contentReleaseVersion: 2, priceReleaseVersion: 4, priceVisibility: 'visible' }, { content: 2, price: 4 })), getHome: () => { homeCalls++; return Promise.resolve(response({ document: 'home-v2', releaseVersion: 2 }, { content: 2 })) }, getAbout: () => Promise.resolve(response({ document: 'about-v2', releaseVersion: 2 }, { content: 2 })) } })
  const lifecycle = createPublicLayoutPublication({ store, loadCodec: async () => ({ decode: document => ({ marker: document, shellLinks: [{ label: document }], modelKeys: [] }) }) })
  await lifecycle.init(); const about = await lifecycle.loadPage('about'); assert.equal(about.document, 'about-v2')
  for (let index = 0; index < 8 && !lifecycle.publication.value; index++) await Promise.resolve()
  await lifecycle.homeHydration.value
  assert.equal(homeCalls, 1); assert.equal(lifecycle.publication.value.home.value.marker, 'home-v2')
  lifecycle.dispose()
})

test('dispose cancels an in-flight page and prevents generation reconciliation or late shell mutation', async () => {
  const aboutV2 = deferred(); let siteCalls = 0; let homeCalls = 0
  const store = createPublicContentState({ api: {
    getSite: () => { siteCalls++; return Promise.resolve(response({ contentReleaseVersion: 1, priceReleaseVersion: 4, priceVisibility: 'visible' }, { content: 1, price: 4 })) },
    getHome: () => { homeCalls++; return Promise.resolve(response({ document: 'home-v1', releaseVersion: 1 }, { content: 1 })) },
    getAbout: () => aboutV2.promise,
  } })
  const lifecycle = createPublicLayoutPublication({ store, loadCodec: async () => ({ decode: document => ({ marker: document, shellLinks: [{ label: document }], modelKeys: [] }) }) })
  await lifecycle.init(); const pending = lifecycle.loadPage('about'); lifecycle.dispose(); aboutV2.resolve(response({ document: 'about-v2', releaseVersion: 2 }, { content: 2 })); assert.equal(await pending, null)
  assert.equal(siteCalls, 1); assert.equal(homeCalls, 1); assert.equal(lifecycle.publication.value, null)
})

test('dispose during v2 model hydration keeps the detached publication empty after abort settles', async () => {
  let siteCalls = 0; let homeCalls = 0; let pageCalls = 0
  const store = createPublicContentState({ api: {
    getSite: () => Promise.resolve(++siteCalls === 1 ? response({ contentReleaseVersion: 1, priceReleaseVersion: 4, priceVisibility: 'visible' }, { content: 1, price: 4 }) : response({ contentReleaseVersion: 2, priceReleaseVersion: 4, priceVisibility: 'visible' }, { content: 2, price: 4 })),
    getHome: () => Promise.resolve(++homeCalls === 1 ? response({ document: 'home-v1', releaseVersion: 1 }, { content: 1 }) : response({ document: 'home-v2', releaseVersion: 2 }, { content: 2 })),
    getAbout: () => { pageCalls++; return Promise.resolve(response({ document: 'about-v2', releaseVersion: 2 }, { content: 2 })) },
    getModel: (_key, options) => new Promise(resolve => options.signal.addEventListener('abort', () => resolve(response({ model: null }, { price: 4 })), { once: true })),
  } })
  const lifecycle = createPublicLayoutPublication({ store, loadCodec: async () => ({ decode: document => ({ marker: document, shellLinks: [{ label: document }], modelKeys: document === 'home-v2' ? ['slow-model'] : [] }) }) })
  await lifecycle.init(); const detached = lifecycle.publication.value; await lifecycle.loadPage('about')
  for (let index = 0; index < 6 && !store.value.details['slow-model']; index++) await Promise.resolve()
  assert.equal(store.value.details['slow-model'].status, 'loading'); assert.equal(detached.home.value, null)
  lifecycle.dispose(); await lifecycle.homeHydration.value
  assert.equal(detached.home.value, null); assert.equal(lifecycle.publication.value, null); assert.equal(pageCalls, 2)
})
