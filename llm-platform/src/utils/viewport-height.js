/** 修正移动端浏览器地址栏 / 虚拟键盘导致的 100vh 偏差 */
export function initViewportHeight() {
  if (typeof window === 'undefined') return () => {}

  const set = () => {
    const h = window.visualViewport?.height ?? window.innerHeight
    document.documentElement.style.setProperty('--vh', `${h * 0.01}px`)
  }

  set()
  window.addEventListener('resize', set)
  window.visualViewport?.addEventListener('resize', set)

  return () => {
    window.removeEventListener('resize', set)
    window.visualViewport?.removeEventListener('resize', set)
  }
}
