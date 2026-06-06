import { messages } from './messages'

function lookup(locale, key) {
  const keys = key.split('.')
  let val = messages[locale]
  for (const k of keys) {
    val = val?.[k]
  }
  if (val != null) return val
  val = messages.zh
  for (const k of keys) {
    val = val?.[k]
  }
  return val
}

export function translate(locale, key, params = {}) {
  const val = lookup(locale, key)
  if (typeof val !== 'string') return key
  return val.replace(/\{(\w+)\}/g, (_, name) =>
    params[name] != null ? String(params[name]) : `{${name}}`
  )
}

export function translateArray(locale, key) {
  const val = lookup(locale, key)
  return Array.isArray(val) ? val : []
}
