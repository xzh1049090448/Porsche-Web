import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import zhCn from 'element-plus/dist/locale/zh-cn.mjs'
import en from 'element-plus/dist/locale/en.mjs'
import { getItem, setItem } from '@/utils/storage'
import { translate, translateArray } from '@/i18n'

export const LOCALE_STORAGE_KEY = 'uiLocale'

export function readStoredLocale() {
  const stored = getItem(LOCALE_STORAGE_KEY, 'zh')
  return stored === 'en' ? 'en' : 'zh'
}

export function applyLocale(locale) {
  document.documentElement.lang = locale === 'en' ? 'en' : 'zh-CN'
  document.title = translate(locale, 'app.title')
}

export const useLocaleStore = defineStore('locale', () => {
  const locale = ref(readStoredLocale())

  const isEn = computed(() => locale.value === 'en')
  const elementLocale = computed(() => (locale.value === 'en' ? en : zhCn))
  const dateLocale = computed(() => (locale.value === 'en' ? 'en-US' : 'zh-CN'))

  function t(key, params) {
    return translate(locale.value, key, params)
  }

  function ta(key) {
    return translateArray(locale.value, key)
  }

  function setLocale(next) {
    const value = next === 'en' ? 'en' : 'zh'
    locale.value = value
    applyLocale(value)
    setItem(LOCALE_STORAGE_KEY, value)
  }

  function toggleLocale() {
    setLocale(locale.value === 'en' ? 'zh' : 'en')
  }

  applyLocale(locale.value)

  return { locale, isEn, elementLocale, dateLocale, t, ta, setLocale, toggleLocale }
})
