import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizePublicModelCreateForm, normalizePublicModelUpdateForm } from './public-model-form.js'

const valid = { upstreamModelId:'up/model', modelKey:'model-key', displayName:'Model', provider:'Provider', capabilities:['chat'], contextWindow:'128000', inputPrice:'1.25000000', outputPrice:'', publicDisplayGroup:'general', endpointTypes:['chat'], publicRestrictions:[], priceSource:'catalog', priceReviewer:'root', priceEffectiveAt:'1720000000000' }

test('create preserves decimal strings, converts missing component to null and includes provenance', () => {
  assert.deepEqual(normalizePublicModelCreateForm(valid,{recentlyObservedIds:new Set(['up/model'])}), { upstream_model_id:'up/model', model_key:'model-key', display_name:'Model', provider:'Provider', capabilities:['chat'], context_window:128000, input_price_usd_per_million_tokens:'1.25000000', output_price_usd_per_million_tokens:null, public_display_group:'general', endpoint_types:['chat'], public_restrictions:[], price_source:'catalog', price_reviewer:'root', price_effective_at:1720000000000 })
})
test('create must come from an observed upstream id and rejects unsupported prices/currency', () => {
  const context={recentlyObservedIds:new Set(['up/model'])}
  for (const change of [{upstreamModelId:''},{upstreamModelId:'other/model'},{inputPrice:'01'},{outputPrice:'1.123456789'},{perCallPrice:'1'},{currency:'CNY'},{unit:'token'},{priceSource:''},{priceReviewer:''},{priceEffectiveAt:null},{modelKey:'model-'},{modelKey:'model--key'},{publicDisplayGroup:'General'},{displayName:'bad\u200bname'}]) assert.throws(() => normalizePublicModelCreateForm({...valid,...change},context), /invalid_public_model_form/)
  for(const upstreamModelId of ['org//model','org/./model','org/../model',' org/model','org/model ','org\\model','org/model?x','org/model#x','org/model%2Fx','org/\u200bmodel']) assert.throws(()=>normalizePublicModelCreateForm({...valid,upstreamModelId},{recentlyObservedIds:new Set([upstreamModelId])}),/invalid_public_model_form/)
})
test('update is sparse, immutable identities are forbidden and revision is required', () => {
  const current={inputPriceUsdPerMillionTokens:'1',outputPriceUsdPerMillionTokens:null,priceSource:'catalog',priceReviewer:'root',priceEffectiveAt:1}
  assert.deepEqual(normalizePublicModelUpdateForm({ expectedRevision:3, inputPrice:null, displayName:'New' },{current}), { expected_revision:3, input_price_usd_per_million_tokens:null, display_name:'New' })
  assert.throws(() => normalizePublicModelUpdateForm({ expectedRevision:3, modelKey:'changed' },{current}), /invalid_public_model_form/)
  assert.throws(() => normalizePublicModelUpdateForm({ expectedRevision:0 },{current}), /invalid_public_model_form/)
  for(const change of [{priceSource:''},{priceReviewer:''},{priceEffectiveAt:null}]) assert.throws(()=>normalizePublicModelUpdateForm({expectedRevision:3,...change},{current}),/invalid_public_model_form/)
  assert.deepEqual(normalizePublicModelUpdateForm({expectedRevision:3,priceSource:''},{current:{...current,inputPriceUsdPerMillionTokens:null}}),{expected_revision:3,price_source:''})
})
