import test from 'node:test'
import assert from 'node:assert/strict'
import { parsePlatformEvent, readPlatformCompareStream } from './sse.js'

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
