const PREFIX = 'llm_platform_'

export function getItem(key, fallback = null, storage = globalThis.localStorage) {
  try {
    const raw = storage.getItem(PREFIX + key)
    return raw ? JSON.parse(raw) : fallback
  } catch {
    return fallback
  }
}

export function setItem(key, value, storage = globalThis.localStorage) {
  storage.setItem(PREFIX + key, JSON.stringify(value))
}

export function removeItem(key) {
  localStorage.removeItem(PREFIX + key)
}
