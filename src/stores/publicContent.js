import { defineStore } from 'pinia'
import { reactive } from 'vue'
import { publicContentApi, publicModelsResourceKey } from '../api/publicContent.js'

const slot = () => ({ status: 'idle', data: null, error: null })
const statusFor = error => error?.code === 'not_found' ? 'not_found' : error?.code === 'gone' ? 'gone' : 'error'

export function createPublicContentState({ api = publicContentApi } = {}) {
  const value = reactive({ site: slot(), home: slot(), models: slot(), details: {}, pages: { about: slot(), terms: slot(), privacy: slot() }, publicationVersions: { content: null, price: null }, cache: {} })
  const controllers = new Map(); const sequences = new Map()
  let activeRepresentation = null
  const representationFor = options => options.authenticated ? `authenticated:${String(options.authContext ?? 'current')}` : 'anonymous'
  const cacheKey = (key, representation) => `${representation}:${key}`
  function setApi(next) { api = { ...api, ...next } }
  function target(key) { if (key.startsWith('detail:')) return value.details[key.slice(7)] ||= slot(); if (key.startsWith('page:')) return value.pages[key.slice(5)]; return value[key] }
  function clearRenderState() {
    for (const controller of controllers.values()) controller.abort()
    controllers.clear()
    for (const key of sequences.keys()) sequences.set(key, sequences.get(key) + 1)
    for (const state of [value.site, value.home, value.models, ...Object.values(value.pages)]) { state.data = null; state.status = 'idle'; state.error = null }
    value.details = {}; value.cache = {}; value.publicationVersions.content = null; value.publicationVersions.price = null
  }
  function ensureRepresentation(options) {
    const next = representationFor(options)
    if (activeRepresentation !== null && activeRepresentation !== next) clearRenderState()
    activeRepresentation = next
    return next
  }
  function clearDomain(domain) {
    const isDomainResource = cacheResource => domain === 'content'
      ? cacheResource.includes('/public/home') || cacheResource.includes('/public/pages/')
      : cacheResource.includes('/public/models')
    for (const key of Object.keys(value.cache)) if (isDomainResource(key)) delete value.cache[key]
    if (domain === 'content') {
      for (const state of [value.home, ...Object.values(value.pages)]) { state.data = null; state.status = 'idle'; state.error = null }
    } else {
      value.models.data = null; value.models.status = 'idle'; value.models.error = null
      value.details = {}
    }
  }
  function bindVersions(key, incoming) {
    if (key === 'site') {
      for (const domain of ['content', 'price']) {
        const bound = value.publicationVersions[domain]
        if (bound !== null && incoming[domain] < bound) throw new Error('mixed_publication_generation')
      }
      const changed = ['content', 'price'].filter(domain => value.publicationVersions[domain] !== null && incoming[domain] > value.publicationVersions[domain])
      for (const domain of changed) clearDomain(domain)
      value.publicationVersions.content = incoming.content; value.publicationVersions.price = incoming.price
      return 'bound'
    }
    for (const [domain, version] of Object.entries(incoming)) {
      const bound = value.publicationVersions[domain]
      if (bound !== null && version < bound) throw new Error('mixed_publication_generation')
      if (bound !== null && version > bound) return 'confirm'
    }
    for (const [domain, version] of Object.entries(incoming)) if (value.publicationVersions[domain] === null) value.publicationVersions[domain] = version
    return 'bound'
  }
  async function load(key, method, args = [], options = {}, resource = key, confirmed = false) {
    const representation = ensureRepresentation(options)
    const current = (sequences.get(key) || 0) + 1; sequences.set(key, current)
    controllers.get(key)?.abort(); const controller = new AbortController(); controllers.set(key, controller)
    const state = target(key); state.status = state.data ? 'pending' : 'loading'; state.error = null
    const partition = cacheKey(resource, representation); const cached = options.force ? undefined : value.cache[partition]
    try {
      const result = await api[method](...args, { signal: controller.signal, authenticated: !!options.authenticated, etag: cached?.etag, cached })
      if (sequences.get(key) !== current) return null
      const inferred = result.publicationVersions || (key === 'site' ? { content: result.data.contentReleaseVersion, price: result.data.priceReleaseVersion } : { [key === 'models' || key.startsWith('detail:') ? 'price' : 'content']: result.releaseVersion })
      const binding = bindVersions(key, inferred)
      if (binding === 'confirm') {
        delete value.cache[partition]
        if (!confirmed && typeof api.getSite === 'function') {
          await load('site', 'getSite', [], { authenticated: !!options.authenticated, authContext: options.authContext, force: true }, '/api/v1/public/site', true)
          if (sequences.get(key) !== current) return null
          return load(key, method, args, { ...options, force: true }, resource, true)
        }
        throw new Error('mixed_publication_generation')
      }
      value.cache[partition] = { data: result.data, etag: result.etag, releaseVersion: result.releaseVersion, publicationVersions: inferred }
      state.data = result.data; state.status = Array.isArray(result.data?.items) && result.data.items.length === 0 ? 'ready-empty' : 'ready'; return result.data
    } catch (error) {
      if (sequences.get(key) !== current || error?.name === 'AbortError') return null
      state.error = error?.code || error?.message || 'request_failed'; state.status = statusFor(error)
      if (state.error === 'mixed_publication_generation') throw error
      return null
    } finally { if (sequences.get(key) === current) controllers.delete(key) }
  }
  function cancel(key) {
    sequences.set(key, (sequences.get(key) || 0) + 1); controllers.get(key)?.abort(); controllers.delete(key)
    const state = target(key); state.status = state.data ? 'ready' : 'idle'; state.error = null
  }
  return { value, setApi, loadSite: options => load('site', 'getSite', [], options, '/api/v1/public/site'), loadHome: options => load('home', 'getHome', [], options, '/api/v1/public/home'), loadModels: (filters = {}, options = {}) => load('models', 'getModels', [filters], options, publicModelsResourceKey(filters)), loadModel: (key, options = {}) => load(`detail:${key}`, 'getModel', [key], options, `/api/v1/public/models/${encodeURIComponent(key)}`), loadPage: (name, options = {}) => load(`page:${name}`, `get${name[0].toUpperCase()}${name.slice(1)}`, [], options, `/api/v1/public/pages/${name}`), cancel }
}

export const usePublicContentStore = defineStore('publicContent', () => createPublicContentState())
