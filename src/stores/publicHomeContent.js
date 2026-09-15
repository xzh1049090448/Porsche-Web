import { shallowRef } from 'vue'

const SAFE_CODES = new Set(['authentication_required', 'not_found', 'gone', 'unavailable', 'request_failed', 'network_error', 'invalid_response', 'invalid_response_headers', 'invalid_304', 'mixed_publication_generation'])
const safeRequestId = value => typeof value === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(value) ? value : null
const freezeCopy = value => Array.isArray(value) ? Object.freeze(value.map(freezeCopy)) : value && typeof value === 'object' ? Object.freeze(Object.fromEntries(Object.entries(value).map(([key, item]) => [key, freezeCopy(item)]))) : value
const snapshot = (status, data = null, error = null) => Object.freeze({ status, data, error })
const ownDataValue = (value, key) => {
  try {
    if (!value || (typeof value !== 'object' && typeof value !== 'function')) return undefined
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined
  } catch { return undefined }
}
const safeError = error => {
  const code = ownDataValue(error, 'code')
  const requestId = ownDataValue(error, 'requestId')
  return Object.freeze({ code: SAFE_CODES.has(code) ? code : 'request_failed', requestId: safeRequestId(requestId) })
}

export function createPublicHomeContentState({ api } = {}) {
  let currentApi = api
  const value = shallowRef(snapshot('idle'))
  let generation = 0
  let controller = null
  async function load() {
    const own = ++generation
    controller?.abort()
    controller = new AbortController()
    const ownController = controller
    value.value = snapshot('loading')
    try {
      const result = await currentApi.getHomeConfig({ signal: ownController.signal })
      if (own !== generation) return null
      const data = freezeCopy(result.data)
      value.value = snapshot('ready', data)
      return data
    } catch (error) {
      if (own !== generation || ownController.signal.aborted) return null
      value.value = snapshot('hidden', null, safeError(error))
      return null
    } finally {
      if (own === generation) controller = null
    }
  }
  function dispose() { generation++; controller?.abort(); controller = null; value.value = snapshot('idle') }
  function setApi(next) { generation++; controller?.abort(); controller = null; currentApi = next; value.value = snapshot('idle') }
  return Object.freeze({ value, load, dispose, setApi })
}
