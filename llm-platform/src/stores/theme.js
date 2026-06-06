import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { getItem, setItem } from '@/utils/storage'

export const THEME_STORAGE_KEY = 'uiTheme'

export function applyTheme(theme) {
  document.documentElement.dataset.theme = theme
}

export function readStoredTheme() {
  const stored = getItem(THEME_STORAGE_KEY, 'light')
  return stored === 'dark' ? 'dark' : 'light'
}

export const useThemeStore = defineStore('theme', () => {
  const theme = ref(readStoredTheme())

  const isDark = computed(() => theme.value === 'dark')

  function setTheme(next) {
    const value = next === 'dark' ? 'dark' : 'light'
    theme.value = value
    applyTheme(value)
    setItem(THEME_STORAGE_KEY, value)
  }

  function toggleTheme() {
    setTheme(theme.value === 'dark' ? 'light' : 'dark')
  }

  applyTheme(theme.value)

  return { theme, isDark, setTheme, toggleTheme }
})
