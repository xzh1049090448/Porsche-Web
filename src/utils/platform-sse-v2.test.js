import test from 'node:test'
import assert from 'node:assert/strict'
import { createPlatformSSEv2Parser } from './platform-sse-v2.js'

const enc = new TextEncoder()
const meta = (models = ['a'], generationId = 'g-1') =>
  `event: meta\ndata: ${JSON.stringify({ schema: 'platform-chat-sse.v2', generation_id: generationId, conversation_guid: 'c-1', models })}\n\n`
const delta = (model, seq, text, generationId = 'g-1') =>
  `event: delta\ndata: ${JSON.stringify({ generation_id: generationId, model, seq, delta: text })}\n\n`
const modelDone = (model, lastSeq, generationId = 'g-1') =>
  `event: model_done\ndata: ${JSON.stringify({ generation_id: generationId, model, last_seq: lastSeq })}\n\n`
const done = (models = { a: { status: 'completed', tokens: 1 } }, generationId = 'g-1') =>
  `event: done\ndata: ${JSON.stringify({ generation_id: generationId, status: 'completed', conversation_guid: 'c-1', models, tokens: 1 })}\n\n`

function parser(options = {}) {
  const events = []
  const errors = []
  const p = createPlatformSSEv2Parser({
    generationId: 'g-1',
    models: ['a'],
    onEvent: event => events.push(event),
    onError: error => errors.push(error),
    ...options,
  })
  return { p, events, errors }
}

test('frames CRLF, LF, comments, multi-line data, and multiple events', () => {
  const { p, events, errors } = parser()
  p.push(`: keepalive\r\nevent: meta\r\ndata: {"schema":"platform-chat-sse.v2",\r\ndata: "generation_id":"g-1","conversation_guid":"c-1","models":["a"]}\r\n\r\n`)
  p.push(delta('a', 1, 'hi') + done())
  p.finish()
  assert.equal(errors.length, 0)
  assert.deepEqual(events.map(e => e.type), ['meta', 'delta', 'done'])
  assert.equal(events[1].delta, 'hi')
})

test('decodes UTF-8 bytes split inside a multibyte character', () => {
  const { p, events } = parser()
  const bytes = enc.encode(meta() + delta('a', 1, '中') + done())
  const marker = bytes.indexOf(enc.encode('中')[0])
  p.push(bytes.slice(0, marker + 1))
  p.push(bytes.slice(marker + 1))
  p.finish()
  assert.equal(events[1].delta, '中')
})

test('accepts interleaved compare models with independent sequences and terminals', () => {
  const { p, events, errors } = parser({ models: ['a', 'b'] })
  p.push(meta(['a', 'b']) + delta('a', 1, 'A') + delta('b', 1, 'B') + delta('a', 2, 'C') + modelDone('b', 1) + modelDone('a', 2) + done({ a: { status: 'completed', tokens: 2 }, b: { status: 'completed', tokens: 1 } }))
  p.finish()
  assert.equal(errors.length, 0)
  assert.deepEqual(events.filter(e => e.type === 'delta').map(e => e.model), ['a', 'b', 'a'])
})

test('accepts model_error as one model terminal and emits no error text', () => {
  const { p, events, errors } = parser({ models: ['a', 'b'] })
  p.push(meta(['a', 'b']) + delta('a', 1, 'A') + modelDone('a', 1) + 'event: model_error\ndata: ' + JSON.stringify({ generation_id: 'g-1', model: 'b', code: 'gateway_upstream_error', request_id: 'req-1' }) + '\n\n' + done({ a: { status: 'completed', tokens: 1 }, b: { status: 'failed', tokens: 0 } }))
  p.finish()
  assert.equal(errors.length, 0)
  assert.equal(events.find(e => e.type === 'model_error').code, 'gateway_upstream_error')
  assert.equal('request_id' in events.find(e => e.type === 'model_error'), false)
})

test('rejects missing meta, empty delta, sequence gaps, and invalid JSON with stable one-shot errors', () => {
  for (const stream of [
    delta('a', 1, 'x'),
    meta() + delta('a', 1, ''),
    meta() + delta('a', 2, 'x'),
    'event: meta\ndata: {nope}\n\n',
  ]) {
    const { p, errors } = parser()
    p.push(stream)
    p.finish()
    assert.equal(errors.length, 1)
    assert.match(errors[0].code, /^SSE_V2_/) 
    assert.equal(JSON.stringify(errors[0]).includes(stream), false)
  }
})

test('deduplicates exact accepted events but rejects conflicting duplicates and events after terminal', () => {
  const { p, events, errors } = parser()
  p.push(meta() + delta('a', 1, 'x') + delta('a', 1, 'x') + modelDone('a', 1) + modelDone('a', 1) + done() + done())
  p.finish()
  assert.equal(errors.length, 1)
  assert.equal(events.filter(e => e.type === 'delta').length, 1)
  assert.equal(errors[0].code, 'SSE_V2_EVENT_AFTER_TERMINAL')
})

test('rejects a second meta event even when its payload is identical', () => {
  const { p, errors } = parser()
  p.push(meta() + meta())
  assert.equal(errors[0].code, 'SSE_V2_PROTOCOL_ERROR')
})

test('unknown events are ignored with a safe diagnostic and valid done still completes', () => {
  const { p, events, errors } = parser()
  p.push(meta() + 'event: future_type\ndata: secret body\n\n' + delta('a', 1, 'x') + done())
  p.finish()
  assert.equal(errors.length, 0)
  assert.deepEqual(events.map(e => e.type), ['meta', 'diagnostic', 'delta', 'done'])
  assert.equal(events[1].category, 'unknown_event')
  assert.equal('data' in events[1], false)
})

test('finish without global done, [DONE], callback failures, invalid input, and duplicate finish fail closed', () => {
  const eof = parser(); eof.p.push(meta()); eof.p.finish(); assert.equal(eof.errors.length, 1); assert.equal(eof.errors[0].code, 'SSE_V2_EOF_WITHOUT_TERMINAL')
  eof.p.finish(); assert.equal(eof.errors.length, 1)
  const sentinel = parser(); sentinel.p.push(meta() + 'data: [DONE]\n\n'); assert.equal(sentinel.errors.length, 1); assert.equal(sentinel.errors[0].code, 'SSE_V2_LEGACY_DONE')
  const badCallback = parser({ onEvent: () => { throw new Error('secret') } }); badCallback.p.push(meta()); assert.equal(badCallback.errors[0].code, 'SSE_V2_CALLBACK_FAILURE')
  const badInput = parser(); badInput.p.push({}); assert.equal(badInput.errors[0].code, 'SSE_V2_INVALID_INPUT')
})
