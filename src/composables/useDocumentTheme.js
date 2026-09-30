import { onMounted, onUnmounted, ref } from 'vue'

/**
 * 读取文档主题。控制台经 theme store 写 `data-theme`，公共页直接写同一属性，
 * 因此以该 DOM 属性为唯一事实来源，避免两条写入路径造成状态不一致。
 */
export function readDocumentTheme() {
  const value = globalThis.document?.documentElement?.dataset?.theme
  return value === 'dark' ? 'dark' : 'light'
}

/**
 * 响应式跟踪文档主题；直接写 `data-theme` 或经 store 写入都会触发更新。
 */
export function useDocumentTheme() {
  const theme = ref(readDocumentTheme())
  let observer

  onMounted(() => {
    theme.value = readDocumentTheme()
    if (typeof MutationObserver !== 'function' || !globalThis.document?.documentElement) return
    observer = new MutationObserver(() => { theme.value = readDocumentTheme() })
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
  })

  onUnmounted(() => { observer?.disconnect(); observer = undefined })

  return theme
}
