import test from 'node:test'
import assert from 'node:assert/strict'
import { createGraphemePlayback } from './grapheme-playback.js'

function scheduler() {
  let next = 1
  const frames = new Map()
  return {
    requestFrame(fn) { const id = next++; frames.set(id, fn); return id },
    cancelFrame(id) { frames.delete(id) },
    step(now = 0) { const item = frames.entries().next().value; if (!item) return false; frames.delete(item[0]); item[1](now); return true },
    get size() { return frames.size },
  }
}

test('standard playback emits one grapheme per distinct frame', () => {
  const clock = scheduler()
  const displays = []
  const player = createGraphemePlayback({
    onDisplay: text => displays.push(text),
    requestFrame: clock.requestFrame,
    cancelFrame: clock.cancelFrame,
    now: () => 0,
  })
  player.push('你好世界')
  let tick = 1; while (clock.step(tick++ * 25)) {}
  player.finish()
  tick = 1; while (clock.step(tick++ * 25)) {}
  assert.deepEqual(displays, ['你', '你好', '你好世', '你好世界'])
})

test('snapshot is immutable diagnostics and lifecycle is idempotent', () => {
  const clock = scheduler(); const displays = []
  const player = createGraphemePlayback({ onDisplay: t => displays.push(t), requestFrame: clock.requestFrame, cancelFrame: clock.cancelFrame, now: () => 0 })
  player.push('abc'); const before = player.snapshot(); assert.equal(Object.isFrozen(before), true)
  assert.equal(player.snapshot().displayedText, '')
  player.cancel(); player.cancel(); assert.equal(player.snapshot().pendingCount, 0)
  assert.equal(clock.size, 0); assert.deepEqual(displays, [])
  player.finish(); player.dispose(); player.dispose(); player.push('z'); assert.equal(player.snapshot().disposed, true)
})

test('keeps Unicode grapheme clusters intact across deltas', () => {
  const clock = scheduler(); const displays = []
  const player = createGraphemePlayback({ onDisplay: t => displays.push(t), requestFrame: clock.requestFrame, cancelFrame: clock.cancelFrame, now: () => 0 })
  player.push('e'); assert.equal(player.snapshot().displayedText, '')
  player.push('\u0301'); player.push(' 🇺'); player.push('🇸'); player.push(' 👍'); player.push('🏽'); player.push(' 👨‍'); player.push('👩')
  player.finish(); let tick = 1; while (clock.step(tick++ * 25)) {}
  assert.equal(player.snapshot().displayedText, 'é 🇺🇸 👍🏽 👨‍👩')
  assert.equal(displays.at(-1), player.snapshot().displayedText)
  assert.equal(player.snapshot().displayedText.includes('\uFFFD'), false)
})

test('holds complete emoji and Indic candidates until a boundary is confirmed', () => {
  const clock = scheduler(); const displays = []
  const player = createGraphemePlayback({ onDisplay: t => displays.push(t), requestFrame: clock.requestFrame, cancelFrame: clock.cancelFrame, now: () => 0 })
  player.push('👍🏽'); let tick = 1; while (clock.step(tick++ * 25)) {}
  assert.equal(player.snapshot().displayedText, '')
  player.push('\u200d👩'); while (clock.step(tick++ * 25)) {}
  assert.equal(player.snapshot().displayedText, '')
  player.finish(); while (clock.step(tick++ * 25)) {}
  assert.equal(player.snapshot().displayedText, '👍🏽‍👩')

  const indicClock = scheduler();
  const indic = createGraphemePlayback({ requestFrame: indicClock.requestFrame, cancelFrame: indicClock.cancelFrame, now: () => 0 })
  indic.push('क'); indic.push('्'); indic.push('ष'); let indicTick = 1; while (indicClock.step(indicTick++ * 25)) {}
  assert.equal(indic.snapshot().displayedText, '')
  indic.finish(); while (indicClock.step(indicTick++ * 25)) {}
  assert.equal(indic.snapshot().displayedText, 'क्ष')
})

test('standard mode observes a 25ms minimum between display commits', () => {
  const clock = scheduler(); let current = 0; const displays = []
  const player = createGraphemePlayback({ onDisplay: t => displays.push(t), requestFrame: clock.requestFrame, cancelFrame: clock.cancelFrame, now: () => current })
  player.push('AB'); player.finish()
  assert.equal(clock.step(0), true); assert.deepEqual(displays, ['A'])
  current = 24; assert.equal(clock.step(24), true); assert.deepEqual(displays, ['A'])
  current = 25; assert.equal(clock.step(25), true); assert.deepEqual(displays, ['A', 'AB'])
})

test('first confirmed grapheme displays on the next RAF, then later graphemes respect 25ms', () => {
  const clock = scheduler(); let current = 100; const displays = []
  const player = createGraphemePlayback({ onDisplay: t => displays.push(t), requestFrame: clock.requestFrame, cancelFrame: clock.cancelFrame, now: () => current })
  player.push('你好'); player.finish()
  current = 100; assert.equal(clock.step(100), true); assert.deepEqual(displays, ['你'])
  current = 124; assert.equal(clock.step(124), true); assert.deepEqual(displays, ['你'])
  current = 125; assert.equal(clock.step(125), true); assert.deepEqual(displays, ['你', '你好'])
})

test('default now uses the RAF performance timestamp domain', () => {
  const clock = scheduler(); const displays = []
  const player = createGraphemePlayback({ onDisplay: t => displays.push(t), requestFrame: clock.requestFrame, cancelFrame: clock.cancelFrame })
  player.push('你好'); player.finish()
  const rafTimestamp = globalThis.performance.now()
  clock.step(rafTimestamp)
  assert.deepEqual(displays, ['你'])
})

test('standard mode grows 20 graphemes over 20 distinct frames', () => {
  const clock = scheduler(); const displays = []
  const player = createGraphemePlayback({ onDisplay: t => displays.push(t), requestFrame: clock.requestFrame, cancelFrame: clock.cancelFrame, now: () => 0 })
  player.push('12345678901234567890'); player.finish()
  let tick = 1; while (clock.step(tick++ * 25)) {}
  const count = text => [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)].length
  assert.equal(displays.length, 20)
  assert.deepEqual(displays.map((text, index) => count(text) - index), Array(20).fill(1))
  assert.equal(player.snapshot().mode, 'standard')
})

test('catch-up mode is bounded and visibly incremental', () => {
  const clock = scheduler(); const displays = []; const batches = []
  let previous = ''
  const player = createGraphemePlayback({ onDisplay: text => { displays.push(text); batches.push([...text].length - [...previous].length); previous = text }, requestFrame: clock.requestFrame, cancelFrame: clock.cancelFrame, now: () => 0 })
  player.push('x'.repeat(100)); player.finish()
  let time = 1000; let remaining = 100; let maxBatch = 0
  while (clock.step(time++)) {
    const batch = batches.at(-1)
    maxBatch = Math.max(maxBatch, batch)
    assert.ok(batch <= Math.min(8, Math.max(1, Math.ceil(remaining * 0.1))))
    remaining -= batch
  }
  assert.ok(displays.length >= 10)
  assert.ok(batches.every(size => size >= 1))
  assert.equal(maxBatch, 8)
  assert.equal(player.snapshot().displayedText, 'x'.repeat(100))
  assert.equal(player.snapshot().catchUpDurationMs >= 0, true)
  assert.equal(player.snapshot().maxBatchSize, maxBatch)
  assert.equal(typeof player.snapshot().modeReason, 'string')
})

test('catch-up duration freezes when the queue drains', () => {
  const clock = scheduler(); let current = 0
  const player = createGraphemePlayback({ requestFrame: clock.requestFrame, cancelFrame: clock.cancelFrame, now: () => current })
  player.push('x'.repeat(100)); player.finish()
  let time = 1000; while (clock.step(time++)) {}
  current = 2000; const first = player.snapshot().catchUpDurationMs
  current = 4000; const second = player.snapshot().catchUpDurationMs
  assert.equal(second, first)
})

test('reduced-motion initial catch-up records its active interval', () => {
  const clock = scheduler();
  const player = createGraphemePlayback({ reducedMotion: true, requestFrame: clock.requestFrame, cancelFrame: clock.cancelFrame, now: () => 0 })
  player.push('x'.repeat(100)); player.finish(); clock.step(100)
  assert.equal(player.snapshot().mode, 'catch-up')
  assert.equal(player.snapshot().catchUpStartedAt, 100)
  assert.equal(player.snapshot().catchUpDurationMs, 0)
})

test('cancel and dispose close an active catch-up interval and remain frozen', () => {
  for (const action of ['cancel', 'dispose']) {
    const clock = scheduler(); let current = 0
    const player = createGraphemePlayback({ reducedMotion: true, requestFrame: clock.requestFrame, cancelFrame: clock.cancelFrame, now: () => current })
    player.push('x'.repeat(100)); player.finish(); clock.step(100)
    current = 500; const active = player.snapshot(); assert.equal(active.catchUpStartedAt, 100)
    player[action](); const frozen = player.snapshot(); current = 2000
    assert.equal(player.snapshot().catchUpDurationMs, frozen.catchUpDurationMs)
    player[action](); assert.equal(player.snapshot().catchUpDurationMs, frozen.catchUpDurationMs)
  }
})

test('cancel and dispose ignore a late scheduled frame', () => {
  let callback; let cancelled = 0; const displays = []
  const player = createGraphemePlayback({
    onDisplay: text => displays.push(text),
    requestFrame: fn => { callback = fn; return 7 },
    cancelFrame: () => { cancelled += 1 },
    now: () => 0,
  })
  player.push('你好'); player.cancel(); callback(0)
  assert.equal(cancelled, 1); assert.deepEqual(displays, []); assert.equal(player.snapshot().pendingCount, 0)
  player.push('x'); player.dispose(); assert.equal(cancelled, 1); assert.equal(player.snapshot().disposed, true)
  assert.deepEqual(displays, [])
})

test('standard onDisplay errors fail closed without leaking queued work', () => {
  const clock = scheduler(); const errors = []
  const player = createGraphemePlayback({
    onDisplay: () => { throw new Error('secret display detail') },
    onError: code => errors.push(code),
    requestFrame: clock.requestFrame, cancelFrame: clock.cancelFrame, now: () => 0,
  })
  player.push('你好世界'); player.finish(); clock.step(0)
  const state = player.snapshot()
  assert.equal(state.failed, true); assert.equal(state.errorCode, 'PLAYBACK_ERROR')
  assert.equal(state.pendingCount, 0); assert.equal(state.finished, true); assert.equal(clock.size, 0)
  assert.deepEqual(errors, ['PLAYBACK_ERROR'])
  assert.equal(state.displayedText, '你')
})

test('catch-up onDisplay errors close metrics and onError errors do not escape', () => {
  const clock = scheduler(); const errors = []
  const player = createGraphemePlayback({
    reducedMotion: true,
    onDisplay: () => { throw new Error('secret catch-up detail') },
    onError: code => { errors.push(code); throw new Error('consumer detail') },
    requestFrame: clock.requestFrame, cancelFrame: clock.cancelFrame, now: () => 0,
  })
  player.push('x'.repeat(100)); player.finish(); assert.doesNotThrow(() => clock.step(100))
  const state = player.snapshot()
  assert.equal(state.failed, true); assert.equal(state.pendingCount, 0); assert.equal(state.catchUpStartedAt, null)
  assert.equal(clock.size, 0); assert.deepEqual(errors, ['PLAYBACK_ERROR'])
})

test('synchronous requestFrame errors fail closed and are not rethrown', () => {
  const errors = []
  const player = createGraphemePlayback({
    onError: code => errors.push(code),
    requestFrame: () => { throw new Error('scheduler detail') },
    cancelFrame: () => {}, now: () => 0,
  })
  assert.doesNotThrow(() => player.push('你好'))
  const state = player.snapshot()
  assert.equal(state.failed, true); assert.equal(state.errorCode, 'PLAYBACK_ERROR'); assert.equal(state.pendingCount, 0)
  assert.deepEqual(errors, ['PLAYBACK_ERROR'])
})
