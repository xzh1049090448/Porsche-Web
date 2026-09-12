const DEFAULT_FRAME = typeof requestAnimationFrame === 'function'
  ? requestAnimationFrame
  : (callback => setTimeout(() => callback(typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now()), 16))
const DEFAULT_CANCEL = typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame : clearTimeout
const DEFAULT_NOW = typeof performance !== 'undefined' && typeof performance.now === 'function'
  ? () => performance.now()
  : () => Date.now()

function fallbackGraphemes(value) {
  const result = []
  const regional = character => /[\u{1F1E6}-\u{1F1FF}]/u.test(character)
  const extender = character => /[\p{M}\u{FE0E}\u{FE0F}\u{1F3FB}-\u{1F3FF}]/u.test(character)
  for (const character of Array.from(value)) {
    const previous = result.at(-1)
    if (previous && (extender(character) || character === '\u200d' || previous.endsWith('\u200d') || regional(character) && regional(previous) && Array.from(previous).length === 1)) {
      result[result.length - 1] += character
    } else result.push(character)
  }
  return result
}

export function createGraphemePlayback({
  onDisplay = () => {},
  onError = () => {},
  afterDisplay = callback => callback(),
  requestFrame = DEFAULT_FRAME,
  cancelFrame = DEFAULT_CANCEL,
  now = DEFAULT_NOW,
  reducedMotion = false,
  targetLagMs = 500,
  isPageVisible = () => typeof document === 'undefined' || document.visibilityState !== 'hidden',
} = {}) {
  const segmenter = typeof Intl?.Segmenter === 'function' ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null
  let receivedText = ''
  let displayedText = ''
  let carry = ''
  let pending = []
  let frameHandle = null
  let waitingForCommit = false
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
  let hasDisplayed = false
  let failed = false
  let errorCode = null

  function snapshot() {
    const current = now()
    const activeCatchUpMs = catchUpStartedAt === null ? 0 : Math.max(0, current - catchUpStartedAt)
    return Object.freeze({ receivedText, displayedText, pendingCount: pending.length + (carry ? 1 : 0), mode, modeReason, finished, disposed, failed, errorCode, catchUpStartedAt, catchUpDurationMs: catchUpDurationMs + activeCatchUpMs, maxBatchSize, boundaryWaitMs: carry ? Math.max(0, current - carryStartedAt) : 0 })
  }

  function closeCatchUp(at) {
    if (catchUpStartedAt !== null) {
      catchUpDurationMs += Math.max(0, at - catchUpStartedAt)
      catchUpStartedAt = null
    }
  }

  function releaseFrame() {
    const handle = frameHandle
    frameHandle = null
    if (handle === null) return false
    try {
      cancelFrame(handle)
      return false
    } catch {
      return true
    }
  }

  function failClosed() {
    if (failed) return
    failed = true
    errorCode = 'PLAYBACK_ERROR'
    finished = true
    generation += 1
    closeCatchUp(now())
    releaseFrame()
    pending = []
    waitingForCommit = false
    carry = ''
    carryStartedAt = null
    modeReason = 'error'
    try { onError(errorCode) } catch {}
  }

  function schedule() {
    if (frameHandle !== null || waitingForCommit || disposed || failed || pending.length === 0) return
    const token = generation
    try {
      frameHandle = requestFrame(timestamp => {
      frameHandle = null
      if (disposed || token !== generation) return
      const frameTime = Number.isFinite(timestamp) ? timestamp : now()
      const remaining = pending.length
      const lag = Math.max(remaining * 25, frameTime - lastReceivedAt)
      let visible = true
      try { visible = isPageVisible() !== false } catch { return failClosed() }
      const backlog = remaining > 120
      const nextMode = !visible || reducedMotion || backlog || lag > targetLagMs ? 'catch-up' : 'standard'
      if (nextMode === 'catch-up' && catchUpStartedAt === null) {
        catchUpStartedAt = frameTime
        modeReason = !visible ? 'background' : reducedMotion ? 'reduced-motion' : backlog ? 'backlog' : 'queue-lag'
      } else if (nextMode === 'standard' && mode === 'catch-up' && catchUpStartedAt !== null) {
        catchUpDurationMs += Math.max(0, frameTime - catchUpStartedAt)
        catchUpStartedAt = null
        modeReason = 'standard'
      }
      mode = nextMode
      const interval = mode === 'standard' ? 25 : 0
      if (hasDisplayed && frameTime - lastDisplayAt < interval) {
        schedule()
        return
      }
      const amount = mode === 'standard' ? 1 : Math.min(8, Math.max(1, Math.ceil(remaining * 0.1)))
      maxBatchSize = Math.max(maxBatchSize, amount)
      const batch = pending.splice(0, Math.min(amount, remaining))
      displayedText += batch.join('')
      lastDisplayAt = frameTime
      hasDisplayed = true
      try {
        onDisplay(displayedText)
      } catch {
        failClosed()
        return
      }
      if (pending.length) {
        waitingForCommit = true
        const committed = () => {
          if (disposed || token !== generation) return
          waitingForCommit = false
          schedule()
        }
        try {
          const result = afterDisplay(committed)
          if (result && typeof result.then === 'function') result.catch(failClosed)
        } catch {
          failClosed()
        }
      } else if (mode === 'catch-up' && catchUpStartedAt !== null) {
        closeCatchUp(frameTime)
        mode = 'standard'
        modeReason = 'standard'
      }
      })
    } catch {
      frameHandle = null
      failClosed()
    }
  }

  function enqueue(text, force = false) {
    const parts = segmenter ? [...segmenter.segment(text)].map(item => item.segment) : fallbackGraphemes(text)
    if (!force && parts.length) { carry = parts.pop(); carryStartedAt = now() }
    else if (force && parts.length) { carry = ''; carryStartedAt = null }
    pending.push(...parts)
    schedule()
  }

  return {
    push(delta = '') {
      if (disposed || finished || failed || typeof delta !== 'string' || delta === '') return snapshot()
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
      closeCatchUp(now())
      generation += 1
      const cleanupFailed = releaseFrame()
      pending = []; carry = ''; carryStartedAt = null; finished = true
      waitingForCommit = false
      if (cleanupFailed) failClosed()
      return snapshot()
    },
    dispose() {
      if (disposed) return snapshot()
      closeCatchUp(now())
      generation += 1
      const cleanupFailed = releaseFrame()
      pending = []; carry = ''; carryStartedAt = null; disposed = true; finished = true
      waitingForCommit = false
      if (cleanupFailed) failClosed()
      return snapshot()
    },
    snapshot,
  }
}
