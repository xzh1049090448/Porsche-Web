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
    parsePlatformEvent('model_error', '{"model":"model-b","error":{"message":"服务暂不可用"}}'),
    { kind: 'modelError', model: 'model-b', message: '服务暂不可用' }
  )
})

test('parsePlatformEvent keeps client errors generic and rejects untrusted event shapes', () => {
  assert.deepEqual(parsePlatformEvent('error', '{"error":{"message":"upstream secret"}}'), { kind: 'error', message: '请求失败' })
  assert.equal(parsePlatformEvent('chunk', '{"model":"","chunk":{}}'), null)
  assert.equal(parsePlatformEvent('unknown', '{}'), null)
})

test('readPlatformCompareStream preserves successful siblings when one model emits model_error', async () => {
  const encoder = new TextEncoder()
  const response = new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode('event: chunk\ndata: {"model":"a","chunk":{"choices":[{"delta":{"content":"A"}}]}}\n\nevent: model_error\ndata: {"model":"b","error":{"message":"服务暂不可用"}}\n\nevent: model_done\ndata: {"model":"a"}\n\ndata: [DONE]\n\n'))
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
