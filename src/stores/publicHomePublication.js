import { shallowRef } from 'vue'

export function createPublicHomePublication({ store, decode }) {
  const home = shallowRef(null)
  function verifiedHome() {
    const state = store.value; const version = state.publicationVersions.content
    if (state.site.status !== 'ready' || state.home.status !== 'ready' || !state.home.data || state.site.data?.contentReleaseVersion !== version || state.home.data.releaseVersion !== version) return null
    try { return decode(state.home.data.document) } catch { return null }
  }
  async function load() {
    home.value = null
    const loads = [store.loadHome()]; if (store.value.site.status !== 'ready') loads.unshift(store.loadSite())
    await Promise.allSettled(loads)
    home.value = verifiedHome()
    if (!home.value) return null
    const contentVersion = store.value.publicationVersions.content; const priceVersion = store.value.publicationVersions.price
    await Promise.allSettled(home.value.modelKeys.map(key => store.loadModel(key)))
    if (store.value.publicationVersions.content !== contentVersion || store.value.publicationVersions.price !== priceVersion || store.value.home.data?.releaseVersion !== contentVersion) home.value = null
    return home.value
  }
  function cancel() { store.cancel('site'); store.cancel('home'); for (const key of home.value?.modelKeys || []) store.cancel(`detail:${key}`); home.value = null }
  return { home, load, cancel }
}

export function createPublicLayoutPublication({ store, loadCodec }) {
  const publication = shallowRef(null); let disposed = false; let settled = false; let resolveReady
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
      await publication.value.load()
    } catch {} finally { settle() }
  }
  function dispose() { disposed = true; publication.value?.cancel(); publication.value = null; store.cancel('site'); settle() }
  return { publication, siteReady, init, dispose }
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
