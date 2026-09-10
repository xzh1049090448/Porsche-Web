import test from 'node:test'
import assert from 'node:assert/strict'
import { mapPublicModel, mapPublicModelList, formatPublicPrice, sortPublicModels, filterPublicModels, PUBLIC_PRICE_DISCLAIMER } from './public-catalog.js'

const metadata = { pricing_type: 'token', endpoint_types: ['chat.completions'], updated_at: '2026-09-10T00:00:00Z' }
const visible = (overrides = {}) => ({ model_key: 'stable-key', display_name: 'Model', provider: 'Acme', capabilities: ['chat'], context_window: 128000, input_price_usd_per_million_tokens: '0.00000001', output_price_usd_per_million_tokens: '999999999999.99999999', price_visibility: 'visible', release_version: 7, ...metadata, ...overrides })

test('projects only exact safe model fields and retains decimal strings', () => {
  const model = mapPublicModel(visible())
  assert.deepEqual(model, { modelKey: 'stable-key', displayName: 'Model', provider: 'Acme', capabilities: ['chat'], contextWindow: 128000, inputPrice: '0.00000001', outputPrice: '999999999999.99999999', priceVisibility: 'visible', releaseVersion: 7, pricingType: 'token', endpointTypes: ['chat.completions'], updatedAt: '2026-09-10T00:00:00Z' })
  assert.equal(typeof model.outputPrice, 'string')
})

test('rejects forbidden, malformed, mixed visibility and mixed generation DTOs', () => {
  for (const raw of [visible({ guid: '1' }), visible({ upstream_model_id: 'secret' }), visible({ route: '/internal' }), visible({ input_price_usd_per_million_tokens: 1 }), visible({ model_key: 'a/b' }), visible({ price_visibility: 'authenticated_only' })]) assert.throws(() => mapPublicModel(raw), /invalid_public_model/)
  assert.throws(() => mapPublicModelList({ items: [visible(), visible({ model_key: 'other', release_version: 8 })], page: 1, page_size: 20, total: 2, release_version: 7 }), /mixed_publication_generation/)
})

test('redacted and missing prices are omitted and never labelled free', () => {
  const redacted = mapPublicModel({ model_key: 'redacted', display_name: 'Hidden', provider: 'Acme', capabilities: [], context_window: 1, price_visibility: 'authenticated_only', release_version: 7, ...metadata })
  assert.equal('inputPrice' in redacted, false)
  assert.deepEqual(formatPublicPrice(undefined), { state: 'missing', label: '价格未发布' })
  assert.equal(PUBLIC_PRICE_DISCLAIMER, '价格仅供参考，不代表自动计费或最终账单。')
})

test('filters safely and sorts comparable prices with missing prices last', () => {
  const models = [mapPublicModel(visible({ model_key: 'b', provider: 'B', input_price_usd_per_million_tokens: '10' })), mapPublicModel(visible({ model_key: 'a', provider: 'A', input_price_usd_per_million_tokens: '2' })), mapPublicModel({ model_key: 'c', display_name: 'C', provider: 'A', capabilities: ['image'], context_window: 1, price_visibility: 'authenticated_only', release_version: 7, ...metadata })]
  assert.deepEqual(filterPublicModels(models, { provider: 'A' }).map(x => x.modelKey), ['a', 'c'])
  assert.deepEqual(sortPublicModels(models, 'input', 'asc').map(x => x.modelKey), ['a', 'b', 'c'])
  assert.throws(() => sortPublicModels(models, 'input', 'asc', { currency: 'EUR' }), /incomparable_price_units/)
})
