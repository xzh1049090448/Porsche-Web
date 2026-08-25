import test from 'node:test'
import assert from 'node:assert/strict'
import { parsePlatformEvent, readPlatformChatStream, readPlatformCompareStream } from './sse.js'

test('parsePlatformEvent reads white-label compare chunk and model lifecycle events', () => {
  assert.deepEqual(
    parsePlatformEvent('chunk', '{"model":"model-a","chunk":{"choices":[{"delta":{"content":"你好"}}]}}'),
    { kind: 'modelChunk', model: 'model-a', delta: '你好' }
  )
  assert.deepEqual(parsePlatformEvent('model_done', '{"model":"model-a"}'), { kind: 'modelDone', model: 'model-a' })
  assert.deepEqual(
    parsePlatformEvent('model_error', '{"model":"model-b","error":{"code":"gateway_upstream_error"}}'),
    { kind: 'modelError', model: 'model-b', message: '服务暂不可用' }
  )
})

test('parsePlatformEvent keeps client errors generic and rejects untrusted event shapes', () => {
  assert.deepEqual(parsePlatformEvent('error', '{"error":{"message":"upstream secret"}}'), { kind: 'error', message: '请求失败' })
  assert.equal(parsePlatformEvent('chunk', '{"model":"","chunk":{}}'), null)
  assert.equal(parsePlatformEvent('unknown', '{}'), null)
})

test('parsePlatformEvent never exposes model_error message, prompt, password, or authorization data', () => {
  const event = parsePlatformEvent(
    'model_error',
    '{"model":"model-b","error":{"code":"unknown","message":"prompt=用户私密问题 password=hunter2 Authorization=Bearer secret","prompt":"不应显示","password":"hunter2","authorization":"Bearer secret"}}'
  )

  assert.deepEqual(event, { kind: 'modelError', model: 'model-b', message: '请求失败' })
  const rendered = JSON.stringify(event)
  assert.doesNotMatch(rendered, /prompt|password|Authorization|hunter2|secret/)
})

test('readPlatformCompareStream preserves successful siblings when one model emits model_error', async () => {
  const encoder = new TextEncoder()
  const response = new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode('event: chunk\ndata: {"model":"a","chunk":{"choices":[{"delta":{"content":"A"}}]}}\n\nevent: model_error\ndata: {"model":"b","error":{"code":"gateway_upstream_error","message":"prompt=private Authorization=Bearer secret"}}\n\nevent: model_done\ndata: {"model":"a"}\n\ndata: [DONE]\n\n'))
      controller.close()
    },
  }), { status: 200 })
  const chunks = []
  const results = []
  await readPlatformCompareStream(response, {
    onModelChunk: (event) => chunks.push(event),
    onModelResult: (event) => results.push(event),
  })

  assert.deepEqual(chunks, [{ model: 'a', delta: 'A' }])
  assert.deepEqual(results, [{ model: 'b', error: '服务暂不可用' }, { model: 'a' }])
})

test('readPlatformChatStream uses conversation_guid metadata without retired dataset fields', async () => {
  const encoder = new TextEncoder()
  const response = new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode('data: {"type":"meta","conversation_guid":"903496573054181376","dataset_used":true}\n\ndata: {"type":"done","conversation_guid":"903496573054181376","dataset_attribution":"legacy","tokens":12}\n\n'))
      controller.close()
    },
  }), { status: 200 })
  const events = []
  await readPlatformChatStream(response, {
    onMeta: (meta) => events.push(['meta', meta]),
    onDone: (meta) => events.push(['done', meta]),
  })

  assert.deepEqual(events, [
    ['meta', { conversationGuid: '903496573054181376' }],
    ['done', { conversationGuid: '903496573054181376', tokens: 12, totalTokensUsed: undefined }],
  ])
})

test('SSE metadata rejects numeric, null, and blank conversation_guid values', async () => {
  const invalidGuids = [903496573054181376, null, '', '   ']

  for (const conversation_guid of invalidGuids) {
    const encoder = new TextEncoder()
    const response = new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'meta', conversation_guid })}\n\n`))
        controller.close()
      },
    }), { status: 200 })
    const meta = []
    await readPlatformChatStream(response, { onMeta: (event) => meta.push(event) })
    assert.deepEqual(meta, [{ conversationGuid: null }])
  }
})

test('401 SSE handling never forwards an upstream secret detail', async () => {
  const response = new Response(JSON.stringify({ detail: 'Authorization=Bearer secret prompt=private' }), { status: 401 })
  let unauthorizedArguments

  await readPlatformChatStream(response, {
    onUnauthorized: (...args) => { unauthorizedArguments = args },
  })

  assert.deepEqual(unauthorizedArguments, [])
})
