import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { getItem, setItem } from '@/utils/storage'

export const THEME_STORAGE_KEY = 'uiTheme'

export function applyTheme(theme) {
  const value = theme === 'dark' ? 'dark' : 'light'
  if (typeof document !== 'undefined' && document.documentElement) {
    document.documentElement.dataset.theme = value
  }
  return value
}

export function readStoredTheme() {
  let stored = null
  try { stored = getItem(THEME_STORAGE_KEY, null) } catch {}
  if (stored === 'light' || stored === 'dark') return stored
  try {
    return typeof globalThis.matchMedia === 'function' && globalThis.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light'
  } catch {
    return 'light'
  }
}

export const useThemeStore = defineStore('theme', () => {
  const theme = ref(readStoredTheme())

  const isDark = computed(() => theme.value === 'dark')

  function setTheme(next) {
    const value = next === 'dark' ? 'dark' : 'light'
    theme.value = value
    applyTheme(value)
    try { setItem(THEME_STORAGE_KEY, value) } catch {}
  }

  function toggleTheme() {
    setTheme(theme.value === 'dark' ? 'light' : 'dark')
  }

  applyTheme(theme.value)

  return { theme, isDark, setTheme, toggleTheme }
})
