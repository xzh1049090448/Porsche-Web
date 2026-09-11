const DECIMAL = /^(0|[1-9][0-9]{0,11})(\.[0-9]{1,8})?$/
const CODE = /^[a-z][a-z0-9_-]{0,63}$/
const MODEL_KEY = /^[a-z][a-z0-9-]{0,127}$/
const UNSAFE_UNICODE = /[\p{Cc}\p{Cf}]/u
const CREATE_KEYS = new Set(['upstreamModelId','modelKey','displayName','provider','capabilities','contextWindow','inputPrice','outputPrice','publicDisplayGroup','endpointTypes','publicRestrictions','priceSource','priceReviewer','priceEffectiveAt','currency','unit'])
const fail = () => { throw new Error('invalid_public_model_form') }
const own = (value, key) => Object.hasOwn(value, key)
const text = (value, max, optional = false) => {
  if (typeof value !== 'string' || value !== value.trim() || (!optional && value === '') || [...value].length > max || /[\uD800-\uDFFF]/u.test(value) || UNSAFE_UNICODE.test(value)) fail()
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
const validModelKey = value => typeof value === 'string' && MODEL_KEY.test(value) && !value.endsWith('-') && !value.includes('--')
const validUpstreamID = value => typeof value === 'string' && value.length <= 255 && value === value.trim() && value.split('/').every(segment => segment && segment !== '.' && segment !== '..' && !/[\\?#%\s]/u.test(segment) && !UNSAFE_UNICODE.test(segment))
const observedHas = (observed, id) => observed instanceof Set ? observed.has(id) : Array.isArray(observed) && observed.includes(id)

export function normalizePublicModelCreateForm(input, { recentlyObservedIds } = {}) {
  rejectUnsupported(input)
  if(Object.keys(input).some(key=>!CREATE_KEYS.has(key)))fail()
  const upstream = text(input.upstreamModelId, 255)
  if (!validUpstreamID(upstream) || !observedHas(recentlyObservedIds, upstream) || !validModelKey(input.modelKey)) fail()
  const inputPrice = decimal(input.inputPrice), outputPrice = decimal(input.outputPrice)
  const priceSource=text(input.priceSource ?? '',255,true), priceReviewer=text(input.priceReviewer ?? '',128,true), priceEffectiveAt=optionalTime(input.priceEffectiveAt ?? null)
  const publicDisplayGroup=input.publicDisplayGroup ?? ''; if(publicDisplayGroup!==''&&!CODE.test(publicDisplayGroup))fail()
  if ((inputPrice !== null || outputPrice !== null) && (!priceSource || !priceReviewer || priceEffectiveAt === null)) fail()
  return {
    upstream_model_id: upstream, model_key: input.modelKey, display_name: text(input.displayName,128), provider:text(input.provider,128),
    capabilities: codes(input.capabilities), context_window: positive(input.contextWindow),
    input_price_usd_per_million_tokens: inputPrice, output_price_usd_per_million_tokens: outputPrice,
    public_display_group: publicDisplayGroup, endpoint_types:codes(input.endpointTypes ?? []), public_restrictions:codes(input.publicRestrictions ?? []),
    price_source:priceSource, price_reviewer:priceReviewer, price_effective_at:priceEffectiveAt,
  }
}

const UPDATE = new Map([['displayName',['display_name',v=>text(v,128)]],['provider',['provider',v=>text(v,128)]],['capabilities',['capabilities',codes]],['contextWindow',['context_window',positive]],['inputPrice',['input_price_usd_per_million_tokens',decimal]],['outputPrice',['output_price_usd_per_million_tokens',decimal]],['publicDisplayGroup',['public_display_group',v=>{if(v!==''&&(!CODE.test(v)||[...v].length>128))fail();return v}]],['endpointTypes',['endpoint_types',codes]],['publicRestrictions',['public_restrictions',codes]],['priceSource',['price_source',v=>text(v,255,true)]],['priceReviewer',['price_reviewer',v=>text(v,128,true)]],['priceEffectiveAt',['price_effective_at',optionalTime]]])
export function normalizePublicModelUpdateForm(input, { current } = {}) {
  rejectUnsupported(input)
  if (!current || typeof current !== 'object' || Array.isArray(current)) fail()
  if (own(input,'modelKey') || own(input,'upstreamModelId')) fail()
  const out = { expected_revision: positive(input.expectedRevision) }
  for (const key of Object.keys(input)) {
    if (key === 'expectedRevision') continue
    const rule = UPDATE.get(key); if (!rule) fail()
    out[rule[0]] = rule[1](input[key])
  }
  const merged = {
    inputPrice: own(out,'input_price_usd_per_million_tokens') ? out.input_price_usd_per_million_tokens : current.inputPriceUsdPerMillionTokens,
    outputPrice: own(out,'output_price_usd_per_million_tokens') ? out.output_price_usd_per_million_tokens : current.outputPriceUsdPerMillionTokens,
    priceSource: own(out,'price_source') ? out.price_source : current.priceSource,
    priceReviewer: own(out,'price_reviewer') ? out.price_reviewer : current.priceReviewer,
    priceEffectiveAt: own(out,'price_effective_at') ? out.price_effective_at : current.priceEffectiveAt,
  }
  if ((merged.inputPrice !== null || merged.outputPrice !== null) && (!merged.priceSource || !merged.priceReviewer || merged.priceEffectiveAt == null)) fail()
  return out
}
