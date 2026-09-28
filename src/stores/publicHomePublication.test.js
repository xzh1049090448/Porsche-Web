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
  } })
  const modelClient = { getModel: async key => response(models[key], { price: models[key].model.releaseVersion }) }
  const homeContent = createPublicHomeContentState({ api: { getHomeConfig: async () => ({ data: structuredHome(4, ['one', 'two']) }) } })
  const publication = createPublicHomePublication({ store, homeContent, modelClient })
  await publication.load()
  assert.deepEqual(publication.featuredModels.value.map(model => model.modelKey), ['one', 'two'])

  models.two = { model: { ...models.two.model, releaseVersion: 5 } }
  homeContent.setApi({ getHomeConfig: async () => ({ data: structuredHome(4, ['one', 'two']) }) })
  await publication.load()
  assert.equal(publication.featuredModels.value, null)
})

test('one failed featured detail aborts a permanently hanging sibling and settles hydration', async () => {
  let lateSignal; let lateAborted = false
  const store = createPublicContentState({ api: { getSite: async () => site() } })
  const modelClient = { getModel: async (key, options) => {
      if (key === 'bad') throw new Error('detail_failed')
      lateSignal = options.signal
      lateSignal.addEventListener('abort', () => { lateAborted = true }, { once: true })
      return new Promise(() => {})
    } }
  const homeContent = createPublicHomeContentState({ api: { getHomeConfig: async () => ({ data: structuredHome(4, ['bad', 'late']) }) } })
  const publication = createPublicHomePublication({ store, homeContent, modelClient })
  const outcome = await Promise.race([
    publication.load().then(value => ({ settled: true, value })),
    new Promise(resolve => setTimeout(() => resolve({ settled: false }), 30)),
  ])
  assert.equal(outcome.settled, true)
  assert.equal(outcome.value, null)
  assert.equal(lateSignal?.aborted, true)
  assert.equal(lateAborted, true)
  assert.equal(publication.featuredModels.value, null)
})

test('an obsolete round cannot cancel the same keys owned by a newer hydration', async () => {
  let rejectOldBad
  const oldBad = new Promise((_, reject) => { rejectOldBad = reject })
  const calls = new Map(); const firstSignals = new Map(); const secondSignals = new Map()
  const store = createPublicContentState({ api: { getSite: async () => site() } })
  const modelClient = { getModel: (key, options) => {
      const call = (calls.get(key) || 0) + 1; calls.set(key, call)
      if (call === 1) {
        firstSignals.set(key, options.signal)
        return key === 'bad' ? oldBad : new Promise(() => {})
      }
      secondSignals.set(key, options.signal)
      return Promise.resolve(response({ model: { modelKey: key, displayName: key, provider: 'P', releaseVersion: 4 } }, { price: 4 }))
    } }
  const config = async () => ({ data: structuredHome(4, ['bad', 'late']) })
  const homeContent = createPublicHomeContentState({ api: { getHomeConfig: config } })
  const publication = createPublicHomePublication({ store, homeContent, modelClient })
  const first = publication.load()
  for (let index = 0; index < 8 && firstSignals.size < 2; index++) await Promise.resolve()
  homeContent.setApi({ getHomeConfig: config })
  const second = publication.load()
  for (let index = 0; index < 8 && secondSignals.size < 2; index++) await Promise.resolve()
  rejectOldBad(new Error('old_failure'))
  assert.equal(await first, null)
  assert.deepEqual((await second).map(model => model.modelKey), ['bad', 'late'])
  assert.equal(firstSignals.get('late').aborted, true)
  assert.equal(secondSignals.get('bad').aborted, false)
  assert.equal(secondSignals.get('late').aborted, false)
})

test('homepage cleanup cannot abort a same-key detail request owned by another consumer', async () => {
  const detailResult = deferred(); let homepageSignal; let detailSignal; let rejectHomepage
  const store = createPublicContentState({ api: {
    getSite: async () => site(),
    getModel: (_key, options) => {
      detailSignal = options.signal
      return detailResult.promise
    },
  } })
  const modelClient = { getModel: (key, options) => {
    if (key === 'model-b') return new Promise((_, reject) => { rejectHomepage = reject })
    homepageSignal = options.signal
    return new Promise((_, reject) => homepageSignal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true }))
  } }
  const homeContent = createPublicHomeContentState({ api: { getHomeConfig: async () => ({ data: structuredHome(4, ['model-a', 'model-b']) }) } })
  const publication = createPublicHomePublication({ store, homeContent, modelClient })
  const homepage = publication.load()
  for (let index = 0; index < 8 && (!homepageSignal || !rejectHomepage); index++) await Promise.resolve()
  const detail = store.loadModel('model-a')
  for (let index = 0; index < 8 && !detailSignal; index++) await Promise.resolve()
  rejectHomepage(new Error('homepage_model_failed'))
  await homepage
  assert.equal(homepageSignal.aborted, true)
  assert.equal(detailSignal?.aborted, false)
  detailResult.resolve(response({ model: { modelKey: 'model-a', displayName: 'Detail', provider: 'P', releaseVersion: 4 } }, { price: 4 }))
  assert.equal((await detail)?.model.displayName, 'Detail')
  assert.equal(store.value.details['model-a'].status, 'ready')
})

test('disposing structured home hydration aborts details and ignores every late result', async () => {
  const detail = deferred(); let detailSignal
  const store = createPublicContentState({ api: { getSite: async () => site() } })
  const modelClient = { getModel: (_key, options) => { detailSignal = options.signal; return detail.promise } }
  const homeContent = createPublicHomeContentState({ api: { getHomeConfig: async () => ({ data: structuredHome(4, ['one']) }) } })
  const publication = createPublicHomePublication({ store, homeContent, modelClient })
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
