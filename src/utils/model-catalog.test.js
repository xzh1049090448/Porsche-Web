import test from 'node:test'
import assert from 'node:assert/strict'
import { catalogModels, chooseAvailableModel, chooseCompareModels } from './model-catalog.js'

test('catalogModels uses only server-authorized dynamic models', () => {
  const models = catalogModels({
    data: [
      { id: 'white-label-a', title: '白牌模型 A', description: '适合通用对话', owned_by: 'JieKou' },
      { id: 'white-label-b', max_tokens: 4096 },
    ],
    catalog_stale: true,
  })

  assert.deepEqual(models, [
    {
      id: 'white-label-a',
      name: '白牌模型 A',
      desc: '适合通用对话',
      vendor: 'JieKou',
      icon: 'W',
      type: 'chat',
      multimodal: false,
      maxTokens: undefined,
      contextWindow: undefined,
      inputTokenPricePerM: undefined,
      outputTokenPricePerM: undefined,
    },
    {
      id: 'white-label-b',
      name: 'white-label-b',
      desc: '',
      vendor: '',
      icon: 'W',
      type: 'chat',
      multimodal: false,
      maxTokens: 4096,
      contextWindow: undefined,
      inputTokenPricePerM: undefined,
      outputTokenPricePerM: undefined,
    },
  ])
})

test('catalogModels rejects malformed or duplicate model IDs from a response', () => {
  assert.deepEqual(catalogModels({ data: [{ id: 'ok' }, { id: 'ok' }, { id: '' }, null] }), [
    {
      id: 'ok', name: 'ok', desc: '', vendor: '', icon: 'O', type: 'chat', multimodal: false,
      maxTokens: undefined, contextWindow: undefined, inputTokenPricePerM: undefined, outputTokenPricePerM: undefined,
    },
  ])
})

test('selection helpers remove unavailable stored models and cap comparison at three', () => {
  const models = catalogModels({ data: [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }] })
  assert.equal(chooseAvailableModel('gone', models), 'a')
  assert.equal(chooseAvailableModel('c', models), 'c')
  assert.deepEqual(chooseCompareModels(['gone', 'd', 'b', 'a', 'c'], models), ['d', 'b', 'a'])
})
