import { ref } from 'vue'
import { translate } from './index.js'
import { getItem, setItem } from '../utils/storage.js'

export const PUBLIC_LOCALE_KEY = 'uiLocale'
export function readPublicLocale(storage) { return getItem(PUBLIC_LOCALE_KEY, 'zh', storage) === 'en' ? 'en' : 'zh' }
export function publicText(locale, key, params) { return translate(locale, `publicSite.${key}`, params) }
const sharedLocale = ref(readPublicLocale())
export function applyPublicLocale(locale, target = globalThis.document) { if (!target) return; target.documentElement.lang = locale === 'en' ? 'en' : 'zh-CN'; target.title = translate(locale, 'app.title') }
export function persistPublicLocale(locale, storage, target = globalThis.document) { const value = locale === 'en' ? 'en' : 'zh'; setItem(PUBLIC_LOCALE_KEY, value, storage); applyPublicLocale(value, target); return value }
export function usePublicI18n() {
  const locale = sharedLocale
  const t = (key, params) => publicText(locale.value, key, params)
  applyPublicLocale(locale.value)
  function toggle() { locale.value = locale.value === 'zh' ? 'en' : 'zh'; try { persistPublicLocale(locale.value) } catch { applyPublicLocale(locale.value) } }
  return { locale, t, toggle }
}
