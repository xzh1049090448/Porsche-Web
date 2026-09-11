import assert from 'node:assert/strict'
import test from 'node:test'
import { setImmediate } from 'node:timers/promises'

import {
  PlatformGenerationHTTPError,
  PlatformGenerationIndeterminateError,
  PlatformGenerationRemoteError,
  createPlatformGenerationClient,
} from './platform-generation.js'

const generationId = '550e8400-e29b-41d4-a716-446655440000'
const otherGenerationId = '550e8400-e29b-41d4-a716-446655440001'
const encoder = new TextEncoder()
const jsonResponse = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), {
  status,
  headers: { 'Content-Type': 'application/json', ...headers },
})
const streamResponse = (chunks, { status = 200, headers = {}, error } = {}) => new Response(new ReadableStream({
  start(controller) {
    chunks.forEach(chunk => controller.enqueue(encoder.encode(chunk)))
    if (error) controller.error(error)
    else controller.close()
  },
}), { status, headers: { 'Content-Type': 'text/event-stream', ...headers } })
const meta = (models, id = generationId) => `event: meta\ndata: ${JSON.stringify({ schema: 'platform-chat-sse.v2', generation_id: id, conversation_guid: '42', models })}\n\n`
const delta = (model, seq, text, id = generationId) => `event: delta\ndata: ${JSON.stringify({ generation_id: id, model, seq, delta: text })}\n\n`
const modelDone = (model, seq, id = generationId) => `event: model_done\ndata: ${JSON.stringify({ generation_id: id, model, last_seq: seq })}\n\n`
const singleDone = (id = generationId) => `event: done\ndata: ${JSON.stringify({ generation_id: id, status: 'completed', conversation_guid: '42', tokens: 2, total_tokens_used: 9 })}\n\n`
const compareDone = (id = generationId) => `event: done\ndata: ${JSON.stringify({ generation_id: id, status: 'completed', conversation_guid: '42', total_tokens_used: 9, models: { a: { status: 'completed', tokens: 2 }, b: { status: 'completed', tokens: 3 } } })}\n\n`

function harness(responses, overrides = {}) {
  const calls = []
  const queue = [...responses]
  const client = createPlatformGenerationClient({
    baseURL: 'https://api.example.test',
    authenticatedFetchImpl: async (url, init) => {
      calls.push({ url, init })
      const next = queue.shift()
      if (next instanceof Error) throw next
      if (typeof next === 'function') return next(url, init)
      return next
    },
    randomUUID: () => generationId.toUpperCase(),
    ...overrides,
  })
  return { client, calls, queue }
}

function controlledStreamResponse({ chunks = [], contentType = 'text/event-stream', keepOpen = false, readError = null } = {}) {
  let reads = 0
  let readerCancels = 0
  let bodyCancels = 0
  let releases = 0
  const encoded = chunks.map(chunk => encoder.encode(chunk))
  const reader = {
    async read() {
      reads++
      if (encoded.length) return { done: false, value: encoded.shift() }
      if (readError) throw readError
      if (keepOpen) return new Promise(() => {})
      return { done: true, value: undefined }
    },
    async cancel() { readerCancels++ },
    releaseLock() { releases++ },
  }
  const body = {
    getReader() { return reader },
    async cancel() { bodyCancels++ },
  }
  return {
    response: { ok: true, status: 200, headers: new Headers({ 'Content-Type': contentType }), body },
    counts: () => ({ reads, readerCancels, bodyCancels, releases }),
  }
}

test('creates one canonical lowercase v4 UUID and reuses it in a single POST body', async () => {
  let uuidCalls = 0
  const { client, calls } = harness([
    streamResponse([meta(['model-a']), modelDone('model-a', 0), singleDone()]),
  ], { randomUUID: () => { uuidCalls++; return generationId.toUpperCase() } })
  const events = []
  const result = await client.streamSingle({ model: 'model-a', messages: [{ role: 'user', content: 'hello' }], max_tokens: 8 }, { onEvent: event => events.push(event) })

  assert.equal(uuidCalls, 1)
  assert.equal(result.generation_id, generationId)
  assert.equal(result.status, 'completed')
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, 'https://api.example.test/api/v1/platform/chat/completions')
  assert.equal(calls[0].init.method, 'POST')
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    model: 'model-a', messages: [{ role: 'user', content: 'hello' }], max_tokens: 8,
    stream: true, stream_version: 'platform-chat-sse.v2', generation_id: generationId,
  })
  assert.deepEqual(events.map(event => event.type), ['meta', 'model_done', 'done'])
  assert.ok(events.every(event => event.generation_id === generationId))
})

test('compare POST preserves contract fields, model order, and one generation id', async () => {
  const { client, calls } = harness([
    streamResponse([meta(['a', 'b']), delta('a', 1, 'A'), delta('b', 1, 'B'), modelDone('a', 1), modelDone('b', 1), compareDone()]),
  ])
  const result = await client.streamCompare({
    model: 'a', models: ['a', 'b'], messages: [{ role: 'user', content: 'hello' }], max_tokens: 8,
    conversation_guid: null, temperature: null, stop: [null], stream_options: { include_usage: true },
  })
  assert.equal(result.generation_id, generationId)
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    model: 'a', models: ['a', 'b'], messages: [{ role: 'user', content: 'hello' }], max_tokens: 8,
    conversation_guid: null, temperature: null, stop: [null], stream_options: { include_usage: true },
    stream: true, stream_version: 'platform-chat-sse.v2', generation_id: generationId,
  })
})

test('strict parser completes only on a valid done event and sanitizes model errors', async () => {
  const modelError = `event: model_error\ndata: ${JSON.stringify({ generation_id: generationId, model: 'a', code: 'timeout', request_id: 'req-1' })}\n\n`
  const done = `event: done\ndata: ${JSON.stringify({ generation_id: generationId, status: 'completed', conversation_guid: '42', total_tokens_used: 0, models: { a: { status: 'failed', code: 'timeout' }, b: { status: 'completed', tokens: 0 } } })}\n\n`
  const { client } = harness([streamResponse([meta(['a', 'b']), modelError, modelDone('b', 0), done])])
  const events = []
  const result = await client.streamCompare({ model: 'a', models: ['a', 'b'], messages: [{ role: 'user', content: 'x' }], max_tokens: 1 }, { onEvent: event => events.push(event) })
  assert.equal(result.status, 'completed')
  assert.deepEqual(events.find(event => event.type === 'model_error'), { type: 'model_error', generation_id: generationId, model: 'a', code: 'timeout' })
})

test('valid done terminates immediately, cancels the still-open body once, and ignores a later abort', async () => {
  const controlled = controlledStreamResponse({
    chunks: [meta(['model-a']) + modelDone('model-a', 0) + singleDone()],
    keepOpen: true,
  })
  const controller = new AbortController()
  const { client } = harness([controlled.response])
  const outcome = await Promise.race([
    client.streamSingle({ model: 'model-a', messages: [{ role: 'user', content: 'x' }], max_tokens: 1 }, { signal: controller.signal }),
    setImmediate('timed_out'),
  ])
  assert.notEqual(outcome, 'timed_out')
  assert.equal(outcome.status, 'completed')
  controller.abort()
  await Promise.resolve()
  assert.deepEqual(controlled.counts(), { reads: 1, readerCancels: 1, bodyCancels: 0, releases: 1 })
})

for (const [name, response, reason] of [
  ['EOF before done', streamResponse([meta(['model-a']), modelDone('model-a', 0)]), 'SSE_V2_EOF_WITHOUT_TERMINAL'],
  ['malformed event', streamResponse([meta(['model-a']), 'event: delta\ndata: {bad}\n\n']), 'SSE_V2_INVALID_JSON'],
  ['network failure', streamResponse([meta(['model-a'])], { error: new TypeError('private network detail') }), 'network_error'],
]) {
  test(`${name} is indeterminate, carries the generation id, and never replays POST`, async () => {
    const { client, calls } = harness([response])
    await assert.rejects(
      client.streamSingle({ model: 'model-a', messages: [{ role: 'user', content: 'x' }], max_tokens: 1 }),
      error => error instanceof PlatformGenerationIndeterminateError && error.generation_id === generationId && error.reason === reason,
    )
    assert.equal(calls.length, 1)
    assert.equal(calls[0].init.method, 'POST')
  })
}

test('client abort is an indeterminate generation outcome with no replay', async () => {
  const controller = new AbortController()
  const response = new Response(new ReadableStream({ start() {} }), { headers: { 'Content-Type': 'text/event-stream' } })
  const { client, calls } = harness([response])
  const pending = client.streamSingle({ model: 'model-a', messages: [{ role: 'user', content: 'x' }], max_tokens: 1 }, { signal: controller.signal })
  controller.abort()
  await assert.rejects(pending, error => error instanceof PlatformGenerationIndeterminateError && error.generation_id === generationId && error.reason === 'aborted')
  assert.equal(calls.length, 1)
})

test('a valid terminal server error is distinct from an indeterminate transport error', async () => {
  const remote = `event: error\ndata: ${JSON.stringify({ generation_id: generationId, code: 'timeout', request_id: 'req-1' })}\n\n`
  const { client } = harness([streamResponse([meta(['model-a']), remote])])
  await assert.rejects(
    client.streamSingle({ model: 'model-a', messages: [{ role: 'user', content: 'x' }], max_tokens: 1 }),
    error => error instanceof PlatformGenerationRemoteError && error.generation_id === generationId && error.code === 'SSE_V2_REMOTE_ERROR',
  )
})

test('strict parser failure cancels the unread response body', async () => {
  let cancellations = 0
  const response = new Response(new ReadableStream({
    start(controller) { controller.enqueue(encoder.encode(meta(['model-a']) + 'event: delta\ndata: {bad}\n\n')) },
    cancel() { cancellations++ },
  }), { headers: { 'Content-Type': 'text/event-stream' } })
  const { client } = harness([response])
  await assert.rejects(client.streamSingle({ model: 'model-a', messages: [{ role: 'user', content: 'x' }], max_tokens: 1 }), PlatformGenerationIndeterminateError)
  assert.equal(cancellations, 1)
})

test('invalid Content-Type cancels the unlocked body exactly once', async () => {
  const controlled = controlledStreamResponse({ contentType: 'application/json', keepOpen: true })
  const { client } = harness([controlled.response])
  await assert.rejects(
    client.streamSingle({ model: 'model-a', messages: [{ role: 'user', content: 'x' }], max_tokens: 1 }),
    error => error instanceof PlatformGenerationIndeterminateError && error.reason === 'invalid_stream_response',
  )
  assert.deepEqual(controlled.counts(), { reads: 0, readerCancels: 0, bodyCancels: 1, releases: 0 })
})

test('an already-aborted stream cancels the body before establishing a reader', async () => {
  const controlled = controlledStreamResponse({ keepOpen: true })
  const controller = new AbortController()
  controller.abort()
  const { client } = harness([controlled.response])
  await assert.rejects(
    client.streamSingle({ model: 'model-a', messages: [{ role: 'user', content: 'x' }], max_tokens: 1 }, { signal: controller.signal }),
    error => error instanceof PlatformGenerationIndeterminateError && error.reason === 'aborted',
  )
  assert.deepEqual(controlled.counts(), { reads: 0, readerCancels: 0, bodyCancels: 1, releases: 0 })
})

test('reader network failure cancels and releases its reader exactly once', async () => {
  const controlled = controlledStreamResponse({ chunks: [meta(['model-a'])], readError: new TypeError('private network detail') })
  const { client } = harness([controlled.response])
  await assert.rejects(
    client.streamSingle({ model: 'model-a', messages: [{ role: 'user', content: 'x' }], max_tokens: 1 }),
    error => error instanceof PlatformGenerationIndeterminateError && error.reason === 'network_error',
  )
  assert.deepEqual(controlled.counts(), { reads: 2, readerCancels: 1, bodyCancels: 0, releases: 1 })
})

const running = { generation_id: generationId, status: 'running', mode: 'single', conversation_guid: null }
const cancelling = { generation_id: generationId, status: 'cancelling', mode: 'single', conversation_guid: null }
const cancelled = { generation_id: generationId, status: 'cancelled', mode: 'single', conversation_guid: null }
const completed = { generation_id: generationId, status: 'completed', mode: 'single', conversation_guid: '42', result: { model: 'a', status: 'completed', assistant_message_guid: '88', content: 'ok', tokens: 2 }, total_tokens_used: 2 }

test('GET accepts exact pending and terminal schemas and rejects drift', async () => {
  const { client, calls } = harness([jsonResponse(running), jsonResponse(completed), jsonResponse({ ...running, private: 'secret' })])
  assert.deepEqual(await client.get(generationId), running)
  assert.deepEqual(await client.get(generationId), completed)
  await assert.rejects(client.get(generationId), error => error instanceof PlatformGenerationIndeterminateError && error.reason === 'invalid_status_response')
  assert.ok(calls.every(call => call.init.method === 'GET'))
})

test('GET preserves HTTP failures and rejects noncanonical IDs before network', async () => {
  const { client, calls } = harness([jsonResponse({ error: { code: 'generation_not_found', message: 'private', type: 'invalid_request_error', request_id: 'req-1' } }, 404)])
  await assert.rejects(client.get(generationId), error => error instanceof PlatformGenerationHTTPError && error.status === 404 && error.code === 'generation_not_found')
  await assert.rejects(client.get(generationId.toUpperCase()), /canonical lowercase UUID/)
  assert.equal(calls.length, 1)
})

test('HTTP errors never expose an unknown server-controlled code', async () => {
  const { client } = harness([jsonResponse({ error: { code: 'private_internal_detail', message: 'secret' } }, 503)])
  await assert.rejects(client.get(generationId), error => error instanceof PlatformGenerationHTTPError && error.status === 503 && error.code === 'request_failed' && !error.message.includes('secret'))
})

test('GET rejects result values outside the frozen UTF-8 byte boundaries', async () => {
  const tooWideModel = { ...completed, result: { ...completed.result, model: '模'.repeat(65) } }
  const tooLargeContent = { ...completed, result: { ...completed.result, content: '界'.repeat(21846) } }
  const { client } = harness([jsonResponse(tooWideModel), jsonResponse(tooLargeContent)])
  await assert.rejects(client.get(generationId), error => error instanceof PlatformGenerationIndeterminateError && error.reason === 'invalid_status_response')
  await assert.rejects(client.get(generationId), error => error instanceof PlatformGenerationIndeterminateError && error.reason === 'invalid_status_response')
})

test('cancel returns terminal 200 without polling', async () => {
  const { client, calls } = harness([jsonResponse(cancelled, 200)])
  assert.deepEqual(await client.cancel(generationId), cancelled)
  assert.deepEqual(calls.map(call => call.init.method), ['POST'])
  assert.equal(calls[0].url, `https://api.example.test/api/v1/platform/chat/generations/${generationId}/cancel`)
  assert.equal(calls[0].init.body, undefined)
})

test('cancel 202 honors a valid Retry-After then continues with GET only', async () => {
  const sleeps = []
  const { client, calls } = harness([
    jsonResponse(cancelling, 202, { 'Retry-After': '1' }), jsonResponse(completed),
  ], { sleep: async ms => { sleeps.push(ms) }, now: () => 0 })
  assert.deepEqual(await client.cancel(generationId), completed)
  assert.deepEqual(sleeps, [1000])
  assert.deepEqual(calls.map(call => call.init.method), ['POST', 'GET'])
})

for (const retryAfter of [undefined, '', 'private', '0', '2', '3', '01', '1 ']) {
  test(`cancel 202 rejects non-contract Retry-After ${JSON.stringify(retryAfter)}`, async () => {
    const sleeps = []
    const response = { ok: true, status: 202, headers: { get: name => name.toLowerCase() === 'retry-after' ? retryAfter ?? null : null }, json: async () => cancelling }
    const { client, calls } = harness([response], { sleep: async ms => { sleeps.push(ms) } })
    await assert.rejects(
      client.cancel(generationId),
      error => error instanceof PlatformGenerationIndeterminateError && error.reason === 'invalid_cancel_response' && error.generation_id === generationId,
    )
    assert.deepEqual(sleeps, [])
    assert.deepEqual(calls.map(call => call.init.method), ['POST'])
  })
}

test('an ambiguous cancel network failure is indeterminate with the generation id and no replay', async () => {
  const { client, calls } = harness([new TypeError('private network detail')])
  await assert.rejects(client.cancel(generationId), error => error instanceof PlatformGenerationIndeterminateError && error.reason === 'network_error' && error.generation_id === generationId)
  assert.deepEqual(calls.map(call => call.init.method), ['POST'])
})

test('poll uses 250ms, 500ms, 1s, 2s, caps the first 10s at eight GETs, then waits 5s', async () => {
  const sleeps = []
  let time = 0
  const responses = Array.from({ length: 8 }, () => jsonResponse(running))
  responses.push(jsonResponse(running), jsonResponse(completed))
  const { client, calls } = harness(responses, { sleep: async ms => { sleeps.push(ms); time += ms }, now: () => time })
  assert.deepEqual(await client.poll(generationId), completed)
  assert.deepEqual(sleeps, [250, 500, 1000, 2000, 2000, 2000, 2000, 5000, 5000])
  assert.equal(calls.filter(call => call.init.method === 'GET').length, 10)
  assert.equal(calls.filter(call => call.init.method === 'POST').length, 0)
})

test('poll supports AbortSignal and does not busy-loop or POST', async () => {
  const controller = new AbortController()
  let sleeps = 0
  const { client, calls } = harness([jsonResponse(running)], { sleep: async () => { sleeps++; controller.abort() }, now: () => 0 })
  await assert.rejects(client.poll(generationId, { signal: controller.signal }), error => error?.name === 'AbortError')
  assert.equal(sleeps, 1)
  assert.deepEqual(calls.map(call => call.init.method), ['GET'])
})

test('caller-supplied canonical generation id is reused but invalid or different ids are rejected locally', async () => {
  const { client, calls } = harness([streamResponse([meta(['model-a'], otherGenerationId), modelDone('model-a', 0, otherGenerationId), singleDone(otherGenerationId)])])
  const result = await client.streamSingle({ model: 'model-a', messages: [{ role: 'user', content: 'x' }], max_tokens: 1 }, { generationId: otherGenerationId })
  assert.equal(result.generation_id, otherGenerationId)
  assert.equal(JSON.parse(calls[0].init.body).generation_id, otherGenerationId)
  await assert.rejects(client.streamSingle({ model: 'a', messages: [], max_tokens: 1 }, { generationId: generationId.toUpperCase() }), /canonical lowercase UUID/)
  assert.equal(calls.length, 1)
})
