import test from 'node:test'
import assert from 'node:assert/strict'
import { createPublicContentState } from './publicContent.js'
import { createPublicHomeContentState } from './publicHomeContent.js'
import { createPublicHomePublication, createPublicLayoutPublication, loadVerifiedPublicPage, verifiedPublicPageData } from './publicHomePublication.js'

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
const response = (data, versions) => ({ data, etag: '"x"', releaseVersion: Object.values(versions)[0], publicationVersions: versions })
const structuredHome = (priceReleaseVersion = 4, featuredModelKeys = []) => ({ announcements: [], faqs: [], featuredModelKeys, contentReleaseVersion: 2, priceReleaseVersion })
const site = (content = 2, price = 4) => response({ contentReleaseVersion: content, priceReleaseVersion: price, priceVisibility: 'visible' }, { content, price })

test('fixed layout starts structured home config without requesting legacy home or a codec', async () => {
  let legacyHomeCalls = 0; let configCalls = 0
  const store = createPublicContentState({ api: {
    getSite: async () => site(),
    getHome: async () => { legacyHomeCalls++; throw new Error('legacy_home_forbidden') },
  } })
  const homeContent = createPublicHomeContentState({ api: { getHomeConfig: async () => { configCalls++; return { data: structuredHome() } } } })
  const lifecycle = createPublicLayoutPublication({ store, homeContent })
  await lifecycle.init(); await lifecycle.siteReady
  assert.equal(configCalls, 1); assert.equal(legacyHomeCalls, 0)
  assert.equal(homeContent.value.value.status, 'ready')
  lifecycle.dispose()
})

test('featured models render only when every detail matches the home price generation', async () => {
  const models = {
    one: { model: { modelKey: 'one', displayName: 'One', provider: 'P', releaseVersion: 4 } },
    two: { model: { modelKey: 'two', displayName: 'Two', provider: 'P', releaseVersion: 4 } },
  }
  const store = createPublicContentState({ api: {
    getSite: async () => site(),
    getModel: async key => response(models[key], { price: models[key].model.releaseVersion }),
  } })
  const homeContent = createPublicHomeContentState({ api: { getHomeConfig: async () => ({ data: structuredHome(4, ['one', 'two']) }) } })
  const publication = createPublicHomePublication({ store, homeContent })
  await publication.load()
  assert.deepEqual(publication.featuredModels.value.map(model => model.modelKey), ['one', 'two'])

  models.two = { model: { ...models.two.model, releaseVersion: 5 } }
  homeContent.setApi({ getHomeConfig: async () => ({ data: structuredHome(4, ['one', 'two']) }) })
  await publication.load()
  assert.equal(publication.featuredModels.value, null)
})

test('disposing structured home hydration aborts details and ignores every late result', async () => {
  const detail = deferred(); let detailSignal
  const store = createPublicContentState({ api: {
    getSite: async () => site(),
    getModel: (_key, options) => { detailSignal = options.signal; return detail.promise },
  } })
  const homeContent = createPublicHomeContentState({ api: { getHomeConfig: async () => ({ data: structuredHome(4, ['one']) }) } })
  const publication = createPublicHomePublication({ store, homeContent })
  const loading = publication.load()
  for (let index = 0; index < 8 && !detailSignal; index++) await Promise.resolve()
  publication.cancel()
  assert.equal(detailSignal.aborted, true)
  detail.resolve(response({ model: { modelKey: 'one', displayName: 'Late', provider: 'P', releaseVersion: 4 } }, { price: 4 }))
  await loading
  assert.equal(publication.featuredModels.value, null)
  assert.equal(homeContent.value.value.status, 'idle')
})

test('an empty featured list never requests model detail', async () => {
  let modelCalls = 0
  const store = createPublicContentState({ api: { getSite: async () => site(), getModel: async () => { modelCalls++; throw new Error('unexpected_model') } } })
  const homeContent = createPublicHomeContentState({ api: { getHomeConfig: async () => ({ data: structuredHome() }) } })
  const publication = createPublicHomePublication({ store, homeContent })
  assert.deepEqual(await publication.load(), [])
  assert.equal(modelCalls, 0)
})

test('shell content v2 rejects a stale page v1 instead of rendering mixed publication content', async () => {
  const store = createPublicContentState({ api: { getSite: async () => site(), getAbout: async () => response({ document: 'about-v1', releaseVersion: 1 }, { content: 1 }) } })
  await store.loadSite(); assert.equal(await loadVerifiedPublicPage(store, 'about'), null); assert.equal(verifiedPublicPageData(store, 'about'), null); assert.equal(store.value.pages.about.status, 'error')
})

test('an out-of-order page upgrade refetches site and page before exposing v2', async () => {
  let siteCalls = 0; let pageCalls = 0
  const store = createPublicContentState({ api: {
    getSite: async () => ++siteCalls === 1 ? site(1) : site(2),
    getPrivacy: async () => { pageCalls++; return response({ document: 'privacy-v2', releaseVersion: 2 }, { content: 2 }) },
  } })
  await store.loadSite(); const page = await loadVerifiedPublicPage(store, 'privacy')
  assert.equal(page.document, 'privacy-v2'); assert.equal(siteCalls, 2); assert.equal(pageCalls, 2)
})

test('route cleanup invalidates pending terms so it cannot survive after privacy wins', async () => {
  const terms = deferred()
  const store = createPublicContentState({ api: { getSite: async () => site(), getTerms: () => terms.promise, getPrivacy: async () => response({ document: 'privacy-v2', releaseVersion: 2 }, { content: 2 }) } })
  await store.loadSite(); const pending = store.loadPage('terms'); store.invalidatePage('terms'); const privacy = await loadVerifiedPublicPage(store, 'privacy')
  terms.resolve(response({ document: 'terms-v2', releaseVersion: 2 }, { content: 2 })); await pending
  assert.equal(store.value.pages.terms.data, null); assert.equal(store.value.pages.terms.status, 'idle'); assert.equal(privacy.document, 'privacy-v2')
})

test('a hanging structured homepage never blocks a verified about page after site readiness', async () => {
  const never = new Promise(() => {})
  const store = createPublicContentState({ api: { getSite: async () => site(), getAbout: async () => response({ document: 'about-v2', releaseVersion: 2 }, { content: 2 }) } })
  const homeContent = createPublicHomeContentState({ api: { getHomeConfig: () => never } })
  const lifecycle = createPublicLayoutPublication({ store, homeContent })
  void lifecycle.init(); await lifecycle.siteReady
  const about = await lifecycle.loadPage('about')
  assert.equal(about.document, 'about-v2'); assert.equal(homeContent.value.value.status, 'loading')
  lifecycle.dispose(); assert.equal(homeContent.value.value.status, 'idle')
})

test('a hidden structured homepage never blocks fixed-page lifecycle', async () => {
  const store = createPublicContentState({ api: { getSite: async () => site(), getPrivacy: async () => response({ document: 'privacy-v2', releaseVersion: 2 }, { content: 2 }) } })
  const homeContent = createPublicHomeContentState({ api: { getHomeConfig: async () => { throw Object.assign(new Error('unavailable'), { code: 'unavailable', requestId: 'safe-id' }) } } })
  const lifecycle = createPublicLayoutPublication({ store, homeContent })
  await lifecycle.init()
  assert.equal(homeContent.value.value.status, 'hidden')
  assert.equal((await lifecycle.loadPage('privacy')).document, 'privacy-v2')
  lifecycle.dispose()
})

test('dispose cancels an in-flight page and prevents late page mutation', async () => {
  const about = deferred()
  const store = createPublicContentState({ api: { getSite: async () => site(), getAbout: () => about.promise } })
  const homeContent = createPublicHomeContentState({ api: { getHomeConfig: async () => ({ data: structuredHome() }) } })
  const lifecycle = createPublicLayoutPublication({ store, homeContent })
  await lifecycle.init(); const pending = lifecycle.loadPage('about'); lifecycle.dispose()
  about.resolve(response({ document: 'about-v2', releaseVersion: 2 }, { content: 2 }))
  assert.equal(await pending, null); assert.equal(store.value.pages.about.status, 'idle'); assert.equal(lifecycle.publication.value, null)
})
