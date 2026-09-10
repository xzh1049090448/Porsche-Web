import test from 'node:test'
import assert from 'node:assert/strict'
import { buildPricingDiff } from './pricing-diff.js'

const draftModel = (overrides = {}) => ({
  model_key: 'glm-4', display_name: 'GLM 4', provider: 'zhipu', capabilities: ['text', 'vision'],
  context_window: 128000, status: 'active', public_display_group: 'chat', endpoint_types: ['responses', 'chat'],
  public_restrictions: ['cn'], input_price_usd_per_million_tokens: '1.00', output_price_usd_per_million_tokens: '2.00',
  price_source: 'upstream', price_reviewer: 'root', price_effective_at: Date.parse('2026-09-10T00:00:00Z'),
  last_upstream_check_at: 1789000000000, ...overrides,
})
const liveModel = (overrides = {}) => ({
  modelKey: 'glm-4', displayName: 'GLM 4', provider: 'zhipu', capabilities: ['vision', 'text'],
  contextWindow: 128000, publicDisplayGroup: 'chat', endpointTypes: ['chat', 'responses'], publicRestrictions: ['cn'],
  inputPriceUsdPerMillionTokens: '1.00', outputPriceUsdPerMillionTokens: '2.00', priceSource: 'upstream',
  priceReviewer: 'root', effectiveAt: '2026-09-10T00:00:00.000Z', priceVisibility: 'visible',
  releaseVersion: 9, updatedAt: '2026-09-11T00:00:00Z', ...overrides,
})
const diff = (drafts, lives) => buildPricingDiff({ models: drafts }, { items: lives })

test('equivalent publishable rows are unchanged across array order and epoch/RFC3339 time', () => {
  const [row] = diff([draftModel()], [liveModel()])
  assert.equal(row.changed, false)
  assert.equal(row.draft.included, true)
  assert.equal(row.live.included, true)
})

test('candidate lifecycle compares active inclusion against live presence and visibility', () => {
  const inactive = diff([draftModel({ status: 'inactive' })], [liveModel()])[0]
  const added = diff([draftModel({ model_key: 'new' })], [])[0]
  const removed = diff([], [liveModel({ modelKey: 'old' })])[0]
  assert.deepEqual([inactive.changed, inactive.lifecycle], [true, 'inactivated'])
  assert.deepEqual([added.changed, added.lifecycle], [true, 'added'])
  assert.deepEqual([removed.changed, removed.lifecycle], [true, 'removed'])
})

test('all publishable business fields participate while operational metadata cannot create a change', () => {
  for (const override of [
    { displayName: 'Different' }, { provider: 'other' }, { capabilities: ['text'] }, { contextWindow: 64000 },
    { publicDisplayGroup: 'image' }, { endpointTypes: ['chat'] }, { publicRestrictions: [] },
    { inputPriceUsdPerMillionTokens: '1.01' }, { outputPriceUsdPerMillionTokens: '2.01' },
    { priceSource: 'manual' }, { priceReviewer: 'other' }, { effectiveAt: '2026-09-12T00:00:00Z' },
  ]) assert.equal(diff([draftModel()], [liveModel(override)])[0].changed, true, JSON.stringify(override))
  assert.equal(diff([draftModel({ last_upstream_check_at: 1 })], [liveModel({ releaseVersion: 99, updatedAt: '2027-01-01T00:00:00Z' })])[0].changed, false)
})

test('diff is a deterministic full union including excluded draft-only records', () => {
  const rows = diff([draftModel({ model_key: 'z', status: 'draft' }), draftModel({ model_key: 'a' })], [liveModel({ modelKey: 'm' })])
  assert.deepEqual(rows.map(row => row.modelKey), ['a', 'm', 'z'])
  assert.equal(rows.find(row => row.modelKey === 'z').changed, false)
})

test('defensive diff formatting never throws on invalid dates', () => {
 assert.doesNotThrow(()=>diff([draftModel({price_effective_at:Number.NaN})],[liveModel({effectiveAt:'2026-99-99T99:99:99Z'})]))
})
