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
    if (matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) {
      location.assign(path)
      return
    }
    document.documentElement.classList.add('route-handoff-leaving')
    timer = setTimer(() => {
      timer = null
      location.assign(path)
    }, 200)
  }
}
