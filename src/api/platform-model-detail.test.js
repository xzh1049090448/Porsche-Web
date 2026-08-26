import test from 'node:test'
import assert from 'node:assert/strict'
import { getPlatformModelDetail } from './platform-model-detail.js'

test('getPlatformModelDetail sends slash-qualified IDs once through the detail query endpoint', async () => {
  const calls = []
  const request = {
    async get(url) {
      calls.push(url)
      return { id: 'zai-org/glm-5.1', title: 'GLM 5.1' }
    },
  }
  const mapCatalog = (payload) => payload.data.map((model) => ({ id: model.id, name: model.title }))

  const model = await getPlatformModelDetail('zai-org/glm-5.1', request, mapCatalog)

  assert.deepEqual(calls, ['/api/v1/platform/models/detail?id=zai-org%2Fglm-5.1'])
  assert.deepEqual(model, { id: 'zai-org/glm-5.1', name: 'GLM 5.1' })
})

test('getPlatformModelDetail rejects invalid IDs before making an HTTP request', async () => {
  const calls = []
  const request = {
    async get(url) {
      calls.push(url)
      return { id: 'unexpected' }
    },
  }
  const mapCatalog = (payload) => payload.data

  for (const id of [
    null,
    undefined,
    42,
    '',
    '   ',
    '../model',
    'a?b',
    'a%2Fb',
    'a\\b',
    'model name',
    'model\nname',
    '/leading',
    'trailing/',
    'double//slash',
    './model',
    'org/../model',
    'org/./model',
    'org/\u200Emodel',
    ' leading',
    'trailing ',
    'a'.repeat(257),
  ]) {
    assert.equal(await getPlatformModelDetail(id, request, mapCatalog), null)
  }
  assert.deepEqual(calls, [])
})

test('getPlatformModelDetail preserves safe opaque model IDs without normalization', async () => {
  const calls = []
  const request = {
    async get(url) {
      calls.push(url)
      return { id: 'vendor/model.v1-β' }
    },
  }

  const model = await getPlatformModelDetail('vendor/model.v1-β', request, (payload) => payload.data)

  assert.deepEqual(calls, ['/api/v1/platform/models/detail?id=vendor%2Fmodel.v1-%CE%B2'])
  assert.deepEqual(model, { id: 'vendor/model.v1-β' })
})
