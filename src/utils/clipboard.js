export async function copyText(text, environment = globalThis) {
  if (typeof text !== 'string' || !text.trim() || environment.signal?.aborted) return false
  try {
    if (typeof environment.navigator?.clipboard?.writeText === 'function') {
      await environment.navigator.clipboard.writeText(text)
      return !environment.signal?.aborted
    }
  } catch {
    // Permission denial and insecure contexts can still support legacy copy.
  }
  if (environment.signal?.aborted) return false

  const document = environment.document
  if (!document?.createElement || typeof document.execCommand !== 'function') return false
  if (environment.container && (
    environment.container.ownerDocument !== document || !environment.container.isConnected
  )) return false
  const active = document.activeElement
  const inputSelection = typeof active?.selectionStart === 'number'
    ? [active.selectionStart, active.selectionEnd, active.selectionDirection]
    : null
  const selection = document.getSelection?.()
  const ranges = []
  for (let index = 0; index < (selection?.rangeCount || 0); index++) {
    ranges.push(selection.getRangeAt(index).cloneRange())
  }
  let textarea
  try {
    textarea = document.createElement('textarea')
    textarea.value = text
    textarea.setAttribute('readonly', '')
    Object.assign(textarea.style, { position: 'fixed', opacity: '0', left: '0', top: '0' })
    // Element Plus traps focus inside the active dialog/drawer.
    const container = environment.container || active?.closest?.('[role="dialog"]') || document.body
    container.appendChild(textarea)
    textarea.focus({ preventScroll: true })
    textarea.select()
    return document.execCommand('copy') === true
  } catch {
    return false
  } finally {
    if (textarea) {
      textarea.value = ''
      textarea.remove()
    }
    try {
      active?.focus?.({ preventScroll: true })
      if (selection) {
        selection.removeAllRanges()
        for (const range of ranges) selection.addRange(range)
      }
      // Restoring document ranges can reset an input's caret in Chromium.
      if (inputSelection) active.setSelectionRange(...inputSelection)
    } catch {
      // A source removed by a copy event cannot receive restored focus.
    }
  }
}
