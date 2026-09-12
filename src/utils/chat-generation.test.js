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
  assert.throws(() => createChatGeneration(base({ models: ['a', 'b', 'c', 'd'], mode: 'compare' })), /multiple models/)
  const generation = createChatGeneration(base())
  const state = generation.snapshot()
  assert.equal(state.status, 'waiting'); assert.deepEqual(state.identity.models, ['model-a'])
  assert.ok(Object.isFrozen(state)); assert.ok(Object.isFrozen(state.identity))
  assert.throws(() => { state.identity.generationId = 'bad' }, TypeError)
})

test('allows an unbound new conversation and binds the first server guid exactly once', () => {
  const g = createChatGeneration(base({ conversationGuid: null }))
  g.handleEvent({ ...meta(), conversation_guid: '123' })
  assert.equal(g.snapshot().conversationGuid, '123')
  g.handleEvent({ ...meta(), conversation_guid: '124' })
  assert.equal(g.snapshot().status, 'failed')
  assert.equal(g.snapshot().conversationGuid, '123')
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
  g.handleEvent(meta('gen-1', ['a', 'b'])); g.handleEvent(delta('a', 1, 'A')); g.handleEvent(delta('b', 1, 'B')); g.handleEvent(modelDone('a')); g.handleEvent({ ...modelDone('b'), last_seq: 1 }); g.handleEvent({ type: 'done', generation_id: 'gen-1', status: 'completed', conversation_guid: 'conv-1', total_tokens_used: 2, models: { a: { status: 'completed', tokens: 1 }, b: { status: 'completed', tokens: 1 } } })
  assert.equal(g.snapshot().status, 'draining'); while (clock.step(1000)) {} assert.equal(g.snapshot().status, 'completed'); assert.equal(g.snapshot().models[0].displayedText, 'A'); assert.equal(g.snapshot().models[1].displayedText, 'B')
})

test('fake-clock generation snapshots grow one grapheme per frame at a uniform 25ms cadence', () => {
  const clock = scheduler(); let now = 0; const displayed = []
  const g = createChatGeneration({ ...base(), onChange: snapshot => {
    const value = snapshot.models[0].displayedText
    if (value && value !== displayed.at(-1)) displayed.push(value)
  }, playback: { requestFrame: clock.requestFrame, cancelFrame: clock.cancelFrame, now: () => now } })
  g.handleEvent(meta())
  now = 0; g.handleEvent(delta('model-a', 1, 'A'))
  now = 25; g.handleEvent(delta('model-a', 2, '。')); clock.step(now)
  now = 50; g.handleEvent(delta('model-a', 3, 'B')); clock.step(now)
  assert.deepEqual(displayed, ['A', 'A。'])
  now = 75; g.handleEvent(delta('model-a', 4, 'C')); clock.step(now)
  assert.equal(displayed.at(-1), 'A。B')
  g.handleEvent(modelDone('model-a', 4)); g.handleEvent(done())
  now = 100; while (clock.step(now)) now += 25
  assert.deepEqual(displayed, ['A', 'A。', 'A。B', 'A。BC'])
  assert.equal(g.snapshot().status, 'completed')
})

test('generation waits for the display commit before requesting the next render frame', () => {
  const clock = scheduler(); const commits = []; const displayed = []
  const g = createChatGeneration({ ...base(), onChange: snapshot => {
    const value = snapshot.models[0].displayedText
    if (value && value !== displayed.at(-1)) displayed.push(value)
  }, playback: {
    requestFrame: clock.requestFrame,
    cancelFrame: clock.cancelFrame,
    now: () => 0,
    afterDisplay: callback => commits.push(callback),
  } })
  g.handleEvent(meta()); g.handleEvent(delta('model-a', 1, 'ABC')); g.handleEvent(modelDone('model-a', 1)); g.handleEvent(done())
  clock.step(0)
  assert.deepEqual(displayed, ['A']); assert.equal(clock.size, 0)
  commits.shift()(); assert.equal(clock.size, 1)
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

test('model errors preserve only the displayed grapheme prefix and discard pending punctuation or backlog', () => {
  for (const [name, text, step] of [['pending', 'AB', false], ['punctuation', 'A。B', true], ['backlog', 'x'.repeat(132), true]]) {
    const clock = scheduler(); const g = createChatGeneration({ mode: 'compare', generationId: 'gen-1', conversationGuid: 'conv-1', messageKey: 'msg-1', models: ['a', 'b'], playback: { requestFrame: clock.requestFrame, cancelFrame: clock.cancelFrame, now: () => 0 } })
    g.handleEvent(meta('gen-1', ['a', 'b'])); g.handleEvent(delta('a', 1, text)); if (step) clock.step(1000)
    const displayed = g.snapshot().models[0].displayedText
    assert.ok(displayed.length < text.length, name)
    g.handleEvent({ type: 'model_error', generation_id: 'gen-1', model: 'a', code: 'gateway_upstream_error' })
    assert.equal(g.snapshot().models[0].displayedText, displayed, name); assert.equal(g.snapshot().models[0].pendingCount, 0, name)
  }
})

test('noncompleted status payloads require a null conversation guid', () => {
  for (const status of ['running', 'cancelling', 'committing', 'cancelled', 'failed']) {
    for (const conversation_guid of ['9223372036854775701', 'conv-other', 1, ' ']) {
      const rejected = createChatGeneration(base({ conversationGuid: null }))
      rejected.resolveStatus({ generation_id: 'gen-1', conversation_guid, mode: 'single', status, ...(status === 'failed' ? { code: 'upstream_error' } : {}) })
      assert.equal(rejected.snapshot().conversationGuid, null, `${status}:${JSON.stringify(conversation_guid)}`)
      assert.equal(rejected.snapshot().diagnostics.at(-1).code, 'GENERATION_STATUS_ERROR', status)
      assert.equal(rejected.snapshot().status, 'waiting', status)
    }

    const accepted = createChatGeneration(base({ conversationGuid: null }))
    if (status === 'cancelling') accepted.cancelLocalQueue()
    accepted.resolveStatus({ generation_id: 'gen-1', conversation_guid: null, mode: 'single', status, ...(status === 'failed' ? { code: 'upstream_error' } : {}) })
    assert.equal(accepted.snapshot().conversationGuid, null, status)
    assert.equal(accepted.snapshot().status, status === 'cancelled' ? 'cancelled' : status === 'failed' ? 'failed' : status === 'cancelling' ? 'cancelling' : 'waiting', status)
  }
})

test('authoritative completed binds a canonical guid without meta exactly once', () => {
  const observed = []; const clock = scheduler()
  const completed = createChatGeneration(base({ conversationGuid: null, onChange: snapshot => observed.push(snapshot.conversationGuid), playback: { requestFrame: clock.requestFrame, cancelFrame: clock.cancelFrame, now: () => 0, reducedMotion: true } }))
  const payload = { generation_id: 'gen-1', conversation_guid: '9223372036854775701', mode: 'single', status: 'completed', total_tokens_used: 1, result: { model: 'model-a', status: 'completed', assistant_message_guid: '9223372036854775702', content: 'done', tokens: 1 } }
  completed.resolveStatus(payload)
  assert.equal(completed.snapshot().conversationGuid, '9223372036854775701')
  assert.equal(completed.snapshot().status, 'draining')
  while (clock.step(1000)) {}
  assert.equal(completed.snapshot().status, 'completed')
  const notificationsBeforeReplay = observed.length
  completed.resolveStatus(payload)
  assert.equal(observed.length, notificationsBeforeReplay)
  assert.equal(completed.snapshot().conversationGuid, '9223372036854775701')
})

test('authoritative completed rejects invalid first guids and fails closed after meta mismatch', () => {
  for (const conversation_guid of [0, '', ' ', '0', '01', '9223372036854775808']) {
    const g = createChatGeneration(base({ conversationGuid: null }))
    g.resolveStatus({ generation_id: 'gen-1', conversation_guid, mode: 'single', status: 'completed', total_tokens_used: 1, result: { model: 'model-a', status: 'completed', assistant_message_guid: '2', content: 'done', tokens: 1 } })
    assert.equal(g.snapshot().conversationGuid, null, JSON.stringify(conversation_guid))
    assert.equal(g.snapshot().diagnostics.at(-1).code, 'GENERATION_STATUS_ERROR', JSON.stringify(conversation_guid))
  }

  const g = createChatGeneration(base({ conversationGuid: null }))
  g.handleEvent({ ...meta(), conversation_guid: '123' })
  g.resolveStatus({ generation_id: 'gen-1', conversation_guid: '124', mode: 'single', status: 'completed', total_tokens_used: 1, result: { model: 'model-a', status: 'completed', assistant_message_guid: '2', content: 'done', tokens: 1 } })
  assert.equal(g.snapshot().conversationGuid, '123')
  assert.equal(g.snapshot().status, 'failed')
  assert.equal(g.snapshot().diagnostics.at(-1).code, 'GENERATION_STATUS_ERROR')
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

test('compare direct done requires exact top-level schema and safe total token count', () => {
  const prepare = () => { const g = createChatGeneration({ mode: 'compare', generationId: 'gen-1', conversationGuid: 'conv-1', messageKey: 'msg-1', models: ['a', 'b'] }); g.handleEvent(meta('gen-1', ['a', 'b'])); g.handleEvent({ type: 'model_done', generation_id: 'gen-1', model: 'a', last_seq: 0 }); g.handleEvent({ type: 'model_done', generation_id: 'gen-1', model: 'b', last_seq: 0 }); return g }
  const models = { a: { status: 'completed', tokens: 0 }, b: { status: 'completed', tokens: 0 } }
  for (const total_tokens_used of [undefined, '0', -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) { const g = prepare(); g.handleEvent({ type: 'done', generation_id: 'gen-1', status: 'completed', conversation_guid: 'conv-1', total_tokens_used, models }); assert.equal(g.snapshot().status, 'failed') }
  for (const extra of [{ tokens: 0 }, { secret: 'x' }]) { const g = prepare(); g.handleEvent({ type: 'done', generation_id: 'gen-1', status: 'completed', conversation_guid: 'conv-1', total_tokens_used: 0, models, ...extra }); assert.equal(g.snapshot().status, 'failed') }
  const valid = prepare(); valid.handleEvent({ type: 'done', generation_id: 'gen-1', status: 'completed', conversation_guid: 'conv-1', total_tokens_used: 0, models }); assert.equal(valid.snapshot().status, 'completed')
})

test('cancel observes FE01 failed snapshot and cancelFrame cleanup errors', () => {
  const returnedFailed = { push() {}, finish() {}, cancel() { return { failed: true, errorCode: 'PLAYBACK_ERROR' } }, dispose() {}, snapshot: () => ({ displayedText: '', pendingCount: 0, finished: false, disposed: false }) }
  const g = createChatGeneration({ ...base(), playbackFactory: () => returnedFailed }); g.handleEvent(meta()); g.cancelLocalQueue(); assert.equal(g.snapshot().status, 'failed'); assert.equal(g.snapshot().diagnostics.at(-1).code, 'GENERATION_PLAYER_ERROR')
  let frame; const h = createChatGeneration({ ...base(), playback: { requestFrame: callback => { frame = callback; return 1 }, cancelFrame: () => { throw new Error('cancel frame') }, now: () => 0 } }); h.handleEvent(meta()); h.handleEvent(delta('model-a', 1, 'AB')); h.cancelLocalQueue(); assert.equal(h.snapshot().status, 'failed'); assert.equal(h.snapshot().diagnostics.at(-1).code, 'GENERATION_PLAYER_ERROR'); assert.ok(frame)
})

test('dynamic player method getters fail closed on every operation while normal dispose stays valid', () => {
  const methods = new Set(['push', 'finish', 'cancel', 'dispose']); let throwGetter = false
  const player = new Proxy({ snapshot: () => ({ displayedText: '', pendingCount: 0, finished: false, disposed: false }) }, { get(target, key) { if (throwGetter && methods.has(key)) throw new Error('dynamic getter'); if (methods.has(key)) return () => ({ failed: false }); return target[key] } })
  const g = createChatGeneration({ ...base(), playbackFactory: () => player }); g.handleEvent(meta()); throwGetter = true; g.handleEvent(delta('model-a', 1, 'A')); assert.equal(g.snapshot().status, 'failed')
  const normal = createChatGeneration({ ...base(), playbackFactory: () => ({ push() {}, finish() {}, cancel() {}, dispose() {}, snapshot: () => ({ displayedText: '', pendingCount: 0, finished: false, disposed: true, failed: false, errorCode: null }) }) }); normal.dispose(); assert.equal(normal.snapshot().status, 'disposed')
})

test('authoritative cancelled cleanup honors failed snapshots and keeps sibling cleanup attempts', () => {
  const failedCancel = { push() {}, finish() {}, cancel() { return { failed: true, errorCode: 'PLAYBACK_ERROR' } }, dispose() {}, snapshot: () => ({ failed: true, errorCode: 'PLAYBACK_ERROR', displayedText: '', pendingCount: 0 }) }
  const single = createChatGeneration({ ...base(), playbackFactory: () => failedCancel }); single.handleEvent(meta()); single.cancelLocalQueue(); single.resolveCancel({ generation_id: 'gen-1', conversation_guid: null, mode: 'single', status: 'cancelled' }); assert.equal(single.snapshot().status, 'failed')
  let cleaned = 0; const compare = createChatGeneration({ mode: 'compare', generationId: 'gen-1', conversationGuid: 'conv-1', messageKey: 'msg-1', models: ['a', 'b'], playbackFactory: ({ model }) => ({ push() {}, finish() {}, cancel() { cleaned += 1; if (model === 'a') throw new Error('cancel') }, dispose() {}, snapshot: () => ({ failed: false, errorCode: null, displayedText: '', pendingCount: 0 }) }) }); compare.handleEvent(meta('gen-1', ['a', 'b'])); compare.resolveStatus({ generation_id: 'gen-1', conversation_guid: null, mode: 'compare', status: 'cancelled' }); assert.equal(compare.snapshot().status, 'failed'); assert.equal(cleaned, 2)
  const normal = createChatGeneration(base()); normal.handleEvent(meta()); normal.resolveStatus({ generation_id: 'gen-1', conversation_guid: null, mode: 'single', status: 'cancelled' }); assert.equal(normal.snapshot().status, 'cancelled')
})

test('dispose records cleanup failure while reaching disposed without throwing', () => {
  const player = { push() {}, finish() {}, cancel() {}, dispose() { return { failed: true, errorCode: 'PLAYBACK_ERROR' } }, snapshot: () => ({ failed: true, errorCode: 'PLAYBACK_ERROR', displayedText: '', pendingCount: 0 }) }
  const g = createChatGeneration({ ...base(), playbackFactory: () => player }); assert.doesNotThrow(() => g.dispose()); assert.equal(g.snapshot().status, 'disposed'); assert.equal(g.snapshot().diagnostics.at(-1).code, 'GENERATION_CLEANUP_ERROR'); assert.equal(g.snapshot().models[0].terminal, 'failed')
})

test('runtime removal of an initially valid player method fails closed for push, finish, cancel, and dispose', () => {
  for (const method of ['push', 'finish', 'cancel', 'dispose']) {
    const target = { push() {}, finish() {}, cancel() {}, dispose() {}, snapshot: () => ({ failed: false, errorCode: null, displayedText: '', pendingCount: 0 }) }; const player = new Proxy(target, { get(obj, key) { if (key === method) return undefined; return obj[key] } }); const g = createChatGeneration({ ...base(), playbackFactory: () => player }); g.handleEvent(meta());
    if (method === 'push') g.handleEvent(delta('model-a', 1, 'A')); else if (method === 'finish') { g.handleEvent(delta('model-a', 1, 'A')); g.handleEvent({ type: 'model_done', generation_id: 'gen-1', model: 'model-a', last_seq: 1 }) } else if (method === 'cancel') g.cancelLocalQueue(); else g.dispose();
    assert.equal(g.snapshot().status, method === 'dispose' ? 'disposed' : 'failed'); assert.ok(g.snapshot().diagnostics.length > 0)
  }
})

test('authoritative completed rebuild stops on every old-player dispose failure', () => {
  for (const mode of ['missing', 'throw', 'return', 'snapshot']) {
    let broken = false; let creations = 0; const target = { push() {}, finish() {}, cancel() {}, dispose() {}, snapshot: () => ({ failed: false, errorCode: null, displayedText: '', pendingCount: 0 }) }
    const player = new Proxy(target, { get(obj, key) { if (broken && key === 'dispose' && mode === 'missing') return undefined; if (broken && key === 'dispose' && mode === 'throw') return () => { throw new Error('dispose') }; if (broken && key === 'dispose' && mode === 'return') return () => ({ failed: true, errorCode: 'PLAYBACK_ERROR' }); if (broken && key === 'snapshot' && mode === 'snapshot') return () => ({ failed: true, errorCode: 'PLAYBACK_ERROR' }); return obj[key] } })
    const g = createChatGeneration({ ...base(), playbackFactory: () => { creations += 1; return player } }); g.handleEvent(meta()); broken = true; g.resolveStatus({ generation_id: 'gen-1', conversation_guid: 'conv-1', mode: 'single', status: 'completed', total_tokens_used: 0, result: { model: 'model-a', status: 'completed', assistant_message_guid: 'm', content: '', tokens: 0 } }); assert.equal(g.snapshot().status, 'failed'); assert.equal(g.snapshot().diagnostics.at(-1).code, 'GENERATION_CLEANUP_ERROR'); assert.equal(creations, 1)
  }
})

test('compare rebuild cleanup failure fails closed and does not create sibling replacements', () => {
  const created = []; const g = createChatGeneration({ mode: 'compare', generationId: 'gen-1', conversationGuid: 'conv-1', messageKey: 'msg-1', models: ['a', 'b'], playbackFactory: ({ model }) => { const item = { push() {}, finish() {}, cancel() {}, dispose() {}, snapshot: () => ({ failed: false, errorCode: null, displayedText: '', pendingCount: 0 }) }; if (model === 'a') item.dispose = () => { throw new Error('dispose') }; created.push(model); return item } }); g.handleEvent(meta('gen-1', ['a', 'b'])); g.resolveStatus({ generation_id: 'gen-1', conversation_guid: 'conv-1', mode: 'compare', status: 'completed', total_tokens_used: 0, results: [{ model: 'a', status: 'completed', assistant_message_guid: 'm-a', content: '', tokens: 0 }, { model: 'b', status: 'completed', assistant_message_guid: 'm-b', content: '', tokens: 0 }] }); assert.equal(g.snapshot().status, 'failed'); assert.deepEqual(created, ['a', 'b'])
})

test('compare rebuild cleans every existing player after one or more cleanup failures and diagnoses once', () => {
  const disposed = []; const g = createChatGeneration({ mode: 'compare', generationId: 'gen-1', conversationGuid: 'conv-1', messageKey: 'msg-1', models: ['a', 'b', 'c'], playbackFactory: ({ model }) => ({ push() {}, finish() {}, cancel() {}, dispose() { disposed.push(model); if (model !== 'c') throw new Error('dispose') }, snapshot: () => ({ failed: false, errorCode: null, displayedText: '', pendingCount: 0 }) }) }); g.handleEvent(meta('gen-1', ['a', 'b', 'c'])); g.resolveStatus({ generation_id: 'gen-1', conversation_guid: 'conv-1', mode: 'compare', status: 'completed', total_tokens_used: 0, results: ['a', 'b', 'c'].map(model => ({ model, status: 'completed', assistant_message_guid: `m-${model}`, content: '', tokens: 0 })) }); assert.equal(g.snapshot().status, 'failed'); assert.deepEqual(disposed, ['a', 'b', 'c']); assert.equal(g.snapshot().diagnostics.filter(item => item.code === 'GENERATION_CLEANUP_ERROR').length, 1)
})
