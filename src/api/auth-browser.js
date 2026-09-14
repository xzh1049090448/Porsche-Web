const KEY = 'porsche_auth_coordination_v1'
const LOCK = 'porsche_auth_cookie_v1'
const RECOVERY_LOCK = 'porsche_auth_recovery_v1'
const PROBE_KEY = 'porsche_auth_probe_v1'

function capabilityFailure(environment) {
  if (!environment.isSecureContext) return 'auth_insecure_context'
  if (typeof environment.navigator?.locks?.request !== 'function') return 'auth_web_locks_unavailable'
  if (typeof environment.BroadcastChannel !== 'function') return 'auth_broadcast_channel_unavailable'
  return null
}

/** Browser-only adapter; no credentials or account data enter storage or messages. */
export function createBrowserAuthAdapter(environment = globalThis) {
  let channel
  let storage
  let capability = { available: false, code: 'auth_storage_unavailable' }
  const subscribers = new Set()

  function ensureChannel() {
    if (!channel) {
      let nextChannel
      try {
        nextChannel = new environment.BroadcastChannel(LOCK)
        nextChannel.addEventListener('message', event => {
          for (const fn of subscribers) {
            try { fn(event.data) } catch { /* Isolate subscriber failures. */ }
          }
        })
        channel = nextChannel
      } catch (error) {
        try { nextChannel?.close?.() } catch { /* Leave the live channel unset. */ }
        throw error
      }
    }
    return channel
  }

  function probe() {
    const code = capabilityFailure(environment)
    if (code) return (capability = { available: false, code })
    try {
      storage = environment.localStorage
      storage.setItem(PROBE_KEY, '1')
      if (storage.getItem(PROBE_KEY) !== '1') throw Error('probe_not_persisted')
      storage.removeItem(PROBE_KEY)
    } catch {
      try { storage?.removeItem(PROBE_KEY) } catch { /* keep unavailable */ }
      return (capability = { available: false, code: 'auth_storage_unavailable' })
    }
    try { ensureChannel() } catch {
      return (capability = { available: false, code: 'auth_broadcast_channel_unavailable' })
    }
    return (capability = { available: true, code: null })
  }

  try {
    storage = environment.localStorage
    for (const key of ['llm_platform_token', 'llm_platform_user', 'token', 'user']) {
      try { storage?.removeItem(key) } catch { /* Capability probe reports storage denial. */ }
    }
  } catch { /* Capability probe reports storage denial. */ }
  probe()
  return {
    get available() { return capability.available },
    capabilityCode: () => capability.code,
    probe,
    id: () => environment.crypto.randomUUID(),
    read: () => {
      const value = storage.getItem(KEY)
      return value ? JSON.parse(value) : { epoch: 'initial', pending: null, suppressed: false }
    },
    write: record => storage.setItem(KEY, JSON.stringify(record)),
    lock: fn => environment.navigator.locks.request(LOCK, { mode: 'exclusive' }, fn),
    recoveryLock: (owner, inspect) => environment.navigator.locks.request(RECOVERY_LOCK, { mode: 'exclusive', ifAvailable: true }, lock => {
      if (lock) return owner()
      return environment.navigator.locks.request(RECOVERY_LOCK, { mode: 'exclusive' }, inspect)
    }),
    publish: message => channel?.postMessage({ type: 'invalidate', epoch: message.epoch }),
    subscribe: fn => {
      subscribers.add(fn)
      return () => subscribers.delete(fn)
    },
  }
}
