import { ref } from 'vue'
import { translate } from './index.js'

export const PUBLIC_LOCALE_KEY = 'uiLocale'
export function readPublicLocale(storage = globalThis.localStorage) { try { return storage?.getItem(PUBLIC_LOCALE_KEY) === 'en' ? 'en' : 'zh' } catch { return 'zh' } }
export function publicText(locale, key, params) { return translate(locale, `publicSite.${key}`, params) }
const sharedLocale = ref(readPublicLocale())
export function usePublicI18n() {
  const locale = sharedLocale
  const t = (key, params) => publicText(locale.value, key, params)
  function toggle() { locale.value = locale.value === 'zh' ? 'en' : 'zh'; try { localStorage.setItem(PUBLIC_LOCALE_KEY, locale.value) } catch {}; if (globalThis.document) document.documentElement.lang = locale.value === 'en' ? 'en' : 'zh-CN' }
  return { locale, t, toggle }
}
