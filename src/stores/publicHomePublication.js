import { shallowRef } from 'vue'

export function createPublicHomePublication({ store, decode }) {
  const home = shallowRef(null); const activeModelKeys = new Set()
  function verifiedHome() {
    const state = store.value; const version = state.publicationVersions.content
    if (state.site.status !== 'ready' || state.home.status !== 'ready' || !state.home.data || state.site.data?.contentReleaseVersion !== version || state.home.data.releaseVersion !== version) return null
    try { return decode(state.home.data.document) } catch { return null }
  }
  async function load() {
    home.value = null
    const loads = [store.loadHome()]; if (store.value.site.status !== 'ready') loads.unshift(store.loadSite())
    await Promise.allSettled(loads)
    const decoded = verifiedHome()
    if (!decoded) return null
    const contentVersion = store.value.publicationVersions.content; const priceVersion = store.value.publicationVersions.price
    for (const key of decoded.modelKeys) activeModelKeys.add(key)
    await Promise.allSettled(decoded.modelKeys.map(key => store.loadModel(key)))
    for (const key of decoded.modelKeys) activeModelKeys.delete(key)
    if (store.value.publicationVersions.content === contentVersion && store.value.publicationVersions.price === priceVersion && store.value.home.data?.releaseVersion === contentVersion) home.value = decoded
    return home.value
  }
  function cancel() { store.cancel('site'); store.cancel('home'); for (const key of activeModelKeys) store.cancel(`detail:${key}`); activeModelKeys.clear(); home.value = null }
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
    if (publication.value) publication.value.home.value = null
    activePages.add(name)
    const page = await loadVerifiedPublicPage(store, name)
    activePages.delete(name)
    if (disposed || !page) return null
    if (publication.value) homeHydration.value = publication.value.load()
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
