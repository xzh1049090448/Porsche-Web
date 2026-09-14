export function createPageHandoff({
  document,
  location,
  matchMedia,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}) {
  let timer = null

  return path => {
    if (timer !== null) {
      clearTimer(timer)
      timer = null
    }
    if (typeof location?.assign !== 'function') return
    if (matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) {
      location.assign(path)
      return
    }
    if (typeof document?.documentElement?.classList?.add !== 'function') return
    document.documentElement.classList.add('route-handoff-leaving')
    timer = setTimer(() => {
      timer = null
      location.assign(path)
    }, 200)
  }
}
