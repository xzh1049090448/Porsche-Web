import test from 'node:test'
import assert from 'node:assert/strict'
import { createChatGeneration } from './chat-generation.js'

function scheduler() {
  const jobs = new Map(); let next = 1
  return { requestFrame(fn) { const id = next++; jobs.set(id, fn); return id }, cancelFrame(id) { jobs.delete(id) }, step(t = 0) { const item = jobs.entries().next().value; if (!item) return false; jobs.delete(item[0]); item[1](t); return true }, get size() { return jobs.size } }
}
const base = (overrides = {}) => ({ generationId: 'gen-1', conversationGuid: 'conv-1', messageKey: 'msg-1', mode: 'single', models: ['model-a'], ...overrides })
const meta = (g = 'gen-1', models = ['model-a']) => ({ type: 'meta', generation_id: g, conversation_guid: 'conv-1', models })
const delta = (model = 'model-a', seq = 1, text = 'Hi') => ({ type: 'delta', generation_id: 'gen-1', model, seq, delta: text })
const modelDone = (model = 'model-a', last_seq = 1) => ({ type: 'model_done', generation_id: 'gen-1', model, last_seq })
const done = () => ({ type: 'done', generation_id: 'gen-1', status: 'completed', conversation_guid: 'conv-1', total_tokens_used: 2, tokens: 2 })


test('creates immutable identity snapshot and rejects invalid construction', () => {
  assert.throws(() => createChatGeneration(base({ generationId: ' ' })), /generationId/)
  assert.throws(() => createChatGeneration(base({ models: ['a', 'a'], mode: 'compare' })), /models/)
  const generation = createChatGeneration(base())
  const state = generation.snapshot()
  assert.equal(state.status, 'waiting'); assert.deepEqual(state.identity.models, ['model-a'])
  assert.ok(Object.isFrozen(state)); assert.ok(Object.isFrozen(state.identity))
  assert.throws(() => { state.identity.generationId = 'bad' }, TypeError)
})

test('validates event identity and sequences before queueing', () => {
  const clock = scheduler(); const g = createChatGeneration(base({ playback: { requestFrame: clock.requestFrame, cancelFrame: clock.cancelFrame, now: () => 0, reducedMotion: true } }))
  g.handleEvent(meta()); g.handleEvent(delta('model-a', 1, 'A'))
  assert.equal(g.snapshot().status, 'receiving'); assert.equal(g.snapshot().models[0].receivedText, 'A')
  g.handleEvent(delta('other', 2, 'x')); assert.equal(g.snapshot().diagnostics.at(-1).code, 'GENERATION_SEQUENCE_ERROR')
  g.handleEvent(delta('model-a', 1, 'dup')); assert.equal(g.snapshot().models[0].receivedText, 'A')
})

test('compare models remain independent and done drains playback', () => {
  const clock = scheduler(); const g = createChatGeneration({ ...base({ mode: 'compare', models: ['a', 'b'] }), playback: { requestFrame: clock.requestFrame, cancelFrame: clock.cancelFrame, now: () => 0, reducedMotion: true } })
  g.handleEvent(meta('gen-1', ['a', 'b'])); g.handleEvent(delta('a', 1, 'A')); g.handleEvent(delta('b', 1, 'B')); g.handleEvent(modelDone('a')); g.handleEvent({ ...modelDone('b'), last_seq: 1 }); g.handleEvent({ ...done(), models: { a: { status: 'completed', tokens: 1 }, b: { status: 'completed', tokens: 1 } } })
  assert.equal(g.snapshot().status, 'draining'); while (clock.step(1000)) {} assert.equal(g.snapshot().status, 'completed'); assert.equal(g.snapshot().models[0].displayedText, 'A'); assert.equal(g.snapshot().models[1].displayedText, 'B')
})

test('EOF and transport errors fail closed, never success', () => {
  const g = createChatGeneration(base()); g.handleEvent(meta()); g.eof(); assert.equal(g.snapshot().status, 'failed'); assert.equal(g.snapshot().diagnostics.at(-1).code, 'GENERATION_EOF')
  const h = createChatGeneration(base()); h.fail('transport'); assert.equal(h.snapshot().status, 'failed'); assert.equal(h.snapshot().diagnostics.at(-1).code, 'GENERATION_TRANSPORT_ERROR')
})

test('local cancel freezes playback and authoritative outcomes decide terminal state', () => {
  const clock = scheduler(); const g = createChatGeneration({ ...base(), playback: { requestFrame: clock.requestFrame, cancelFrame: clock.cancelFrame, now: () => 0, reducedMotion: true } })
  g.handleEvent(meta()); g.handleEvent(delta('model-a', 1, 'A')); g.cancelLocalQueue(); assert.equal(g.snapshot().status, 'cancelling'); g.handleEvent(delta('model-a', 2, 'B')); assert.equal(g.snapshot().models[0].receivedText, 'A'); g.resolveCancel({ status: 'cancelled' }); assert.equal(g.snapshot().status, 'cancelled')
})

test('authoritative completed appends only unseen suffix and rejects prefix mismatch', () => {
  const clock = scheduler(); const g = createChatGeneration({ ...base(), playback: { requestFrame: clock.requestFrame, cancelFrame: clock.cancelFrame, now: () => 0, reducedMotion: true } })
  g.handleEvent(meta()); g.handleEvent(delta('model-a', 1, 'A')); while (clock.step(0)) {} g.cancelLocalQueue(); g.resolveStatus({ status: 'completed', mode: 'single', results: [{ model: 'model-a', status: 'completed', content: 'ABC' }] }); assert.equal(g.snapshot().status, 'draining'); while (clock.step(0)) {} assert.equal(g.snapshot().models[0].displayedText, 'ABC')
  const h = createChatGeneration({ ...base(), playback: { requestFrame: clock.requestFrame, cancelFrame: clock.cancelFrame, now: () => 0, reducedMotion: true } }); h.handleEvent(meta()); h.handleEvent(delta('model-a', 1, 'XY')); clock.step(1000); h.cancelLocalQueue(); h.resolveStatus({ status: 'completed', mode: 'single', results: [{ model: 'model-a', status: 'completed', content: 'NO' }] }); assert.equal(h.snapshot().status, 'failed'); assert.equal(h.snapshot().diagnostics.at(-1).code, 'GENERATION_DATA_ERROR')
})

test('dispose is idempotent and callback errors do not escape or leak frames', () => {
  const clock = scheduler(); const errors = []; const g = createChatGeneration({ ...base(), onChange: () => { throw new Error('secret') }, playback: { requestFrame: clock.requestFrame, cancelFrame: clock.cancelFrame, now: () => 0, reducedMotion: true } })
  g.handleEvent(meta()); g.handleEvent(delta('model-a', 1, 'A')); assert.doesNotThrow(() => g.dispose()); g.dispose(); assert.equal(clock.size, 0); assert.equal(g.snapshot().status, 'disposed'); assert.equal(errors.length, 0); assert.equal(JSON.stringify(g.snapshot()).includes('secret'), false)
})
