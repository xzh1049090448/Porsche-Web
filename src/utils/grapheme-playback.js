const DEFAULT_FRAME = typeof requestAnimationFrame === 'function'
  ? requestAnimationFrame
  : (callback => setTimeout(() => callback(Date.now()), 16))
const DEFAULT_CANCEL = typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame : clearTimeout

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
  let modeReason = reducedMotion ? 'reduced-motion' : 'standard'
  let catchUpStartedAt = null
  let catchUpDurationMs = 0
  let maxBatchSize = 0
  let carryStartedAt = null

  function snapshot() {
    const current = now()
    const activeCatchUpMs = catchUpStartedAt === null ? 0 : Math.max(0, current - catchUpStartedAt)
    return Object.freeze({ receivedText, displayedText, pendingCount: pending.length + (carry ? 1 : 0), mode, modeReason, finished, disposed, catchUpStartedAt, catchUpDurationMs: catchUpDurationMs + activeCatchUpMs, maxBatchSize, boundaryWaitMs: carry ? Math.max(0, current - carryStartedAt) : 0 })
  }

  function schedule() {
    if (frameHandle !== null || disposed || pending.length === 0) return
    const token = generation
    frameHandle = requestFrame(timestamp => {
      frameHandle = null
      if (disposed || token !== generation) return
      const remaining = pending.length
      const lag = Math.max(remaining * 25, Number(timestamp) - lastReceivedAt)
      const nextMode = reducedMotion || lag > targetLagMs ? 'catch-up' : 'standard'
      if (nextMode === 'catch-up' && mode !== 'catch-up') {
        catchUpStartedAt = Number(timestamp) || now()
        modeReason = reducedMotion ? 'reduced-motion' : 'queue-lag'
      } else if (nextMode === 'standard' && mode === 'catch-up' && catchUpStartedAt !== null) {
        catchUpDurationMs += Math.max(0, (Number(timestamp) || now()) - catchUpStartedAt)
        catchUpStartedAt = null
        modeReason = 'standard'
      }
      mode = nextMode
      if (mode === 'standard' && (Number(timestamp) || now()) - lastDisplayAt < 25) {
        schedule()
        return
      }
      const amount = mode === 'standard' ? 1 : Math.min(8, Math.max(1, Math.ceil(remaining * 0.1)))
      maxBatchSize = Math.max(maxBatchSize, amount)
      const batch = pending.splice(0, Math.min(amount, remaining))
      displayedText += batch.join('')
      lastDisplayAt = Number(timestamp) || now()
      onDisplay(displayedText)
      if (pending.length) schedule()
    })
  }

  function enqueue(text, force = false) {
    const parts = [...segmenter.segment(text)].map(item => item.segment)
    if (!force && parts.length) { carry = parts.pop(); carryStartedAt = now() }
    else if (force && parts.length) { carry = ''; carryStartedAt = null }
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
      if (carry) { enqueue(carry, true); carry = ''; carryStartedAt = null }
      schedule()
      return snapshot()
    },
    cancel() {
      if (disposed) return snapshot()
      generation += 1
      if (frameHandle !== null) { cancelFrame(frameHandle); frameHandle = null }
      pending = []; carry = ''; carryStartedAt = null; finished = true
      return snapshot()
    },
    dispose() {
      if (disposed) return snapshot()
      generation += 1
      if (frameHandle !== null) { cancelFrame(frameHandle); frameHandle = null }
      pending = []; carry = ''; carryStartedAt = null; disposed = true; finished = true
      return snapshot()
    },
    snapshot,
  }
}
