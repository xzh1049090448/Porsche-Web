import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { baseParse } from '@vue/compiler-dom'
import { parse as parseSfc } from '@vue/compiler-sfc'
import postcss from 'postcss'
import { messages } from '../../i18n/messages.js'
import { publicText } from '../../i18n/public-runtime.js'
import { formatPublicPrice, mapPublicModel, PUBLIC_PRICING } from '../../utils/public-catalog.js'
import { publicPriceState } from '../../utils/public-pricing-query.js'

const read = path => readFile(new URL(path, import.meta.url), 'utf8')
const styleRoot = (source, sfc = false) => postcss.parse(sfc ? parseSfc(source).descriptor.styles.map(style => style.content).join('\n') : source)
const templateAst = source => baseParse(parseSfc(source).descriptor.template?.content || '')
const visibleStrings = source => {
  const values = []
  const visibleAttributes = new Set(['alt', 'aria-label', 'placeholder', 'title'])
  const visit = node => {
    if (node.type === 2 && node.content.trim()) values.push(node.content.trim())
    if (node.type === 5) values.push(node.content.content)
    if (node.type === 1) for (const prop of node.props) {
      if (prop.type === 6 && visibleAttributes.has(prop.name) && prop.value?.content) values.push(prop.value.content)
    }
    for (const child of node.children || []) visit(child)
  }
  visit(templateAst(source))
  return values
}
const stringValues = value => {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.flatMap(stringValues)
  if (value && typeof value === 'object') return Object.values(value).flatMap(stringValues)
  return []
}
const mediaAncestors = rule => {
  const media = []
  for (let parent = rule.parent; parent; parent = parent.parent) if (parent.type === 'atrule' && parent.name.toLowerCase() === 'media') media.push(parent.params)
  return media
}
const exactRules = (root, selector, context = 'base') => {
  const matches = []
  root.walkRules(rule => {
    if (!rule.selectors?.map(value => value.trim()).includes(selector)) return
    const media = mediaAncestors(rule)
    if (context === 'all' || (context === 'base' && media.length === 0) || (context instanceof RegExp && media.some(value => context.test(value)))) matches.push(rule)
  })
  return matches
}
const normalizeCssValue = value => value.replace(/\s+/g, ' ').replace(/\s*,\s*/g, ', ').trim()
const propertyMap = rules => {
  const result = new Map()
  for (const rule of rules) for (const node of rule.nodes) if (node.type === 'decl') {
    const key = node.prop.toLowerCase()
    if (!result.has(key)) result.set(key, [])
    result.get(key).push(normalizeCssValue(node.value))
  }
  return result
}
const assertProperty = (root, selector, property, expected, message, context = 'base') => {
  const actual = propertyMap(exactRules(root, selector, context)).get(property) || []
  assert.ok(actual.includes(expected), `${message}; found ${JSON.stringify(actual)}`)
}
const controlValueIsAtLeast44 = value => value === 'var(--control-min-size)' || (/^\d+(?:\.\d+)?px$/.test(value) && Number.parseFloat(value) >= 44)
const assertControlSize = (root, selector, properties, context = 'all') => {
  const rules = exactRules(root, selector, context)
  assert.ok(rules.length > 0, `${selector} must have an exact rule`)
  const declarations = propertyMap(rules)
  for (const property of properties) {
    const values = declarations.get(property) || []
    assert.ok(values.length > 0, `${selector} must declare ${property}`)
    assert.equal(values.every(controlValueIsAtLeast44), true, `${selector} ${property} must stay at least 44px`)
  }
}
const stripSafePerRequestCopy = value => value
  .replace(/每次请求不单独计价/g, '')
  .replace(/\bper[- ]request pricing is not offered\b/gi, '')
const prototypePatterns = [
  [/ModelHub/i, 'prototype product name'],
  [/40\+|\b\d+\+?\s*(?:个\s*)?(?:模型|供应商)|\b\d+\+?\s*(?:models?|providers?)\b/i, 'hard-coded prototype model or provider count'],
  [/100%/i, 'prototype percentage claim'],
  [/MIT License/i, 'prototype license claim'],
  [/Tailwind\s+CDN/i, 'Tailwind CDN claim'],
  [/\d+(?:\.\d+)?\s*(?:x|×|倍)(?![\w-])/i, 'prototype multiplier'],
  [/(?:单次调用价|每次请求(?:价格|价)|每请求(?:价格|价)|per[- ]request\s+(?:price|pricing)|(?:[$¥￥]\s*\d+(?:\.\d+)?|\d+(?:\.\d+)?\s*(?:USD|CNY))\s*\/\s*request\b)/i, 'per-request price'],
  [/(?:admin|demo)(?:@[^\s<"']+)?\s*(?:\/|:|：)\s*(?:admin|password|123456)/i, 'demo credentials'],
  [/\b(?:admin|demo)@[A-Z0-9._%+-]+\.[A-Z]{2,}\b/i, 'demo account email'],
  [/(?:password|密码)\s*[:=：]\s*["']?(?:admin\d*|demo\d*|123456(?:78)?)/i, 'demo password'],
  [/(?:API[_ -]?KEY\s*[=:]\s*["']?(?:sk-)?[A-Za-z0-9_-]{8,}|sk-[A-Za-z0-9_-]{8,})/i, 'hard-coded API credential'],
]

test('pricing routes load real lazy pages and preserve encoded stable modelKey', async () => {
  const [router, main] = await Promise.all([read('../../router/index.js'), read('../../main.js')])
  assert.match(router, /PublicPricing['"],?\s*component:\s*\(\)\s*=>\s*import\(['"]@\/views\/public\/Pricing\.vue['"]\)/)
  assert.match(router, /PublicPricingDetail['"],?\s*component:\s*\(\)\s*=>\s*import\(['"]@\/views\/public\/ModelPricingDetail\.vue['"]\)/)
  assert.match(await read('../../components/public/PricingTable.vue'), /encodeURIComponent\(model\.modelKey\)/)
  assert.match(main, /mountPublicApp:[\s\S]*createPinia\(\)/)
})

test('catalog exposes desktop filters/table, mobile drawer/cards and accessible controls', async () => {
  const [page, filters, table, cards, styles] = await Promise.all([read('./Pricing.vue'), read('../../components/public/PricingFilters.vue'), read('../../components/public/PricingTable.vue'), read('../../components/public/PricingCards.vue'), read('../../styles/public-pricing.scss')])
  const pricingCss = styleRoot(styles)
  const filterCss = styleRoot(filters, true)
  const tableCss = styleRoot(table, true)
  const cardsCss = styleRoot(cards, true)
  assert.match(page, /@\/styles\/public-pricing\.scss/)
  assertProperty(pricingCss, '.pricing-page', 'max-width', '1600px', 'pricing page keeps its desktop width')
  assertProperty(pricingCss, '.pricing-layout', 'grid-template-columns', '260px minmax(0, 1fr)', 'pricing layout keeps the approved sidebar grid')
  assert.match(page, /PricingFilters/); assert.match(page, /PricingTable/); assert.match(page, /PricingCards/)
  for (const className of ['pricing-layout', 'pricing-sidebar', 'pricing-toolbar', 'pricing-results-count']) assert.match(page, new RegExp(`class\\s*=\\s*(["'])[^"']*\\b${className}\\b[^"']*\\1`))
  assert.match(page, /role\s*=\s*(["'])dialog\1/); assert.match(page, /aria-modal\s*=\s*(["'])true\1/)
  assert.match(page, /aria-controls\s*=\s*(["'])pricing-filter-drawer\1/); assert.match(page, /:aria-expanded\s*=\s*(["'])drawerOpen\1/)
  for (const field of ['search', 'provider', 'capability', 'endpoint', 'group', 'sort']) assert.match(filters, new RegExp(`name\\s*=\\s*(["'])${field}\\1`))
  assert.match(table, /publicPriceState/); assert.match(cards, /publicPriceState/)
  assert.match(table, /pricingCatalog\.inputPrice/); assert.match(table, /pricingCatalog\.outputPrice/)
  assert.match(cards, /price\(model,['"]input['"]\)/); assert.match(cards, /price\(model,['"]output['"]\)/)
  assert.match(table, /class\s*=\s*(["'])pricing-table\1/); assert.match(cards, /class\s*=\s*(["'])pricing-cards\1/)
  assertProperty(pricingCss, '.pricing-page .pricing-table-wrap', 'display', 'none', 'mobile hides the desktop table', /max-width\s*:\s*767px/i)
  assertProperty(cardsCss, '.pricing-cards', 'display', 'grid', 'mobile shows pricing cards', /max-width\s*:\s*767px/i)
  assertProperty(pricingCss, '.pricing-drawer', 'display', 'block', 'mobile shows the pricing drawer', /max-width\s*:\s*767px/i)
  for (const root of [pricingCss, tableCss]) root.walkRules(rule => {
    if (mediaAncestors(rule).length > 0 || !rule.selectors?.some(selector => /\.pricing-table(?:-wrap)?(?![\w-])/.test(selector))) return
    const declarations = propertyMap([rule])
    assert.equal((declarations.get('display') || []).some(value => value.toLowerCase() === 'none'), false, 'desktop pricing table must not use display:none')
    assert.equal((declarations.get('visibility') || []).some(value => value.toLowerCase() === 'hidden'), false, 'desktop pricing table must not use visibility:hidden')
    assert.equal((declarations.get('opacity') || []).some(value => /^0(?:\.0+)?(?:\s*!important)?$/i.test(value)), false, 'desktop pricing table must not use opacity:0')
  })
  assertControlSize(filterCss, '.pricing-filters input', ['min-height'])
  assertControlSize(filterCss, '.pricing-filters select', ['min-height'])
  assertControlSize(pricingCss, '.pricing-pagination button', ['min-height'])
  assertControlSize(pricingCss, '.pricing-pagination select', ['min-height'])
  assertControlSize(pricingCss, '.pricing-filter-toggle', ['min-height'], /max-width\s*:\s*767px/i)
  assertControlSize(pricingCss, '.pricing-drawer > header button', ['min-width', 'min-height'], /max-width\s*:\s*767px/i)
  assert.match(styles, /focus-visible/)
})

test('pricing presentation rejects prototype counts, multipliers and per-request prices', async () => {
  const [page, detail, filters, table, cards] = await Promise.all([
    read('./Pricing.vue'),
    read('./ModelPricingDetail.vue'),
    read('../../components/public/PricingFilters.vue'),
    read('../../components/public/PricingTable.vue'),
    read('../../components/public/PricingCards.vue'),
  ])
  const pricingMessages = Object.values(messages).flatMap(locale => stringValues(locale.publicSite?.pricingCatalog))
  assert.ok(pricingMessages.length > 0, 'runtime pricingCatalog messages must exist')
  const presentation = stripSafePerRequestCopy([page, detail, filters, table, cards].flatMap(visibleStrings).concat(pricingMessages).join('\n'))
  for (const [pattern, label] of prototypePatterns) assert.doesNotMatch(presentation, pattern, label)
})

test('detail presents stable identity, two token price cards, metadata, disclaimer and console action', async () => {
  const [detail, styles] = await Promise.all([read('./ModelPricingDetail.vue'), read('../../styles/public-pricing.scss')])
  assert.match(detail, /class="pricing-detail-back"/)
  assert.match(detail, /class="pricing-detail-title"/)
  assert.match(detail, /class="pricing-model-key"/)
  assert.equal((detail.match(/class="detail-price-card"/g) || []).length, 2)
  assert.match(detail, /class="detail-metadata"/)
  assert.match(detail, /class="detail-disclaimer"/)
  assert.match(detail, /class="[^"]*pricing-console-cta[^"]*"/)
  assert.match(styles, /\.pricing-detail/)
})

test('pages use the shared publication store and distinguish required failure states', async () => {
  const [list, detail] = await Promise.all([read('./Pricing.vue'), read('./ModelPricingDetail.vue')])
  assert.match(list, /inject\(['"]public-home-publication['"]\)/)
  assert.match(list, /loadModels/); assert.match(list, /cancel\(['"]models['"]\)/)
  assert.match(list, /pricingCatalog\.disclaimer/)
  assert.match(list, /loadPricingAuthSession\(true,[\s\S]*import\(['"]@\/api\/request\.js['"]\)/)
  assert.doesNotMatch(list, /onMounted\([\s\S]{0,300}import\(['"]@\/api\/request\.js['"]\)/)
  assert.match(detail, /status === ['"]not_found['"]/); assert.match(detail, /status === ['"]gone['"]/); assert.match(detail, /status === ['"]error['"]/)
  assert.match(detail, /encodeURIComponent/)
  assert.doesNotMatch(`${list}\n${detail}`, /fetch\(|axios|VITE_USE_MOCK|单次调用价|每请求/)
})

test('token prices preserve input/output units plus anonymous redaction and missing-price states', () => {
  const base = {
    model_key: 'stable.model-key_v1', display_name: 'Stable model', provider: 'Provider',
    capabilities: ['chat'], context_window: 128000, price_visibility: 'visible', release_version: 7,
    pricing_type: 'token', endpoint_types: ['chat.completions'], updated_at: '2026-09-12T00:00:00Z',
  }
  const visible = mapPublicModel({
    ...base,
    input_price_usd_per_million_tokens: '0',
    output_price_usd_per_million_tokens: '2.50000000',
    price_source: 'published-source', price_reviewer: 'root', effective_at: '2026-09-12T00:00:00Z',
  })
  assert.equal(visible.modelKey, 'stable.model-key_v1')
  assert.deepEqual(PUBLIC_PRICING, { currency: 'USD', unit: 'million_tokens', billingSemantics: 'references_only_no_automatic_charge' })
  assert.deepEqual(publicPriceState(visible, 'input'), { state: 'published', value: '0' })
  assert.deepEqual(publicPriceState(visible, 'output'), { state: 'published', value: '2.50000000' })
  assert.deepEqual(formatPublicPrice(visible.inputPrice), { state: 'published', label: '0', currency: 'USD', unit: 'million_tokens' })

  const missingOutput = mapPublicModel({
    ...base,
    input_price_usd_per_million_tokens: '1.25',
    price_source: 'published-source', price_reviewer: 'root', effective_at: '2026-09-12T00:00:00Z',
  })
  assert.deepEqual(publicPriceState(missingOutput, 'output'), { state: 'unpublished' })

  const anonymous = mapPublicModel({ ...base, price_visibility: 'authenticated_only' })
  assert.equal('inputPrice' in anonymous, false)
  assert.equal('outputPrice' in anonymous, false)
  assert.deepEqual(publicPriceState(anonymous, 'input'), { state: 'login_required' })
  assert.deepEqual(publicPriceState(anonymous, 'output'), { state: 'login_required' })
  assert.throws(
    () => mapPublicModel({ ...base, price_visibility: 'authenticated_only', input_price_usd_per_million_tokens: '9' }),
    /invalid_public_model/,
  )
})

test('USD per million token labels, page sizes, theme and responsive gates are explicit', async () => {
  const all = (await Promise.all(['./Pricing.vue','./ModelPricingDetail.vue','../../components/public/PricingFilters.vue','../../components/public/PricingTable.vue','../../components/public/PricingCards.vue','../../styles/public-pricing.scss'].map(read))).join('\n')
  const messages = await read('../../i18n/messages.js')
  assert.match(messages, /USD/); assert.match(messages, /百万/)
  for (const size of [20, 50, 100]) assert.match(all, new RegExp(`>${size}<`))
  assert.match(all, /375px/); assert.match(all, /768px/); assert.match(all, /1440px/)
  assert.match(all, /var\(--public-/); assert.match(all, /focus-visible/)
  assert.match(all, /usePublicI18n/); assert.doesNotMatch(all, /(?:price|价格)[^\n]{0,20}(?:免费|\|\|\s*0|\?\?\s*0)/i)
})

test('every Task5 runtime label has distinct Chinese and English text', () => {
  for (const key of ['title','intro','disclaimer','filter','unavailable','sortLoginRequired','previous','next','page','pageSize','search','provider','capability','endpoint','allGroups','sort','order','inputPrice','outputPrice','unit','unpublished','loginRequired','notFound','gone','unavailableTitle','loadingModel','restrictions','source','reviewer','effectiveAt','updatedAt']) {
    const zh = publicText('zh', `pricingCatalog.${key}`, { page: 1, pages: 2 })
    const en = publicText('en', `pricingCatalog.${key}`, { page: 1, pages: 2 })
    assert.equal(typeof zh, 'string'); assert.equal(typeof en, 'string'); assert.notEqual(zh, en)
  }
})
