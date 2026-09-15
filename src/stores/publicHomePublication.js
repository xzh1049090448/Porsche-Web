import { shallowRef, watch } from 'vue'

const readyStructuredHome = homeContent => {
  const state = homeContent?.value?.value
  return state?.status === 'ready' && state.data ? state.data : null
}

export function createPublicHomePublication({ store, homeContent, loadSite } = {}) {
  const featuredModels = shallowRef(null)
  const activeModelLoads = new Map()
  const modelOwners = new Map()
  let epoch = 0

  const releaseModelLoads = (owner, cancel = false) => {
    const keys = activeModelLoads.get(owner)
    if (!keys) return
    for (const key of keys) {
      if (modelOwners.get(key) !== owner) continue
      modelOwners.delete(key)
      if (cancel) store.cancel(`detail:${key}`)
    }
    activeModelLoads.delete(owner)
  }

  const cancelModels = () => {
    for (const owner of [...activeModelLoads.keys()]) releaseModelLoads(owner, true)
  }

  async function load() {
    const current = ++epoch
    cancelModels()
    featuredModels.value = null
    const siteLoad = Promise.resolve(loadSite ? loadSite() : store.value.site.status === 'ready' ? null : store.loadSite())
    await homeContent.load()
    if (current !== epoch) return null
    const home = readyStructuredHome(homeContent)
    if (!home) return null
    const keys = home.featuredModelKeys
    if (!keys.length) { featuredModels.value = Object.freeze([]); return featuredModels.value }

    await siteLoad
    if (current !== epoch) return null
    const expectedPriceVersion = home.priceReleaseVersion
    const state = store.value
    if (state.site.status !== 'ready' || state.site.data?.priceReleaseVersion !== expectedPriceVersion || state.publicationVersions.price !== expectedPriceVersion) return null

    activeModelLoads.set(current, keys)
    for (const key of keys) modelOwners.set(key, current)
    let loadedModels
    try {
      loadedModels = await Promise.all(keys.map(async key => {
        const detail = await store.loadModel(key)
        if (current !== epoch || modelOwners.get(key) !== current) throw new Error('obsolete_featured_model_load')
        const model = detail?.model
        if (!model || model.modelKey !== key || model.releaseVersion !== expectedPriceVersion) throw new Error('invalid_featured_model_generation')
        return model
      }))
    } catch {
      if (current === epoch) releaseModelLoads(current, true)
      return null
    }
    if (current !== epoch) return null
    const currentState = store.value
    if (currentState.site.status !== 'ready' || currentState.site.data?.priceReleaseVersion !== expectedPriceVersion || currentState.publicationVersions.price !== expectedPriceVersion) {
      releaseModelLoads(current, true)
      return null
    }
    const models = keys.map(key => currentState.details[key])
    if (models.some((slot, index) => slot?.status !== 'ready' || slot.data?.model?.modelKey !== keys[index] || slot.data.model.releaseVersion !== expectedPriceVersion)) {
      releaseModelLoads(current, true)
      return null
    }
    releaseModelLoads(current)
    featuredModels.value = Object.freeze(loadedModels)
    return featuredModels.value
  }

  function cancel() {
    epoch++
    cancelModels()
    homeContent.dispose()
    featuredModels.value = null
  }

  return Object.freeze({ homeContent, featuredModels, load, cancel })
}

export function createPublicLayoutPublication({ store, homeContent } = {}) {
  const publication = shallowRef(null)
  const homeHydration = shallowRef(Promise.resolve(null))
  const activePages = new Set()
  let disposed = false
  let settled = false
  let resolveReady
  let siteLoad = null
  let retryPromise = null
  const siteReady = new Promise(resolve => { resolveReady = resolve })
  const settle = () => { if (!settled) { settled = true; resolveReady() } }

  function ensureSite() {
    if (disposed) { settle(); return Promise.resolve(null) }
    if (store.value.site.status === 'ready') { settle(); return Promise.resolve(store.value.site.data) }
    if (siteLoad) return siteLoad
    const running = Promise.resolve(store.loadSite()).catch(() => null).finally(() => {
      if (siteLoad === running) siteLoad = null
      settle()
    })
    siteLoad = running
    return running
  }

  publication.value = createPublicHomePublication({ store, homeContent, loadSite: ensureSite })

  function loadHome() {
    if (disposed) return Promise.resolve(null)
    if (retryPromise) return retryPromise
    const running = publication.value.load().catch(() => null).finally(() => { if (retryPromise === running) retryPromise = null })
    retryPromise = running
    homeHydration.value = running
    return running
  }

  function init() {
    void ensureSite()
    return loadHome()
  }

  async function loadPage(name) {
    if (disposed) return null
    const generation = store.value.publicationVersions.content
    let advanced = false
    const stop = watch(() => store.value.publicationVersions.content, next => {
      if (Number.isSafeInteger(generation) && Number.isSafeInteger(next) && next > generation) advanced = true
    }, { flush: 'sync' })
    activePages.add(name)
    try {
      const page = await loadVerifiedPublicPage(store, name)
      if (disposed) return null
      if (page && advanced) void loadHome()
      return page
    } finally {
      stop()
      activePages.delete(name)
    }
  }

  function dispose() {
    disposed = true
    for (const name of activePages) store.invalidatePage(name)
    activePages.clear()
    publication.value?.cancel()
    publication.value = null
    store.cancel('site')
    settle()
  }

  return Object.freeze({ publication, homeHydration, siteReady, init, loadHome, loadPage, dispose })
}

export function verifiedPublicPageData(store, name) {
  const state = store.value; const page = state.pages[name]; const version = state.publicationVersions.content
  return state.site.status === 'ready' && page?.status === 'ready' && state.site.data?.contentReleaseVersion === version && page.data?.releaseVersion === version ? page.data : null
}

export async function loadVerifiedPublicPage(store, name) {
  try {
    if (store.value.site.status !== 'ready') await store.loadSite()
    await store.loadPage(name)
  } catch {}
  return verifiedPublicPageData(store, name)
}
