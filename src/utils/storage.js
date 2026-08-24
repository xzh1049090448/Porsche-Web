const PREFIX = 'llm_platform_'

export function getItem(key, fallback = null) {
  try {
    const raw = localStorage.getItem(PREFIX + key)
    return raw ? JSON.parse(raw) : fallback
  } catch {
    return fallback
  }
}

export function setItem(key, value) {
  localStorage.setItem(PREFIX + key, JSON.stringify(value))
}

export function removeItem(key) {
  localStorage.removeItem(PREFIX + key)
}
