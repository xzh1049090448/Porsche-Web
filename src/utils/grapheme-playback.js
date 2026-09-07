const DEFAULT_FRAME = typeof requestAnimationFrame === 'function'
  ? requestAnimationFrame
  : (callback => setTimeout(() => callback(Date.now()), 16))
const DEFAULT_CANCEL = typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame : clearTimeout

const combining = /\p{Mark}/u
const regional = /\p{Regional_Indicator}/u
const emoji = /\p{Extended_Pictographic}/u

function mayExtend(cluster) {
  if (cluster.endsWith('\u200d')) return true
  if ([...cluster].some(char => regional.test(char))) {
    return [...cluster].filter(char => regional.test(char)).length % 2 === 1
  }
  // Keep a possible base character until the next delta, so a combining mark
  // or an emoji modifier/ZWJ sequence can never be rendered half-formed.
  const chars = [...cluster]
  const last = chars.at(-1) || ''
  return combining.test(last) || emoji.test(last) || /[A-Za-z]/u.test(last)
}

export function createGraphemePlayback({
  onDisplay = () => {},
  requestFrame = DEFAULT_FRAME,
  cancelFrame = DEFAULT_CANCEL,
  now = () => Date.now(),
  reducedMotion = false,
  targetLagMs = 500,
} = {}) {
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  let receivedText = ''
  let displayedText = ''
  let carry = ''
  let pending = []
  let frameHandle = null
  let generation = 0
  let finished = false
  let disposed = false
  let lastReceivedAt = now()
  let lastDisplayAt = lastReceivedAt
  let mode = reducedMotion ? 'catch-up' : 'standard'

  function snapshot() {
    return Object.freeze({ receivedText, displayedText, pendingCount: pending.length + (carry ? 1 : 0), mode, finished, disposed })
  }

  function schedule() {
    if (frameHandle !== null || disposed || pending.length === 0) return
    const token = generation
    frameHandle = requestFrame(timestamp => {
      frameHandle = null
      if (disposed || token !== generation) return
      const remaining = pending.length
      const lag = Math.max(remaining * 25, Number(timestamp) - lastReceivedAt)
      mode = reducedMotion || lag > targetLagMs ? 'catch-up' : 'standard'
      const amount = mode === 'standard' ? 1 : Math.min(8, Math.max(1, Math.ceil(remaining * 0.1)))
      const batch = pending.splice(0, Math.min(amount, remaining))
      displayedText += batch.join('')
      lastDisplayAt = Number(timestamp) || now()
      onDisplay(displayedText)
      if (pending.length) schedule()
    })
  }

  function enqueue(text, force = false) {
    const parts = [...segmenter.segment(text)].map(item => item.segment)
    if (!force && parts.length && mayExtend(parts.at(-1))) carry = parts.pop()
    else if (force && parts.length) carry = ''
    pending.push(...parts)
    schedule()
  }

  return {
    push(delta = '') {
      if (disposed || finished || typeof delta !== 'string' || delta === '') return snapshot()
      receivedText += delta
      lastReceivedAt = now()
      const input = carry + delta
      carry = ''
      enqueue(input)
      return snapshot()
    },
    finish() {
      if (disposed || finished) return snapshot()
      finished = true
      if (carry) { enqueue(carry, true); carry = '' }
      schedule()
      return snapshot()
    },
    cancel() {
      if (disposed) return snapshot()
      generation += 1
      if (frameHandle !== null) { cancelFrame(frameHandle); frameHandle = null }
      pending = []; carry = ''; finished = true
      return snapshot()
    },
    dispose() {
      if (disposed) return snapshot()
      generation += 1
      if (frameHandle !== null) { cancelFrame(frameHandle); frameHandle = null }
      pending = []; carry = ''; disposed = true; finished = true
      return snapshot()
    },
    snapshot,
  }
}
