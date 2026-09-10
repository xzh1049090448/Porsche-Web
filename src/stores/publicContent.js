import { defineStore } from 'pinia'
import { reactive } from 'vue'
import { publicContentApi } from '../api/publicContent.js'

const slot = () => ({ status: 'idle', data: null, error: null })
const statusFor = error => error?.code === 'not_found' ? 'not_found' : error?.code === 'gone' ? 'gone' : 'error'

export function createPublicContentState({ api = publicContentApi } = {}) {
  const value = reactive({ site: slot(), home: slot(), models: slot(), details: {}, pages: { about: slot(), terms: slot(), privacy: slot() }, generation: null, cache: {} })
  const controllers = new Map(); const sequences = new Map()
  const cacheKey = (key, authenticated) => `${authenticated ? 'authenticated' : 'anonymous'}:${key}`
  function setApi(next) { api = { ...api, ...next } }
  function target(key) { if (key.startsWith('detail:')) return value.details[key.slice(7)] ||= slot(); if (key.startsWith('page:')) return value.pages[key.slice(5)]; return value[key] }
  async function load(key, method, args = [], options = {}) {
    const current = (sequences.get(key) || 0) + 1; sequences.set(key, current)
    controllers.get(key)?.abort(); const controller = new AbortController(); controllers.set(key, controller)
    const state = target(key); state.status = state.data ? 'pending' : 'loading'; state.error = null
    const partition = cacheKey(key, !!options.authenticated); const cached = value.cache[partition]
    try {
      const result = await api[method](...args, { signal: controller.signal, authenticated: !!options.authenticated, etag: cached?.etag, cached })
      if (sequences.get(key) !== current) return null
      if (value.generation !== null && value.generation !== result.releaseVersion) throw new Error('mixed_publication_generation')
      value.generation = result.releaseVersion; value.cache[partition] = { data: result.data, etag: result.etag, releaseVersion: result.releaseVersion }
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
  return { value, setApi, loadSite: options => load('site', 'getSite', [], options), loadHome: options => load('home', 'getHome', [], options), loadModels: (filters = {}, options = {}) => load('models', 'getModels', [filters], options), loadModel: (key, options = {}) => load(`detail:${key}`, 'getModel', [key], options), loadPage: (name, options = {}) => load(`page:${name}`, `get${name[0].toUpperCase()}${name.slice(1)}`, [], options), cancel }
}

export const usePublicContentStore = defineStore('publicContent', () => createPublicContentState())
