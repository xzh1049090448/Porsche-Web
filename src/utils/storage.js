const PREFIX = 'llm_platform_'

function resolveStorage(storage) {
  return storage === undefined ? globalThis.localStorage : storage
}

export function getItem(key, fallback = null, storage) {
  try {
    const raw = resolveStorage(storage)?.getItem(PREFIX + key)
    return raw ? JSON.parse(raw) : fallback
  } catch {
    return fallback
  }
}

export function setItem(key, value, storage) {
  try {
    const target = resolveStorage(storage)
    if (!target) return false
    target.setItem(PREFIX + key, JSON.stringify(value))
    return true
  } catch {
    return false
  }
}

export function removeItem(key, storage) {
  try {
    const target = resolveStorage(storage)
    if (!target) return false
    target.removeItem(PREFIX + key)
    return true
  } catch {
    return false
  }
}
