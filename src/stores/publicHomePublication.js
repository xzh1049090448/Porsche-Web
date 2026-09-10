import { shallowRef, watch } from 'vue'

export function createPublicHomePublication({ store, decode }) {
  const home = shallowRef(null); const activeModelLoads = new Map(); let epoch = 0
  function verifiedHome() {
    const state = store.value; const version = state.publicationVersions.content
    if (state.site.status !== 'ready' || state.home.status !== 'ready' || !state.home.data || state.site.data?.contentReleaseVersion !== version || state.home.data.releaseVersion !== version) return null
    try { return decode(state.home.data.document) } catch { return null }
  }
  async function load() {
    const current = ++epoch
    home.value = null
    const loads = [store.loadHome()]; if (store.value.site.status !== 'ready') loads.unshift(store.loadSite())
    await Promise.allSettled(loads)
    if (current !== epoch) return null
    const decoded = verifiedHome()
    if (!decoded) return null
    const contentVersion = store.value.publicationVersions.content; const priceVersion = store.value.publicationVersions.price
    activeModelLoads.set(current, decoded.modelKeys)
    await Promise.allSettled(decoded.modelKeys.map(key => store.loadModel(key)))
    activeModelLoads.delete(current)
    if (current !== epoch) return null
    if (store.value.publicationVersions.content === contentVersion && store.value.publicationVersions.price === priceVersion && store.value.home.data?.releaseVersion === contentVersion && current === epoch) home.value = decoded
    return home.value
  }
  function cancel() { epoch++; store.cancel('site'); store.cancel('home'); for (const keys of activeModelLoads.values()) for (const key of keys) store.cancel(`detail:${key}`); activeModelLoads.clear(); home.value = null }
  return { home, load, cancel }
}

export function createPublicLayoutPublication({ store, loadCodec }) {
  const publication = shallowRef(null); const homeHydration = shallowRef(Promise.resolve(null)); const activePages = new Set(); let disposed = false; let settled = false; let resolveReady
  const siteReady = new Promise(resolve => { resolveReady = resolve })
  const settle = () => { if (!settled) { settled = true; resolveReady() } }
  async function init() {
    try {
      const codec = await loadCodec()
      if (disposed) return
      await store.loadSite()
      if (disposed) return
      settle()
      if (store.value.site.status !== 'ready') return
      publication.value = createPublicHomePublication({ store, decode: document => codec.decode(document) })
      homeHydration.value = publication.value.load(); await homeHydration.value
    } catch {} finally { settle() }
  }
  async function loadPage(name) {
    if (disposed) return null
    const generation = store.value.publicationVersions.content; let advanced = false
    const stop = watch(() => store.value.publicationVersions.content, next => { if (Number.isSafeInteger(generation) && Number.isSafeInteger(next) && next > generation) { advanced = true; if (publication.value) publication.value.home.value = null } }, { flush: 'sync' })
    activePages.add(name)
    const page = await loadVerifiedPublicPage(store, name)
    stop()
    activePages.delete(name)
    if (disposed) return null
    if (advanced && publication.value) homeHydration.value = publication.value.load()
    return page
  }
  function dispose() { disposed = true; for (const name of activePages) store.invalidatePage(name); activePages.clear(); publication.value?.cancel(); publication.value = null; store.cancel('site'); settle() }
  return { publication, homeHydration, siteReady, init, loadPage, dispose }
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
