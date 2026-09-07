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
  while (clock.step()) {}
  player.finish()
  while (clock.step()) {}
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
  player.finish(); while (clock.step()) {}
  assert.equal(player.snapshot().displayedText, 'é 🇺🇸 👍🏽 👨‍👩')
  assert.equal(displays.at(-1), player.snapshot().displayedText)
  assert.equal(player.snapshot().displayedText.includes('\uFFFD'), false)
})

test('standard mode grows 20 graphemes over 20 distinct frames', () => {
  const clock = scheduler(); const displays = []
  const player = createGraphemePlayback({ onDisplay: t => displays.push(t), requestFrame: clock.requestFrame, cancelFrame: clock.cancelFrame, now: () => 0 })
  player.push('12345678901234567890'); player.finish()
  while (clock.step(0)) {}
  assert.equal(displays.length, 20)
  assert.deepEqual(displays.map((text, index) => [...text].length - index), Array(20).fill(1))
  assert.equal(player.snapshot().mode, 'standard')
})

test('catch-up mode is bounded and visibly incremental', () => {
  const clock = scheduler(); const displays = []; const batches = []
  let previous = ''
  const player = createGraphemePlayback({ onDisplay: text => { displays.push(text); batches.push([...text].length - [...previous].length); previous = text }, requestFrame: clock.requestFrame, cancelFrame: clock.cancelFrame, now: () => 0 })
  player.push('x'.repeat(100)); player.finish()
  let time = 1000; while (clock.step(time++)) {}
  assert.ok(displays.length >= 10)
  assert.ok(batches.every(size => size <= 8 && size >= 1))
  assert.equal(player.snapshot().displayedText, 'x'.repeat(100))
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
