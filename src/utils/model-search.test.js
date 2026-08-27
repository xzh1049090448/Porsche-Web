import assert from 'node:assert/strict'
import test from 'node:test'
import { filterModels } from './model-search.js'

const models = [
  {
    id: 'zai-org/glm-5.1',
    name: 'GLM 5.1',
    vendor: 'ZAI',
    desc: 'General chat',
  },
  {
    id: 'deepseek/deepseek-v4-pro',
    name: 'DeepSeek V4 Pro',
    vendor: 'DeepSeek',
    desc: 'Reasoning model',
  },
]

test('filterModels matches every searchable field case-insensitively', () => {
  assert.deepEqual(filterModels(models, 'glm').map((model) => model.id), ['zai-org/glm-5.1'])
  assert.deepEqual(filterModels(models, 'V4-PRO').map((model) => model.id), ['deepseek/deepseek-v4-pro'])
  assert.deepEqual(filterModels(models, 'zai').map((model) => model.id), ['zai-org/glm-5.1'])
  assert.deepEqual(filterModels(models, 'reasoning').map((model) => model.id), ['deepseek/deepseek-v4-pro'])
  assert.deepEqual(filterModels(models, '推理').map((model) => model.id), [])
})

test('filterModels copies all models for a blank query without mutation', () => {
  const original = structuredClone(models)
  const result = filterModels(models, '  ')

  assert.deepEqual(result, models)
  assert.notEqual(result, models)
  assert.deepEqual(models, original)
})

test('filterModels safely handles missing fields, invalid lists, and no matches', () => {
  const incompleteModels = [{ id: 'only-id' }, null, { name: '可搜索模型' }]

  assert.deepEqual(filterModels(incompleteModels, 'only').map((model) => model?.id), ['only-id'])
  assert.deepEqual(filterModels(incompleteModels, '不存在'), [])
  assert.deepEqual(filterModels(null, 'anything'), [])
})
