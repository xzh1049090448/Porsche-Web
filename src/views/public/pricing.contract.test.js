import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { publicText } from '../../i18n/public-runtime.js'
import { formatPublicPrice, mapPublicModel, PUBLIC_PRICING } from '../../utils/public-catalog.js'
import { publicPriceState } from '../../utils/public-pricing-query.js'

const read = path => readFile(new URL(path, import.meta.url), 'utf8')
const controlSize = '(?:44px|var\\(--control-min-size\\))'
const namedObjectBlocks = (value, name) => {
  const blocks = []
  const pattern = new RegExp(`\\b${name}\\s*:\\s*\\{`, 'g')
  for (const match of value.matchAll(pattern)) {
    const start = match.index + match[0].lastIndexOf('{')
    let depth = 1
    let end = start + 1
    while (end < value.length && depth > 0) {
      if (value[end] === '{') depth += 1
      else if (value[end] === '}') depth -= 1
      end += 1
    }
    assert.equal(depth, 0, `${name} message object must be balanced`)
    blocks.push(value.slice(start, end))
  }
  assert.ok(blocks.length > 0, `${name} message objects must exist`)
  return blocks
}
const withoutMobileMedia = source => {
  let output = ''
  let cursor = 0
  while (cursor < source.length) {
    const start = source.indexOf('@media', cursor)
    if (start === -1) return output + source.slice(cursor)
    const open = source.indexOf('{', start)
    if (open === -1) return output + source.slice(cursor)
    let depth = 1
    let end = open + 1
    while (end < source.length && depth > 0) {
      if (source[end] === '{') depth += 1
      else if (source[end] === '}') depth -= 1
      end += 1
    }
    const header = source.slice(start, open)
    output += source.slice(cursor, start)
    if (!/max-width\s*:\s*767px/.test(header)) output += source.slice(start, end)
    cursor = end
  }
  return output
}

test('pricing routes load real lazy pages and preserve encoded stable modelKey', async () => {
  const [router, main] = await Promise.all([read('../../router/index.js'), read('../../main.js')])
  assert.match(router, /PublicPricing['"],?\s*component:\s*\(\)\s*=>\s*import\(['"]@\/views\/public\/Pricing\.vue['"]\)/)
  assert.match(router, /PublicPricingDetail['"],?\s*component:\s*\(\)\s*=>\s*import\(['"]@\/views\/public\/ModelPricingDetail\.vue['"]\)/)
  assert.match(await read('../../components/public/PricingTable.vue'), /encodeURIComponent\(model\.modelKey\)/)
  assert.match(main, /mountPublicApp:[\s\S]*createPinia\(\)/)
})

test('catalog exposes desktop filters/table, mobile drawer/cards and accessible controls', async () => {
  const [page, filters, table, cards, styles] = await Promise.all([read('./Pricing.vue'), read('../../components/public/PricingFilters.vue'), read('../../components/public/PricingTable.vue'), read('../../components/public/PricingCards.vue'), read('../../styles/public-pricing.scss')])
  assert.match(page, /@\/styles\/public-pricing\.scss/)
  assert.match(styles, /max-width:\s*1600px/); assert.match(styles, /\.pricing-layout\s*\{[^}]*grid-template-columns:\s*260px\s+minmax\(0,\s*1fr\)/s); assert.match(styles, /@media\s*\(max-width:\s*767px\)/)
  assert.match(page, /PricingFilters/); assert.match(page, /PricingTable/); assert.match(page, /PricingCards/)
  for (const className of ['pricing-layout', 'pricing-sidebar', 'pricing-toolbar']) assert.match(page, new RegExp(`class="${className}"`))
  assert.match(page, /class="pricing-results-count"/)
  assert.match(page, /role="dialog"/); assert.match(page, /aria-modal="true"/)
  assert.match(page, /aria-controls="pricing-filter-drawer"/); assert.match(page, /:aria-expanded="drawerOpen"/)
  for (const field of ['search', 'provider', 'capability', 'endpoint', 'group', 'sort']) assert.match(filters, new RegExp(`name="${field}"`))
  assert.match(table, /publicPriceState/); assert.match(cards, /publicPriceState/)
  assert.match(table, /pricingCatalog\.inputPrice/); assert.match(table, /pricingCatalog\.outputPrice/)
  assert.match(cards, /price\(model,['"]input['"]\)/); assert.match(cards, /price\(model,['"]output['"]\)/)
  assert.match(table, /class="pricing-table"/); assert.match(cards, /class="pricing-cards"/)
  assert.match(styles, /\.pricing-page \.pricing-table-wrap\s*\{\s*display:\s*none/s)
  assert.match(cards, /@media\s*\(\s*max-width:\s*767px\s*\)\s*\{\s*\.pricing-cards\s*\{\s*display:\s*grid/s)
  assert.match(styles, /\.pricing-drawer\s*\{[^}]*display:\s*block/s)
  const desktopPresentation = `${withoutMobileMedia(table)}\n${withoutMobileMedia(styles)}`
  assert.doesNotMatch(desktopPresentation, /\.pricing-(?:table|table-wrap)\b[^{}]*\{[^}]*(?:\bdisplay\s*:\s*none\b|\bvisibility\s*:\s*hidden\b|\bopacity\s*:\s*0(?:\.0+)?\s*(?:!important)?\s*;)/s, 'desktop pricing table must not be globally hidden')
  assert.match(filters, new RegExp(`\\.pricing-filters input\\s*,\\s*\\.pricing-filters select\\s*\\{[^}]*min-height\\s*:\\s*${controlSize}`), 'filter inputs and selects keep 44px targets')
  assert.match(styles, new RegExp(`\\.pricing-pagination button\\s*,\\s*\\.pricing-pagination select\\s*\\{[^}]*min-height\\s*:\\s*${controlSize}`), 'pagination controls keep 44px targets')
  assert.match(styles, new RegExp(`\\.pricing-filter-toggle\\s*\\{[^}]*min-height\\s*:\\s*${controlSize}`), 'mobile filter trigger keeps a 44px target')
  assert.match(styles, new RegExp(`\\.pricing-drawer > header button\\s*\\{[^}]*min-width\\s*:\\s*${controlSize}[^}]*min-height\\s*:\\s*${controlSize}`), 'drawer close control keeps a 44px square target')
  assert.match(styles, /focus-visible/)
})

test('pricing presentation rejects prototype counts, multipliers and per-request prices', async () => {
  const [page, detail, filters, table, cards, styles, messages] = await Promise.all([
    read('./Pricing.vue'),
    read('./ModelPricingDetail.vue'),
    read('../../components/public/PricingFilters.vue'),
    read('../../components/public/PricingTable.vue'),
    read('../../components/public/PricingCards.vue'),
    read('../../styles/public-pricing.scss'),
    read('../../i18n/messages.js'),
  ])
  const pricingMessages = namedObjectBlocks(messages, 'pricingCatalog')
  const presentation = [page, detail, filters, table, cards, styles, ...pricingMessages].join('\n')
  const forbidden = [
    [/40\+|\b\d+\+?\s*(?:个\s*)?(?:模型|供应商)|\b\d+\+?\s*(?:models?|providers?)\b/i, 'hard-coded prototype model or provider count'],
    [/(?:>|['"])[^<"']*\d+(?:\.\d+)?\s*(?:x|×|倍)[^<"']*(?:<|['"])/i, 'prototype multiplier'],
    [/(?:单次调用价|(?:每次请求|每请求)[^<\n]{0,20}(?:价|[$¥￥]\s*\d)|(?:[$¥￥]\s*\d+(?:\.\d+)?|\d+(?:\.\d+)?\s*(?:USD|CNY))\s*\/\s*request\b|per[- ]request\s+(?:price|pricing))/i, 'per-request price'],
    [/(?:admin|demo)(?:@[^\s<"']+)?\s*(?:\/|:|：)\s*(?:admin|password|123456)/i, 'demo credentials'],
    [/\b(?:admin|demo)@[A-Z0-9._%+-]+\.[A-Z]{2,}\b/i, 'demo account email'],
    [/(?:password|密码)\s*[:=：]\s*["']?(?:admin\d*|demo\d*|123456(?:78)?)/i, 'demo password'],
    [/(?:API[_ -]?KEY\s*[=:]\s*["']?(?:sk-)?[A-Za-z0-9_-]{8,}|sk-[A-Za-z0-9_-]{8,})/i, 'hard-coded API credential'],
  ]
  for (const [pattern, label] of forbidden) assert.doesNotMatch(presentation, pattern, label)
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
