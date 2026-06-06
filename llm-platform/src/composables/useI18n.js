import { storeToRefs } from 'pinia'
import { useLocaleStore } from '@/stores/locale'

export function useI18n() {
  const localeStore = useLocaleStore()
  const { locale, isEn, elementLocale, dateLocale } = storeToRefs(localeStore)

  return {
    locale,
    isEn,
    elementLocale,
    dateLocale,
    t: localeStore.t,
    ta: localeStore.ta,
    setLocale: localeStore.setLocale,
    toggleLocale: localeStore.toggleLocale,
  }
}
