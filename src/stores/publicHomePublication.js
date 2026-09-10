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
    await Promise.allSettled([store.loadSite(), store.loadHome()])
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
