import assert from 'node:assert/strict'
import test from 'node:test'
import { applyPricingPresentation, canonicalPricingQuery, pricingAPIQuery, pricingQueryString } from './public-pricing-query.js'

test('canonicalizes every shareable pricing control and clamps unsafe values', () => {
  assert.deepEqual(canonicalPricingQuery({ search: [' x '], provider: 42, capability: ' chat ', endpoint: ' responses ', page: '-2', pageSize: '75', sort: 'cost', direction: 'sideways' }), {
    search: 'x', provider: '', capability: 'chat', endpoint: 'responses', page: 1, pageSize: 20, sort: 'default', direction: 'asc',
  })
  assert.deepEqual(canonicalPricingQuery({ page: '4', page_size: '100', sort: 'output', direction: 'desc' }), {
    search: '', provider: '', capability: '', endpoint: '', page: 4, pageSize: 100, sort: 'output', direction: 'desc',
  })
})

test('serializes a stable URL while sending only frozen backend query fields', () => {
  const query = canonicalPricingQuery({ search: 'a&b', provider: '智谱', capability: 'chat', endpoint: 'responses', page: 2, pageSize: 50, sort: 'input', direction: 'desc' })
  assert.equal(pricingQueryString(query), 'search=a%26b&provider=%E6%99%BA%E8%B0%B1&capability=chat&endpoint=responses&page=2&pageSize=50&sort=input&direction=desc')
  assert.deepEqual(pricingAPIQuery(query), { search: 'a&b', provider: '智谱', capability: 'chat', page: 2, pageSize: 50 })
})

test('sorts exact decimal strings numerically and keeps missing prices last', () => {
  const models = [
    { modelKey: 'missing', capabilities: ['chat'] },
    { modelKey: 'ten', capabilities: ['chat', 'responses'], inputPrice: '10.00000000', outputPrice: '2' },
    { modelKey: 'two', capabilities: ['responses'], inputPrice: '2.1', outputPrice: '11' },
  ]
  assert.deepEqual(applyPricingPresentation(models, { endpoint: 'responses', sort: 'input', direction: 'asc' }).map(x => x.modelKey), ['two', 'ten'])
  assert.deepEqual(applyPricingPresentation(models, { sort: 'output', direction: 'desc' }).map(x => x.modelKey), ['two', 'ten', 'missing'])
})

test('name sorting is stable and malformed presentation input fails closed', () => {
  const models = [{ modelKey: 'b', displayName: 'Zulu', capabilities: [] }, { modelKey: 'a', displayName: 'Alpha', capabilities: [] }]
  assert.deepEqual(applyPricingPresentation(models, { sort: 'name', direction: 'asc' }).map(x => x.modelKey), ['a', 'b'])
  assert.deepEqual(applyPricingPresentation(models, { sort: 'input', direction: 'asc' }).map(x => x.modelKey), ['a', 'b'])
})
