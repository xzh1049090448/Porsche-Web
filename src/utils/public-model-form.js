const DECIMAL = /^(0|[1-9][0-9]{0,11})(\.[0-9]{1,8})?$/
const CODE = /^[a-z][a-z0-9_-]{0,63}$/
const MODEL_KEY = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const fail = () => { throw new Error('invalid_public_model_form') }
const own = (value, key) => Object.hasOwn(value, key)
const text = (value, max, optional = false) => {
  if (typeof value !== 'string' || value !== value.trim() || (!optional && value === '') || [...value].length > max || /[\uD800-\uDFFF]/u.test(value)) fail()
  return value
}
const codes = value => {
  if (!Array.isArray(value) || value.length > 32 || new Set(value).size !== value.length || value.some(item => typeof item !== 'string' || !CODE.test(item))) fail()
  return [...value]
}
const decimal = value => {
  if (value === '' || value === null) return null
  if (typeof value !== 'string' || !DECIMAL.test(value)) fail()
  return value
}
const positive = value => { const number = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value; if (!Number.isSafeInteger(number) || number < 1) fail(); return number }
const optionalTime = value => value === '' || value === null ? null : positive(value)
const rejectUnsupported = input => {
  if (!input || typeof input !== 'object' || Array.isArray(input) || own(input,'perCallPrice') || own(input,'singleCallPrice') || (own(input,'currency') && input.currency !== 'USD') || (own(input,'unit') && input.unit !== 'million_tokens')) fail()
}

export function normalizePublicModelCreateForm(input) {
  rejectUnsupported(input)
  const upstream = text(input.upstreamModelId, 255)
  if (!MODEL_KEY.test(input.modelKey ?? '')) fail()
  const inputPrice = decimal(input.inputPrice), outputPrice = decimal(input.outputPrice)
  const priceSource=text(input.priceSource ?? '',255,true), priceReviewer=text(input.priceReviewer ?? '',128,true), priceEffectiveAt=optionalTime(input.priceEffectiveAt ?? null)
  if ((inputPrice !== null || outputPrice !== null) && (!priceSource || !priceReviewer || priceEffectiveAt === null)) fail()
  return {
    upstream_model_id: upstream, model_key: input.modelKey, display_name: text(input.displayName,128), provider:text(input.provider,128),
    capabilities: codes(input.capabilities), context_window: positive(input.contextWindow),
    input_price_usd_per_million_tokens: inputPrice, output_price_usd_per_million_tokens: outputPrice,
    public_display_group: text(input.publicDisplayGroup ?? '',128,true), endpoint_types:codes(input.endpointTypes ?? []), public_restrictions:codes(input.publicRestrictions ?? []),
    price_source:priceSource, price_reviewer:priceReviewer, price_effective_at:priceEffectiveAt,
  }
}

const UPDATE = new Map([['displayName',['display_name',v=>text(v,128)]],['provider',['provider',v=>text(v,128)]],['capabilities',['capabilities',codes]],['contextWindow',['context_window',positive]],['inputPrice',['input_price_usd_per_million_tokens',decimal]],['outputPrice',['output_price_usd_per_million_tokens',decimal]],['publicDisplayGroup',['public_display_group',v=>text(v,128,true)]],['endpointTypes',['endpoint_types',codes]],['publicRestrictions',['public_restrictions',codes]],['priceSource',['price_source',v=>text(v,255,true)]],['priceReviewer',['price_reviewer',v=>text(v,128,true)]],['priceEffectiveAt',['price_effective_at',optionalTime]]])
export function normalizePublicModelUpdateForm(input) {
  rejectUnsupported(input)
  if (own(input,'modelKey') || own(input,'upstreamModelId')) fail()
  const out = { expected_revision: positive(input.expectedRevision) }
  for (const key of Object.keys(input)) {
    if (key === 'expectedRevision') continue
    const rule = UPDATE.get(key); if (!rule) fail()
    out[rule[0]] = rule[1](input[key])
  }
  return out
}
