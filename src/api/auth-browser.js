const KEY = 'porsche_auth_coordination_v1'
const LOCK = 'porsche_auth_cookie_v1'

/** Browser-only adapter; no credentials or account data enter storage or messages. */
export function createBrowserAuthAdapter(environment = globalThis) {
  let channel
  let storage
  let available = false
  try {
    storage = environment.localStorage
    for (const key of ['llm_platform_token', 'llm_platform_user', 'token', 'user']) storage.removeItem(key)
    available = Boolean(environment.isSecureContext && environment.navigator?.locks?.request && environment.BroadcastChannel && storage)
    if (available) {
      channel = new environment.BroadcastChannel(LOCK)
    }
  } catch { available = false }
  return {
    available,
    id: () => environment.crypto.randomUUID(),
    read: () => {
      const value = storage.getItem(KEY)
      return value ? JSON.parse(value) : { epoch: 'initial', pending: null, suppressed: false }
    },
    write: record => storage.setItem(KEY, JSON.stringify(record)),
    lock: fn => environment.navigator.locks.request(LOCK, { mode: 'exclusive' }, fn),
    publish: message => channel.postMessage({ type: 'invalidate', epoch: message.epoch }),
    subscribe: fn => {
      const listener = event => fn(event.data)
      channel?.addEventListener('message', listener)
      return () => channel?.removeEventListener('message', listener)
    },
  }
}
