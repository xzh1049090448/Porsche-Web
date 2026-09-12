import test from 'node:test'
import assert from 'node:assert/strict'
import { createPlatformSSEv2Parser } from './platform-sse-v2.js'

const enc = new TextEncoder()
const meta = (models = ['a'], generationId = 'g-1') =>
  `event: meta\ndata: ${JSON.stringify({ schema: 'platform-chat-sse.v2', generation_id: generationId, conversation_guid: '1', models })}\n\n`
const delta = (model, seq, text, generationId = 'g-1') =>
  `event: delta\ndata: ${JSON.stringify({ generation_id: generationId, model, seq, delta: text })}\n\n`
const modelDone = (model, lastSeq, generationId = 'g-1') =>
  `event: model_done\ndata: ${JSON.stringify({ generation_id: generationId, model, last_seq: lastSeq })}\n\n`
const done = (models = undefined, generationId = 'g-1') =>
  `event: done\ndata: ${JSON.stringify({ generation_id: generationId, status: 'completed', conversation_guid: '1', ...(models === undefined ? { tokens: 1 } : { models }), total_tokens_used: 1 })}\n\n`

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
  p.push(`: keepalive\r\nevent: meta\r\ndata: {"schema":"platform-chat-sse.v2",\r\ndata: "generation_id":"g-1","conversation_guid":"1","models":["a"]}\r\n\r\n`)
  p.push(delta('a', 1, 'hi') + modelDone('a', 1) + done())
  p.finish()
  assert.equal(errors.length, 0)
  assert.deepEqual(events.map(e => e.type), ['meta', 'delta', 'model_done', 'done'])
  assert.equal(events[1].delta, 'hi')
})

test('decodes UTF-8 bytes split inside a multibyte character', () => {
  const { p, events } = parser()
  const bytes = enc.encode(meta() + delta('a', 1, '中') + modelDone('a', 1) + done())
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

test('requires every single model to terminate before global done', () => {
  const { p, errors } = parser()
  p.push(meta() + delta('a', 1, 'x') + done())
  assert.equal(errors[0].code, 'SSE_V2_PROTOCOL_ERROR')
})

test('rejects successful global done after single model_error', () => {
  const { p, errors } = parser()
  p.push(meta() + 'event: model_error\ndata: ' + JSON.stringify({ generation_id: 'g-1', model: 'a', code: 'gateway_upstream_error' }) + '\n\n' + done())
  assert.equal(errors[0].code, 'SSE_V2_PROTOCOL_ERROR')
})

test('requires exact compare terminal models and matching statuses/tokens', () => {
  const { p, errors } = parser({ models: ['a', 'b'] })
  p.push(meta(['a', 'b']) + modelDone('a', 0) + 'event: model_error\ndata: ' + JSON.stringify({ generation_id: 'g-1', model: 'b', code: 'gateway_upstream_error' }) + '\n\n' + done({ a: { status: 'completed', tokens: 1 }, b: { status: 'failed', code: 'gateway_upstream_error' }, extra: { status: 'failed', code: 'gateway_upstream_error' } }))
  assert.equal(errors[0].code, 'SSE_V2_PROTOCOL_ERROR')
})

test('requires exact compare result keys and strict global done fields', () => {
  for (const item of [
    { status: 'completed', tokens: 1, content: 'secret' },
    { status: 'failed', code: 'upstream_error', request_id: 'secret' },
  ]) {
    const { p, errors } = parser({ models: ['a', 'b'] })
    p.push(meta(['a', 'b']) + modelDone('a', 0) + 'event: model_error\ndata: ' + JSON.stringify({ generation_id: 'g-1', model: 'b', code: 'upstream_error' }) + '\n\n' + done({ a: { status: 'completed', tokens: 1 }, b: item }))
    assert.equal(errors[0].code, 'SSE_V2_PROTOCOL_ERROR')
  }
  for (const fields of [
    { generation_id: 'wrong', status: 'completed', conversation_guid: 'c-1', tokens: 1 },
    { generation_id: 'g-1', status: 'completed', conversation_guid: ' ', tokens: 1 },
    { generation_id: 'g-1', status: 'completed', conversation_guid: 'c-1', tokens: -1 },
    { generation_id: 'g-1', status: 'completed', conversation_guid: 'c-1', tokens: 1.2 },
  ]) {
    const { p, errors } = parser()
    p.push(meta() + modelDone('a', 0) + `event: done\ndata: ${JSON.stringify(fields)}\n\n`)
    assert.equal(errors[0].code, 'SSE_V2_PROTOCOL_ERROR')
  }
})

test('rejects extra sensitive fields on delta, model_done, model_error, and global error without callback leakage', () => {
  const cases = [
    ['delta', { generation_id: 'g-1', model: 'a', seq: 1, delta: 'x' }],
    ['model_done', { generation_id: 'g-1', model: 'a', last_seq: 0 }],
    ['model_error', { generation_id: 'g-1', model: 'a', code: 'upstream_error' }],
    ['error', { generation_id: 'g-1', code: 'upstream_error' }],
  ]
  const sensitiveFields = ['authorization', 'prompt', 'password', 'content', 'body', 'detail', 'url']
  for (const [event, base] of cases) {
    for (const field of sensitiveFields) {
      const secret = `secret-${event}-${field}-https://internal.example`
      const { p, events, errors } = parser()
      p.push(meta() + `event: ${event}\ndata: ${JSON.stringify({ ...base, [field]: secret })}\n\n`)
      assert.deepEqual(errors, [{ code: 'SSE_V2_PROTOCOL_ERROR' }], `${event}:${field}`)
      assert.equal(events.some(item => item.type === event), false, `${event}:${field}:event leaked`)
      assert.equal(JSON.stringify({ events, errors }).includes(secret), false, `${event}:${field}:payload leaked`)
    }
  }
})

test('global done requires total_tokens_used and exact schema keys without sensitive top-level fields', () => {
  const validSingle = { generation_id: 'g-1', status: 'completed', conversation_guid: '1', tokens: 1, total_tokens_used: 1 }
  for (const payload of [
    { ...validSingle, prompt: 'secret' },
    { ...validSingle, content: 'secret' },
    { generation_id: 'g-1', status: 'completed', conversation_guid: 'c-1', tokens: 1 },
  ]) {
    const { p, errors } = parser(); p.push(meta() + modelDone('a', 0) + `event: done\ndata: ${JSON.stringify(payload)}\n\n`); assert.equal(errors[0].code, 'SSE_V2_PROTOCOL_ERROR')
  }
  const validCompare = { generation_id: 'g-1', status: 'completed', conversation_guid: '1', total_tokens_used: 1, models: { a: { status: 'completed', tokens: 1 }, b: { status: 'failed', code: 'upstream_error' } } }
  for (const payload of [{ ...validCompare, tokens: 1 }, { ...validCompare, request_id: 'secret' }]) {
    const { p, errors } = parser({ models: ['a', 'b'] }); p.push(meta(['a', 'b']) + modelDone('a', 0) + 'event: model_error\ndata: ' + JSON.stringify({ generation_id: 'g-1', model: 'b', code: 'upstream_error' }) + '\n\n' + `event: done\ndata: ${JSON.stringify(payload)}\n\n`); assert.equal(errors[0].code, 'SSE_V2_PROTOCOL_ERROR')
  }
})

test('global done callback is sanitized to schema fields only', () => {
  const { p, events } = parser(); p.push(meta() + modelDone('a', 0) + 'event: done\ndata: ' + JSON.stringify({ generation_id: 'g-1', status: 'completed', conversation_guid: '1', tokens: 1, total_tokens_used: 1 }) + '\n\n')
  assert.deepEqual(Object.keys(events.find(e => e.type === 'done')).sort(), ['conversation_guid', 'generation_id', 'status', 'tokens', 'total_tokens_used', 'type'])
})

test('rejects meta extra sensitive fields without callback leakage', () => {
  const { p, events, errors } = parser()
  p.push(`event: meta\ndata: ${JSON.stringify({ schema: 'platform-chat-sse.v2', generation_id: 'g-1', conversation_guid: '1', models: ['a'], prompt: 'secret', Authorization: 'Bearer secret' })}\n\n`)
  assert.equal(errors[0].code, 'SSE_V2_PROTOCOL_ERROR'); assert.equal(events.length, 0)
})

test('rejects missing, null, numeric, and blank meta conversation GUIDs', () => {
  for (const conversation_guid of [undefined, null, 42, '   ']) {
    const payload = { schema: 'platform-chat-sse.v2', generation_id: 'g-1', models: ['a'] }; if (conversation_guid !== undefined) payload.conversation_guid = conversation_guid
    const { p, errors } = parser(); p.push(`event: meta\ndata: ${JSON.stringify(payload)}\n\n`); assert.equal(errors[0].code, 'SSE_V2_PROTOCOL_ERROR')
  }
})

test('rejects non-positive, non-canonical, non-decimal, and out-of-int64 conversation GUIDs in meta and done', () => {
  for (const conversation_guid of ['0', '-1', '01', '+1', '1.0', 'abc', 'https://internal.example', '1\n2', '9223372036854775808']) {
    const metaPayload = { schema: 'platform-chat-sse.v2', generation_id: 'g-1', conversation_guid, models: ['a'] }
    const invalidMeta = parser()
    invalidMeta.p.push(`event: meta\ndata: ${JSON.stringify(metaPayload)}\n\n`)
    assert.deepEqual(invalidMeta.errors, [{ code: 'SSE_V2_PROTOCOL_ERROR' }], `meta:${conversation_guid}`)

    const donePayload = { generation_id: 'g-1', status: 'completed', conversation_guid, tokens: 1, total_tokens_used: 1 }
    const invalidDone = parser()
    invalidDone.p.push(meta() + modelDone('a', 0) + `event: done\ndata: ${JSON.stringify(donePayload)}\n\n`)
    assert.deepEqual(invalidDone.errors, [{ code: 'SSE_V2_PROTOCOL_ERROR' }], `done:${conversation_guid}`)
  }
})

test('accepts the canonical signed-int64 maximum conversation GUID without numeric coercion', () => {
  const conversation_guid = '9223372036854775807'
  const { p, events, errors } = parser()
  p.push(
    `event: meta\ndata: ${JSON.stringify({ schema: 'platform-chat-sse.v2', generation_id: 'g-1', conversation_guid, models: ['a'] })}\n\n` +
    modelDone('a', 0) +
    `event: done\ndata: ${JSON.stringify({ generation_id: 'g-1', status: 'completed', conversation_guid, tokens: 1, total_tokens_used: 1 })}\n\n`,
  )
  p.finish()
  assert.equal(errors.length, 0)
  assert.equal(events[0].conversation_guid, conversation_guid)
  assert.equal(events.at(-1).conversation_guid, conversation_guid)
})

test('rejects unsafe or overlong model and global error request IDs without exposing them', () => {
  const unsafeIDs = ['', 'https://internal.example/request', 'line\nbreak', 'control\u0001byte', 'x'.repeat(129)]
  for (const event of ['model_error', 'error']) {
    for (const request_id of unsafeIDs) {
      const payload = event === 'model_error'
        ? { generation_id: 'g-1', model: 'a', code: 'timeout', request_id }
        : { generation_id: 'g-1', code: 'timeout', request_id }
      const { p, events, errors } = parser()
      p.push(meta() + `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`)
      assert.deepEqual(errors, [{ code: 'SSE_V2_PROTOCOL_ERROR' }], `${event}:${JSON.stringify(request_id)}`)
      assert.equal(events.some(item => item.type === event), false)
      assert.equal(JSON.stringify({ events, errors }).includes(request_id), request_id === '')
    }
  }
})

test('requires model_error code to be a nonblank stable code', () => {
  for (const code of [undefined, null, 42, '   ']) {
    const payload = { generation_id: 'g-1', model: 'a' }; if (code !== undefined) payload.code = code
    const { p, errors } = parser(); p.push(meta() + `event: model_error\ndata: ${JSON.stringify(payload)}\n\n`); assert.equal(errors[0].code, 'SSE_V2_PROTOCOL_ERROR')
  }
})

test('requires meta to be the first protocol event, while comments remain ignorable', () => {
  const before = parser(); before.p.push('event: future\ndata: {}\n\n'); assert.equal(before.errors[0].code, 'SSE_V2_PROTOCOL_ERROR')
  const comments = parser(); comments.p.push(': keepalive\n\n' + meta() + modelDone('a', 0) + done()); assert.equal(comments.errors.length, 0)
  const after = parser(); after.p.push(meta() + 'event: future\ndata: secret\n\n' + modelDone('a', 0) + done()); assert.equal(after.errors.length, 0)
})

test('fails closed on configurable framing and accepted-event limits', () => {
  const open = parser({ maxBufferBytes: 8 }); open.p.push('event: meta'); assert.equal(open.errors[0].code, 'SSE_V2_LIMIT_EXCEEDED')
  const event = parser({ maxEventBytes: 8 }); event.p.push('event: meta\n\n'); assert.equal(event.errors[0].code, 'SSE_V2_LIMIT_EXCEEDED')
  const accepted = parser({ maxAcceptedEvents: 0 }); accepted.p.push(meta()); assert.equal(accepted.errors[0].code, 'SSE_V2_LIMIT_EXCEEDED')
  const many = parser({ maxBufferBytes: 40 }); many.p.push(': a\n\n: b\n\n: c\n\n' + meta() + modelDone('a', 0) + done()); assert.equal(many.errors.length, 0)
})

test('deeply nested JSON cannot escape parser as a thrown exception', () => {
  let value = '{}'; for (let i = 0; i < 12000; i += 1) value = `{"x":${value}}`
  const { p, errors } = parser(); p.push(`event: meta\ndata: ${value}\n\n`); assert.equal(errors[0].code, 'SSE_V2_PROTOCOL_ERROR')
})

test('rejects unknown model and global error codes without normalization or payload leakage', () => {
  for (const event of ['model_error', 'error']) {
    const secretCode = `raw-${event}-https://internal.example`
    const payload = event === 'model_error'
      ? { generation_id: 'g-1', model: 'a', code: secretCode }
      : { generation_id: 'g-1', code: secretCode }
    const { p, events, errors } = parser()
    p.push(meta() + `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`)
    assert.deepEqual(errors, [{ code: 'SSE_V2_PROTOCOL_ERROR' }], event)
    assert.equal(events.some(item => item.type === event), false, `${event}:event leaked`)
    assert.equal(JSON.stringify({ events, errors }).includes(secretCode), false, `${event}:code leaked`)
  }
})

test('accepts a closed stable global error and emits only the local error code', () => {
  const { p, events, errors } = parser()
  p.push(meta() + 'event: error\ndata: ' + JSON.stringify({ generation_id: 'g-1', code: 'timeout', request_id: 'req-1' }) + '\n\n')
  assert.deepEqual(errors, [{ code: 'SSE_V2_REMOTE_ERROR' }])
  assert.deepEqual(events.map(event => event.type), ['meta'])
  assert.equal(JSON.stringify({ events, errors }).includes('req-1'), false)
})

test('accepts model_error as one model terminal and emits no error text', () => {
  const { p, events, errors } = parser({ models: ['a', 'b'] })
  p.push(meta(['a', 'b']) + delta('a', 1, 'A') + modelDone('a', 1) + 'event: model_error\ndata: ' + JSON.stringify({ generation_id: 'g-1', model: 'b', code: 'gateway_upstream_error', request_id: 'req-1' }) + '\n\n' + done({ a: { status: 'completed', tokens: 1 }, b: { status: 'failed', code: 'gateway_upstream_error' } }))
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
  p.push(meta() + delta('a', 1, 'x') + delta('a', 1, 'x') + modelDone('a', 1) + modelDone('a', 1) + done() + done() + 'event: delta\ndata: ' + JSON.stringify({ generation_id: 'g-1', model: 'a', seq: 2, delta: 'late' }) + '\n\n')
  p.finish()
  assert.equal(errors.length, 1)
  assert.equal(events.filter(e => e.type === 'delta').length, 1)
  assert.equal(errors[0].code, 'SSE_V2_EVENT_AFTER_TERMINAL')
})

test('rejects a delta after model terminal even when it repeats an accepted delta, but deduplicates exact global done', () => {
  const { p, errors } = parser()
  p.push(meta() + delta('a', 1, 'x') + modelDone('a', 1) + delta('a', 1, 'x'))
  assert.equal(errors[0].code, 'SSE_V2_EVENT_AFTER_TERMINAL')
  const complete = parser(); complete.p.push(meta() + modelDone('a', 0) + done()); complete.p.push(done()); complete.p.finish(); assert.equal(complete.errors.length, 0)
})

test('string BOM is handled exactly like a byte BOM and trailing whitespace is ignored', () => {
  const stringParser = parser(); stringParser.p.push('\ufeff' + meta() + modelDone('a', 0) + done() + '  \n'); stringParser.p.finish()
  const byteParser = parser(); byteParser.p.push(new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode(meta() + modelDone('a', 0) + done() + '  \n')])); byteParser.p.finish()
  assert.equal(stringParser.errors.length, 0); assert.equal(byteParser.errors.length, 0)
})

test('rejects a second meta event even when its payload is identical', () => {
  const { p, errors } = parser()
  p.push(meta() + meta())
  assert.equal(errors[0].code, 'SSE_V2_PROTOCOL_ERROR')
})

test('unknown events are ignored with a safe diagnostic and valid done still completes', () => {
  const { p, events, errors } = parser()
  p.push(meta() + 'event: future_type\ndata: secret body\n\n' + delta('a', 1, 'x') + modelDone('a', 1) + done())
  p.finish()
  assert.equal(errors.length, 0)
  assert.deepEqual(events.map(e => e.type), ['meta', 'diagnostic', 'delta', 'model_done', 'done'])
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
