import test from 'node:test'
import assert from 'node:assert/strict'
import { mapPublicModel, mapPublicModelList, formatPublicPrice, sortPublicModels, filterPublicModels, PUBLIC_PRICE_DISCLAIMER } from './public-catalog.js'

const metadata = { pricing_type: 'token', endpoint_types: ['chat.completions'], price_source: 'upstream', price_reviewer: 'root', effective_at: '2026-09-10T00:00:00Z', updated_at: '2026-09-10T00:00:00Z' }
const facets = { providers: ['Acme'], capabilities: ['chat'], endpoint_types: ['chat.completions'], public_display_groups: ['featured'] }
const visible = (overrides = {}) => ({ model_key: 'stable-key', display_name: 'Model', provider: 'Acme', capabilities: ['chat'], context_window: 128000, input_price_usd_per_million_tokens: '0.00000001', output_price_usd_per_million_tokens: '999999999999.99999999', price_visibility: 'visible', release_version: 7, ...metadata, ...overrides })

test('projects only exact safe model fields and retains decimal strings', () => {
  const model = mapPublicModel(visible())
  assert.deepEqual(model, { modelKey: 'stable-key', displayName: 'Model', provider: 'Acme', capabilities: ['chat'], contextWindow: 128000, inputPrice: '0.00000001', outputPrice: '999999999999.99999999', priceVisibility: 'visible', releaseVersion: 7, pricingType: 'token', endpointTypes: ['chat.completions'], priceSource: 'upstream', priceReviewer: 'root', effectiveAt: '2026-09-10T00:00:00Z', updatedAt: '2026-09-10T00:00:00Z' })
  assert.equal(typeof model.outputPrice, 'string')
})

test('timestamps require semantically valid RFC3339 UTC values', () => {
  for (const updated_at of ['2026-09-10 00:00:00Z', '2026-02-30T00:00:00Z', '2026-09-10T24:00:00Z', '2026-09-10T00:00:00+00:00']) {
    assert.throws(() => mapPublicModel(visible({ updated_at })), /invalid_public_model/)
  }
  assert.equal(mapPublicModel(visible({ updated_at: '2024-02-29T23:59:59.123456789Z', effective_at: '2026-09-10T00:00:00Z' })).effectiveAt, '2026-09-10T00:00:00Z')
})

test('rejects forbidden, malformed, mixed visibility and mixed generation DTOs', () => {
  for (const raw of [visible({ guid: '1' }), visible({ upstream_model_id: 'secret' }), visible({ route: '/internal' }), visible({ input_price_usd_per_million_tokens: 1 }), visible({ model_key: 'a/b' }), visible({ price_visibility: 'authenticated_only' })]) assert.throws(() => mapPublicModel(raw), /invalid_public_model/)
  assert.throws(() => mapPublicModelList({ items: [visible(), visible({ model_key: 'other', release_version: 8 })], page: 1, page_size: 20, total: 2, release_version: 7, facets }), /mixed_publication_generation/)
})

test('list projects exact global sorted facets independent from its current page', () => {
  assert.deepEqual(mapPublicModelList({ items: [], page: 2, page_size: 20, total: 25, release_version: 7, facets }), { items: [], page: 2, pageSize: 20, total: 25, releaseVersion: 7, facets: { providers: ['Acme'], capabilities: ['chat'], endpointTypes: ['chat.completions'], publicDisplayGroups: ['featured'] } })
  for (const invalid of [{ ...facets, providers: ['B', 'A'] }, { ...facets, capabilities: ['chat', 'chat'] }, { ...facets, endpoint_types: [1] }, { ...facets, extra: [] }]) assert.throws(() => mapPublicModelList({ items: [], page: 1, page_size: 20, total: 0, release_version: 7, facets: invalid }), /invalid_public_model_list/)
})

test('redacted and missing prices are omitted and never labelled free', () => {
  const redacted = mapPublicModel({ model_key: 'redacted', display_name: 'Hidden', provider: 'Acme', capabilities: [], context_window: 1, price_visibility: 'authenticated_only', release_version: 7, ...metadata })
  assert.equal('inputPrice' in redacted, false)
  assert.deepEqual(formatPublicPrice(undefined), { state: 'missing', label: '价格未发布' })
  assert.equal(PUBLIC_PRICE_DISCLAIMER, '价格仅供参考，不代表自动计费或最终账单。')
  const missingOutput = mapPublicModel(visible({ output_price_usd_per_million_tokens: undefined }))
  assert.equal(missingOutput.inputPrice, '0.00000001'); assert.equal('outputPrice' in missingOutput, false)
})

test('any present price component requires complete nonblank valid provenance', () => {
  for (const overrides of [
    { price_source: undefined }, { price_source: '' }, { price_reviewer: undefined }, { price_reviewer: '  ' },
    { effective_at: undefined }, { effective_at: '2026-02-30T00:00:00Z' },
  ]) assert.throws(() => mapPublicModel(visible(overrides)), /invalid_public_model/)
  const unpriced = visible({ input_price_usd_per_million_tokens: undefined, output_price_usd_per_million_tokens: undefined, price_source: undefined, price_reviewer: undefined, effective_at: undefined })
  assert.doesNotThrow(() => mapPublicModel(unpriced))
  assert.throws(() => mapPublicModelList({ items: [visible({ price_reviewer: '' })], page: 1, page_size: 20, total: 1, release_version: 7, facets }), /invalid_public_model/)
})

test('filters safely and sorts comparable prices with missing prices last', () => {
  const models = [mapPublicModel(visible({ model_key: 'b', provider: 'B', input_price_usd_per_million_tokens: '10' })), mapPublicModel(visible({ model_key: 'a', provider: 'A', input_price_usd_per_million_tokens: '2' })), mapPublicModel({ model_key: 'c', display_name: 'C', provider: 'A', capabilities: ['image'], context_window: 1, price_visibility: 'authenticated_only', release_version: 7, ...metadata })]
  assert.deepEqual(filterPublicModels(models, { provider: 'A' }).map(x => x.modelKey), ['a', 'c'])
  assert.deepEqual(sortPublicModels(models, 'input', 'asc').map(x => x.modelKey), ['a', 'b', 'c'])
  assert.throws(() => sortPublicModels(models, 'input', 'asc', { currency: 'EUR' }), /incomparable_price_units/)
})
