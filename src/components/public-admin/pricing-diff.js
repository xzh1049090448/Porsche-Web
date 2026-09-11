const sorted = value => Array.isArray(value) ? [...value].sort() : []
export const canonicalPricingInstant = value => {if(value==null)return null;const date=new Date(value);return Number.isFinite(date.getTime())?date.toISOString():`invalid:${String(value)}`}

export const pricingBusinessFields = Object.freeze([
  Object.freeze({ key: 'modelKey', draft: 'model_key', live: 'modelKey' }),
  Object.freeze({ key: 'displayName', draft: 'display_name', live: 'displayName' }),
  Object.freeze({ key: 'provider', draft: 'provider', live: 'provider' }),
  Object.freeze({ key: 'capabilities', draft: 'capabilities', live: 'capabilities', array: true }),
  Object.freeze({ key: 'contextWindow', draft: 'context_window', live: 'contextWindow' }),
  Object.freeze({ key: 'publicDisplayGroup', draft: 'public_display_group', live: 'publicDisplayGroup' }),
  Object.freeze({ key: 'endpointTypes', draft: 'endpoint_types', live: 'endpointTypes', array: true }),
  Object.freeze({ key: 'publicRestrictions', draft: 'public_restrictions', live: 'publicRestrictions', array: true }),
  Object.freeze({ key: 'inputPriceUsdPerMillionTokens', draft: 'input_price_usd_per_million_tokens', live: 'inputPriceUsdPerMillionTokens' }),
  Object.freeze({ key: 'outputPriceUsdPerMillionTokens', draft: 'output_price_usd_per_million_tokens', live: 'outputPriceUsdPerMillionTokens' }),
  Object.freeze({ key: 'priceSource', draft: 'price_source', live: 'priceSource' }),
  Object.freeze({ key: 'priceReviewer', draft: 'price_reviewer', live: 'priceReviewer' }),
  Object.freeze({ key: 'priceEffectiveAt', draft: 'price_effective_at', live: 'effectiveAt', instant: true }),
])

function included(side, model) {
  if (!model) return false
  return side === 'draft' ? model.status === 'active' : model.priceVisibility === 'visible'
}

function projection(side, model) {
  const isIncluded = included(side, model)
  if (!isIncluded) return Object.freeze({ included: false })
  const projected = { included: true }
  for (const field of pricingBusinessFields) {
    const value = model[field[side]]
    projected[field.key] = field.array ? sorted(value) : field.instant ? canonicalPricingInstant(value) : value
  }
  return Object.freeze(projected)
}

const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b)

export function buildPricingDiff(draft, live) {
  const drafts = new Map((draft?.models ?? []).map(model => [model.model_key, model]))
  const lives = new Map((live?.items ?? []).map(model => [model.modelKey, model]))
  return [...new Set([...drafts.keys(), ...lives.keys()])].sort().map(modelKey => {
    const draftModel = drafts.get(modelKey)
    const liveModel = lives.get(modelKey)
    const draftProjection = projection('draft', draftModel)
    const liveProjection = projection('live', liveModel)
    let lifecycle = draftProjection.included || liveProjection.included ? 'present' : 'excluded'
    if (liveProjection.included && !draftProjection.included) lifecycle = draftModel?.status === 'inactive' ? 'inactivated' : 'removed'
    else if (!liveProjection.included && draftProjection.included) lifecycle = 'added'
    return Object.freeze({
      modelKey,
      draftModel,
      liveModel,
      draft: draftProjection,
      live: liveProjection,
      lifecycle,
      changed: !equal(draftProjection, liveProjection),
    })
  })
}
