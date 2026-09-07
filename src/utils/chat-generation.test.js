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
  g.handleEvent(meta()); g.handleEvent(delta('model-a', 1, 'A')); g.cancelLocalQueue(); assert.equal(g.snapshot().status, 'cancelling'); g.handleEvent(delta('model-a', 2, 'B')); assert.equal(g.snapshot().models[0].receivedText, 'A'); g.resolveCancel({ generation_id: 'gen-1', conversation_guid: null, mode: 'single', status: 'cancelled' }); assert.equal(g.snapshot().status, 'cancelled')
})

test('authoritative completed appends only unseen suffix and rejects prefix mismatch', () => {
  const clock = scheduler(); const g = createChatGeneration({ ...base(), playback: { requestFrame: clock.requestFrame, cancelFrame: clock.cancelFrame, now: () => 0, reducedMotion: true } })
  g.handleEvent(meta()); g.handleEvent(delta('model-a', 1, 'A')); while (clock.step(0)) {} g.cancelLocalQueue(); g.resolveStatus({ generation_id: 'gen-1', conversation_guid: 'conv-1', status: 'completed', total_tokens_used: 1, mode: 'single', result: { model: 'model-a', status: 'completed', assistant_message_guid: 'm-a', content: 'ABC', tokens: 1 } }); assert.equal(g.snapshot().status, 'draining'); while (clock.step(0)) {} assert.equal(g.snapshot().models[0].displayedText, 'ABC')
  const h = createChatGeneration({ ...base(), playback: { requestFrame: clock.requestFrame, cancelFrame: clock.cancelFrame, now: () => 0, reducedMotion: true } }); h.handleEvent(meta()); h.handleEvent(delta('model-a', 1, 'XY')); clock.step(1000); h.cancelLocalQueue(); h.resolveStatus({ generation_id: 'gen-1', conversation_guid: 'conv-1', status: 'completed', total_tokens_used: 1, mode: 'single', result: { model: 'model-a', status: 'completed', assistant_message_guid: 'm-a', content: 'NO', tokens: 1 } }); assert.equal(h.snapshot().status, 'failed'); assert.equal(h.snapshot().diagnostics.at(-1).code, 'GENERATION_DATA_ERROR')
})

test('dispose is idempotent and callback errors do not escape or leak frames', () => {
  const clock = scheduler(); const errors = []; const g = createChatGeneration({ ...base(), onChange: () => { throw new Error('secret') }, playback: { requestFrame: clock.requestFrame, cancelFrame: clock.cancelFrame, now: () => 0, reducedMotion: true } })
  g.handleEvent(meta()); g.handleEvent(delta('model-a', 1, 'A')); assert.doesNotThrow(() => g.dispose()); g.dispose(); assert.equal(clock.size, 0); assert.equal(g.snapshot().status, 'disposed'); assert.equal(errors.length, 0); assert.equal(JSON.stringify(g.snapshot()).includes('secret'), false)
})

test('rejects authoritative payload identity and mode/shape mismatches without changing status', () => {
  const g = createChatGeneration(base()); g.handleEvent(meta());
  const before = g.snapshot().status
  g.resolveStatus({ generation_id: 'wrong', conversation_guid: 'conv-1', status: 'committing', mode: 'single' })
  assert.equal(g.snapshot().status, before); assert.equal(g.snapshot().diagnostics.at(-1).code, 'GENERATION_STATUS_ERROR')
  g.resolveStatus({ generation_id: 'gen-1', conversation_guid: 'conv-1', status: 'completed', mode: 'single', results: [{ model: 'model-a', status: 'completed', content: 'x' }] })
  assert.equal(g.snapshot().status, before)
})

test('terminal states are irreversible and ignore late events and resolutions', () => {
  const g = createChatGeneration(base()); g.fail('transport');
  g.resolveStatus({ generation_id: 'gen-1', conversation_guid: 'conv-1', status: 'completed', mode: 'single', result: { model: 'model-a', status: 'completed', content: 'x' } })
  g.handleEvent(meta()); g.resolveCancel({ generation_id: 'gen-1', conversation_guid: 'conv-1', status: 'cancelled', mode: 'single' })
  assert.equal(g.snapshot().status, 'failed')
})

test('authoritative completed rebuilds pending playback instead of duplicating received text', () => {
  const clock = scheduler(); const g = createChatGeneration({ ...base(), playback: { requestFrame: clock.requestFrame, cancelFrame: clock.cancelFrame, now: () => 0, reducedMotion: true } })
  g.handleEvent(meta()); g.handleEvent(delta('model-a', 1, 'AB')); g.resolveStatus({ generation_id: 'gen-1', conversation_guid: 'conv-1', status: 'completed', total_tokens_used: 1, mode: 'single', result: { model: 'model-a', status: 'completed', assistant_message_guid: 'm-a', content: 'ABC', tokens: 1 } }); while (clock.step(1000)) {}
  assert.equal(g.snapshot().status, 'completed'); assert.equal(g.snapshot().models[0].receivedText, 'ABC'); assert.equal(g.snapshot().models[0].displayedText, 'ABC')
})

test('model errors and failed compare siblings discard undisplayed queues', () => {
  const clock = scheduler(); const g = createChatGeneration({ mode: 'compare', generationId: 'gen-1', conversationGuid: 'conv-1', messageKey: 'msg-1', models: ['a', 'b'], playback: { requestFrame: clock.requestFrame, cancelFrame: clock.cancelFrame, now: () => 0, reducedMotion: true } })
  g.handleEvent(meta('gen-1', ['a', 'b'])); g.handleEvent(delta('a', 1, 'AB')); g.handleEvent({ type: 'model_error', generation_id: 'gen-1', model: 'a', code: 'gateway_upstream_error' });
  g.handleEvent(delta('b', 1, 'B')); g.handleEvent(modelDone('b')); g.handleEvent({ type: 'done', generation_id: 'gen-1', status: 'completed', conversation_guid: 'conv-1', total_tokens_used: 1, models: { a: { status: 'failed', code: 'gateway_upstream_error' }, b: { status: 'completed', tokens: 1 } } }); while (clock.step(1000)) {}
  assert.equal(g.snapshot().status, 'completed'); assert.equal(g.snapshot().models[0].displayedText, ''); assert.equal(g.snapshot().models[0].code, 'gateway_upstream_error')
})

test('status payloads allow only null or the current nonblank conversation GUID', () => {
  for (const status of ['running', 'cancelling', 'committing', 'cancelled', 'failed']) {
    const g = createChatGeneration(base());
    g.resolveStatus({ generation_id: 'gen-1', conversation_guid: 'conv-other', mode: 'single', status });
    assert.equal(g.snapshot().diagnostics.at(-1).code, 'GENERATION_STATUS_ERROR')
    const h = createChatGeneration(base());
    h.resolveCancel({ generation_id: 'gen-1', conversation_guid: 1, mode: 'single', status });
    assert.equal(h.snapshot().diagnostics.at(-1).code, 'GENERATION_STATUS_ERROR')
    const i = createChatGeneration(base());
    i.resolveStatus({ generation_id: 'gen-1', conversation_guid: ' ', mode: 'single', status });
    assert.equal(i.snapshot().diagnostics.at(-1).code, 'GENERATION_STATUS_ERROR')
    const j = createChatGeneration(base());
    j.resolveStatus({ generation_id: 'gen-1', conversation_guid: 'conv-1', mode: 'single', status, ...(status === 'failed' ? { code: 'upstream_error' } : {}) });
    assert.equal(j.snapshot().status, status === 'cancelled' ? 'cancelled' : status === 'failed' ? 'failed' : 'waiting')
  }
})

test('completed status requires exact persisted result fields and stable failure codes', () => {
  const incomplete = createChatGeneration(base());
  incomplete.resolveStatus({ generation_id: 'gen-1', conversation_guid: 'conv-1', mode: 'single', status: 'completed', result: { model: 'model-a', status: 'completed', content: 'x' } });
  assert.equal(incomplete.snapshot().diagnostics.at(-1).code, 'GENERATION_STATUS_ERROR')
  const compare = createChatGeneration({ ...base({ mode: 'compare', models: ['a', 'b'] }) });
  compare.resolveStatus({ generation_id: 'gen-1', conversation_guid: 'conv-1', mode: 'compare', status: 'completed', results: [
    { model: 'a', status: 'completed', assistant_message_guid: 'm-a', content: 'a', tokens: 1 },
    { model: 'b', status: 'failed', code: 'not-stable', content: 'secret' },
  ] });
  assert.equal(compare.snapshot().diagnostics.at(-1).code, 'GENERATION_STATUS_ERROR')
  const failed = createChatGeneration(base());
  failed.resolveStatus({ generation_id: 'gen-1', conversation_guid: null, mode: 'single', status: 'failed' });
  assert.equal(failed.snapshot().diagnostics.at(-1).code, 'GENERATION_STATUS_ERROR')
})

test('authoritative completed requires a safe nonnegative total token count, including zero', () => {
  for (const total_tokens_used of [undefined, null, '0', -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    const g = createChatGeneration(base());
    g.resolveStatus({ generation_id: 'gen-1', conversation_guid: 'conv-1', mode: 'single', status: 'completed', total_tokens_used, result: { model: 'model-a', status: 'completed', assistant_message_guid: 'm-a', content: 'x', tokens: 1 } });
    assert.equal(g.snapshot().diagnostics.at(-1).code, 'GENERATION_STATUS_ERROR')
  }
  const valid = createChatGeneration(base());
  valid.resolveStatus({ generation_id: 'gen-1', conversation_guid: 'conv-1', mode: 'single', status: 'completed', total_tokens_used: 0, result: { model: 'model-a', status: 'completed', assistant_message_guid: 'm-a', content: '', tokens: 0 } });
  assert.equal(valid.snapshot().status, 'completed')
})

test('fail closes every player, keeps displayed prefixes, and prevents later frames', () => {
  const clock = scheduler(); const g = createChatGeneration({ ...base(), playback: { requestFrame: clock.requestFrame, cancelFrame: clock.cancelFrame, now: () => 0, reducedMotion: true } })
  g.handleEvent(meta()); g.handleEvent(delta('model-a', 1, 'AB')); clock.step(1000); g.fail('transport'); const failed = g.snapshot();
  assert.equal(failed.status, 'failed'); assert.equal(failed.models[0].displayedText, 'A'); assert.equal(failed.models[0].pendingCount, 0); while (clock.step(2000)) {} assert.equal(g.snapshot().models[0].displayedText, 'A')
})

test('stale player callbacks cannot mutate after authoritative rebuild or disposal', () => {
  let oldDisplay; let oldError; const factory = ({ onDisplay, onError }) => { oldDisplay = onDisplay; oldError = onError; return { push() {}, finish() {}, cancel() {}, dispose() {}, snapshot: () => ({ displayedText: '', pendingCount: 0, finished: false, disposed: false }) } }
  const g = createChatGeneration({ ...base(), playbackFactory: factory }); g.handleEvent(meta()); g.resolveStatus({ generation_id: 'gen-1', conversation_guid: 'conv-1', mode: 'single', status: 'completed', total_tokens_used: 0, result: { model: 'model-a', status: 'completed', assistant_message_guid: 'm-a', content: '', tokens: 0 } }); oldDisplay('stale'); oldError('stale'); assert.equal(g.snapshot().models[0].displayedText, '')
  g.dispose(); oldDisplay('later'); assert.equal(g.snapshot().status, 'disposed'); assert.equal(g.snapshot().models[0].displayedText, '')
})

test('factory and cleanup failures stay fail-closed while sibling cleanup continues', () => {
  let disposed = 0; const factory = ({ model }) => { if (model === 'bad') throw new Error('secret'); return { push() {}, finish() {}, cancel() {}, dispose() { disposed += 1; throw new Error('cleanup') }, snapshot: () => ({ displayedText: '', pendingCount: 0, finished: false, disposed: false }) } }
  const g = createChatGeneration({ mode: 'compare', generationId: 'gen-1', conversationGuid: 'conv-1', messageKey: 'msg-1', models: ['bad', 'good'], playbackFactory: factory }); assert.equal(g.snapshot().status, 'failed'); g.dispose(); assert.equal(disposed, 1); assert.equal(g.snapshot().status, 'disposed')
})

test('cancel local queue keeps fail-closed failure instead of overwriting with cancelling', () => {
  const factory = ({ model }) => ({ push() {}, finish() {}, cancel() { if (model === 'bad') throw new Error('boom') }, dispose() {}, snapshot: () => ({ displayedText: '', pendingCount: 0, finished: false, disposed: false }) })
  const g = createChatGeneration({ ...base({ models: ['bad'] }), playbackFactory: factory }); g.handleEvent({ ...meta(), models: ['bad'] }); g.cancelLocalQueue(); assert.equal(g.snapshot().status, 'failed')
})

test('compare done rejects mismatched model status and token metadata defensively', () => {
  const g = createChatGeneration({ mode: 'compare', generationId: 'gen-1', conversationGuid: 'conv-1', messageKey: 'msg-1', models: ['a', 'b'] }); g.handleEvent(meta('gen-1', ['a', 'b'])); g.handleEvent({ type: 'model_done', generation_id: 'gen-1', model: 'a', last_seq: 0 }); g.handleEvent({ type: 'model_done', generation_id: 'gen-1', model: 'b', last_seq: 0 }); g.handleEvent({ type: 'done', generation_id: 'gen-1', status: 'completed', conversation_guid: 'conv-1', total_tokens_used: 0, models: { a: { status: 'completed', tokens: '0' }, b: { status: 'completed', tokens: 0 } } }); assert.equal(g.snapshot().status, 'failed')
})

test('player operation exceptions fail closed without escaping across terminal paths', () => {
  const throwing = operation => ({ push() { if (operation === 'push') throw new Error('push secret') }, finish() { if (operation === 'finish') throw new Error('finish secret') }, cancel() { if (operation === 'cancel') throw new Error('cancel secret') }, dispose() {}, snapshot: () => ({ displayedText: '', pendingCount: 0, finished: false, disposed: false }) })
  for (const [event, operation] of [
    [{ type: 'model_error', generation_id: 'gen-1', model: 'model-a', code: 'timeout' }, 'cancel'],
    [{ type: 'model_done', generation_id: 'gen-1', model: 'model-a', last_seq: 1 }, 'finish'],
  ]) {
    const g = createChatGeneration({ ...base(), playbackFactory: () => throwing(operation) }); g.handleEvent(meta()); if (event.type === 'model_done') g.handleEvent(delta('model-a', 1, 'A')); assert.doesNotThrow(() => g.handleEvent(event)); assert.equal(g.snapshot().status, 'failed')
  }
  const done = createChatGeneration({ ...base(), playbackFactory: () => throwing('finish') }); done.handleEvent(meta()); done.handleEvent(delta('model-a', 1, 'A')); done.handleEvent({ type: 'model_done', generation_id: 'gen-1', model: 'model-a', last_seq: 1 }); assert.doesNotThrow(() => done.handleEvent({ type: 'done', generation_id: 'gen-1', status: 'completed', conversation_guid: 'conv-1', total_tokens_used: 0 })); assert.equal(done.snapshot().status, 'failed')
})

test('authoritative player failures fail closed during sibling cancel, rebuild, push, and finish', () => {
  let calls = 0; const factory = ({ model }) => { calls += 1; if (model === 'bad') return { push() { throw new Error('push') }, finish() { throw new Error('finish') }, cancel() { throw new Error('cancel') }, dispose() {}, snapshot: () => ({ displayedText: '', pendingCount: 0, finished: false, disposed: false }) }; if (calls > 2) throw new Error('rebuild'); return { push() {}, finish() {}, cancel() {}, dispose() {}, snapshot: () => ({ displayedText: '', pendingCount: 0, finished: false, disposed: false }) } }
  const g = createChatGeneration({ mode: 'compare', generationId: 'gen-1', conversationGuid: 'conv-1', messageKey: 'msg-1', models: ['bad', 'good'], playbackFactory: factory }); g.handleEvent(meta('gen-1', ['bad', 'good'])); assert.doesNotThrow(() => g.resolveStatus({ generation_id: 'gen-1', conversation_guid: 'conv-1', mode: 'compare', status: 'completed', total_tokens_used: 0, results: [{ model: 'bad', status: 'failed', code: 'timeout' }, { model: 'good', status: 'completed', assistant_message_guid: 'm', content: 'x', tokens: 0 }] })); assert.equal(g.snapshot().status, 'failed')
})

test('proxy player getters and snapshot aggregation fail closed without escaping', () => {
  const bad = new Proxy({}, { get() { throw new Error('secret getter') } }); const g = createChatGeneration({ ...base(), playbackFactory: () => bad }); assert.equal(g.snapshot().status, 'failed'); assert.doesNotThrow(() => g.snapshot())
  const snapshotBad = new Proxy({ push() {}, finish() {}, cancel() {}, dispose() {}, snapshot() { throw new Error('snapshot') } }, { get(target, key) { return target[key] } }); const h = createChatGeneration({ ...base(), playbackFactory: () => snapshotBad }); h.handleEvent(meta()); assert.doesNotThrow(() => h.snapshot()); assert.equal(h.snapshot().status, 'failed')
})

test('cancel freezes all epochs before invoking player cancel callbacks', () => {
  let generation; const player = { push() {}, finish() {}, cancel() { generation.handleEvent({ type: 'delta', generation_id: 'gen-1', model: 'model-a', seq: 1, delta: 'late' }) }, dispose() {}, snapshot: () => ({ displayedText: '', pendingCount: 0, finished: false, disposed: false }) }; generation = createChatGeneration({ ...base(), playbackFactory: () => player }); generation.handleEvent(meta()); generation.cancelLocalQueue(); assert.equal(generation.snapshot().status, 'cancelling'); assert.equal(generation.snapshot().models[0].receivedText, '')
})

test('invalid player interfaces fail before any terminal path can drain', () => {
  const invalid = createChatGeneration({ ...base(), playbackFactory: () => ({ push() {}, finish() {}, cancel() {}, dispose() {}, snapshot: 1 }) }); assert.equal(invalid.snapshot().status, 'failed')
})

test('single direct done validates safe tokens and exact sanitized fields', () => {
  const make = done => { const g = createChatGeneration(base()); g.handleEvent(meta()); g.handleEvent(delta('model-a', 1, 'A')); g.handleEvent({ type: 'model_done', generation_id: 'gen-1', model: 'model-a', last_seq: 1 }); g.handleEvent(done); return g.snapshot().status }
  const common = { type: 'done', generation_id: 'gen-1', status: 'completed', conversation_guid: 'conv-1', tokens: 0, total_tokens_used: 0 }
  assert.equal(make({ ...common, tokens: -1 }), 'failed'); assert.equal(make({ ...common, tokens: 1.5 }), 'failed'); assert.equal(make({ ...common, total_tokens_used: '0' }), 'failed'); assert.equal(make({ ...common, tokens: 0, total_tokens_used: 0 }), 'draining')
})
