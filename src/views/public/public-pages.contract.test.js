import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'

const source = path => readFileSync(new URL(path, import.meta.url), 'utf8')
const withoutStyles = value => value.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
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

test('public shell and homepage preserve the published-content contract', () => {
  const layout = source('../../layouts/PublicLayout.vue')
  const home = source('./Home.vue')
  const header = source('../../components/public/PublicHeader.vue')
  const footer = source('../../components/public/PublicFooter.vue')
  assert.match(layout, /h\(PublicHeader/)
  assert.match(layout, /h\(PublicFooter/)
  assert.deepEqual([...home.matchAll(/data-section="([^"]+)"/g)].map(match => match[1]), ['hero', 'proof', 'advantages', 'models', 'announcements-faq', 'cta'])
  assert.match(home, /演示|demo/i)
  assert.match(home, /releaseVersion/)
  assert.match(home, /localStorage/)
  assert.match(layout, /usePublicContentStore/)
  assert.match(layout, /provide\(['"]public-home-publication['"]/)
  assert.match(layout, /createPublicLayoutPublication/)
  assert.match(layout, /onUnmounted\(lifecycle\.dispose\)/)
  assert.doesNotMatch(layout, /publicContentApi|getHome\(/)
  assert.match(home, /inject\(['"]public-home-publication['"]\)/)
  assert.doesNotMatch(home, /createPublicContentState|createPublishedDocumentCodec/)
  assert.doesNotMatch(home, /loadModels|pageSize/)
  assert.match(home, /state\.value\.site\.status === ['"]error['"] \? ['"]error['"]/)
  assert.match(home, /const load = \(\) => loadHome\(\)/)
  assert.match(home, /@retry="load"/)
  assert.match(home, /to=["']\/chat["']/)
  assert.match(home, /<RouterLink\b[^>]*\bto=["']\/chat["']/)
  assert.match(home, /<RouterLink\b[^>]*\bto=["']\/pricing["']/)
  assert.doesNotMatch(`${layout}${home}${header}${footer}`, /href=["']#["']/)
  assert.doesNotMatch(`${layout}${home}${header}${footer}`, /(?:>|['"])(?:40\+|100%|MIT|永久免费)(?:<|['"])/)
})

test('about and legal pages expose safe published states and metadata', () => {
  const about = source('./About.vue')
  const legal = source('./LegalPage.vue')
  const state = source('../../components/public/PublicContentState.vue')
  assert.match(about, /loadPage\(['"]about['"]\)/)
  assert.match(about, /inject\(['"]public-home-publication['"]\)/)
  assert.match(legal, /inject\(['"]public-home-publication['"]\)/)
  assert.doesNotMatch(`${about}${legal}`, /createPublicContentState/)
  assert.match(legal, /invalidatePage\(previous\)/)
  assert.match(legal, /onCleanup\([\s\S]*invalidatePage\(page\)/)
  assert.match(legal, /version/)
  assert.match(legal, /effectiveDate/)
  assert.match(legal, /table-of-contents|目录/)
  assert.match(legal, /createPublishedDocumentCodec/)
  assert.match(about, /createPublishedDocumentCodec/)
  assert.doesNotMatch(`${about}${legal}`, /JSON\.parse|frontmatter/i)
  assert.match(state, /loading/)
  assert.match(state, /preparing/)
  assert.match(state, /empty/)
  assert.match(state, /error/)
  assert.match(state, /retry/)
  assert.match(`${about}${legal}`, /<h1/)
  assert.equal((about.match(/<h1/g) || []).length, 1)
  assert.equal((legal.match(/<h1/g) || []).length, 1)
  assert.match(about, /content\.bodyHTML/)
  assert.match(legal, /content\.legalBodyHTML/)
  assert.match(`${about}${legal}${state}`, /\bt\('/)
})

test('public and administrative surfaces retain distinct state identifiers', () => {
  const home = source('./Home.vue')
  const state = source('../../components/public/PublicContentState.vue')
  const notFound = source('../PublicNotFound.vue')
  const detail = source('./ModelPricingDetail.vue')
  const publicApi = source('../../api/publicContent.js')
  const publicModelDetail = source('../PublicModelDetail.vue')

  for (const status of ['loading', 'preparing', 'idle', 'empty', 'ready-empty', 'error', 'not_found', 'gone']) {
    assert.match(state, new RegExp(`['"]${status}['"]`), status)
  }
  assert.match(home, /homeStatus !== ['"]ready['"]/)
  assert.match(home, /status=["']preparing["']/)
  assert.match(notFound, /(?:>|aria-label=["'][^"']*)404(?:<|["'])/)
  assert.match(publicApi, /401:\s*['"]authentication_required['"]/)
  assert.match(publicApi, /404:\s*['"]not_found['"]/)
  assert.match(publicApi, /410:\s*['"]gone['"]/)
  assert.match(publicApi, /503:\s*['"]unavailable['"]/)
  for (const status of ['not_found', 'gone', 'login_required', 'error']) {
    assert.match(detail, new RegExp(`slot\\.status === ['"]${status}['"]`), status)
  }
  assert.match(publicModelDetail, /revision_conflict/)
  assert.match(publicModelDetail, /root_required/)
  assert.match(publicModelDetail, /unavailable/)
})

test('public publication ownership remains in the layout and every consumer cancels its work', () => {
  const layout = source('../../layouts/PublicLayout.vue')
  const home = source('./Home.vue')
  const about = source('./About.vue')
  const legal = source('./LegalPage.vue')
  const pricing = source('./Pricing.vue')
  const detail = source('./ModelPricingDetail.vue')

  assert.match(layout, /provide\('public-home-publication', \{ store, publication, ready, loadHome: lifecycle\.loadHome, loadPage: lifecycle\.loadPage \}\)/)
  assert.match(layout, /onUnmounted\(lifecycle\.dispose\)/)
  for (const consumer of [home, about, legal, pricing, detail]) assert.match(consumer, /inject\(['"]public-home-publication['"]\)/)
  assert.match(pricing, /onBeforeUnmount\([\s\S]*store\.cancel\(['"]models['"]\)/)
  assert.match(detail, /onCleanup\(\(\) => store\.cancel\(`detail:\$\{key\}`\)\)/)
  assert.match(detail, /onBeforeUnmount\([\s\S]*store\.cancel\(`detail:\$\{modelKey\.value\}`\)/)
  assert.match(legal, /onCleanup\([\s\S]*invalidatePage\(page\)/)
})

test('public pages are lazy routes and styles cover themes, breakpoints and reduced motion', () => {
  const router = source('../../router/index.js')
  const shell = source('../../styles/public-shell.scss')
  assert.match(router, /import\(['"]@\/views\/public\/Home\.vue['"]\)/)
  assert.match(router, /import\(['"]@\/views\/public\/About\.vue['"]\)/)
  assert.match(router, /import\(['"]@\/views\/public\/LegalPage\.vue['"]\)/)
  assert.match(shell, /--public-primary:\s*var\(--color-brand\)/i)
  assert.match(shell, /prefers-color-scheme:\s*dark/)
  assert.match(shell, /prefers-reduced-motion:\s*reduce/)
  assert.match(shell, /max-width:\s*767px/)
  assert.match(shell, /min-width:\s*768px/)
  assert.match(shell, /max-width:\s*1279px/)
})

test('public content pages compose the approved safe landing system', () => {
  const home = source('./Home.vue')
  const hero = source('../../components/public/HeroPreview.vue')
  const section = source('../../components/public/PublicSection.vue')
  const styles = source('../../styles/public-content.scss')
  const about = source('./About.vue')
  const legal = source('./LegalPage.vue')
  const notFound = source('../PublicNotFound.vue')
  const preview = source('../PublicContentPreview.vue')
  const layout = source('../../layouts/PublicLayout.vue')
  const header = source('../../components/public/PublicHeader.vue')
  const footer = source('../../components/public/PublicFooter.vue')
  const publicComponents = readdirSync(new URL('../../components/public/', import.meta.url))
    .filter(file => file.endsWith('.vue'))
    .map(file => withoutStyles(source(`../../components/public/${file}`)))
  const messages = source('../../i18n/messages.js')
  const publicMessages = source('../../i18n/public-messages.js')
  const runtimePublicMessages = namedObjectBlocks(messages, 'publicSite')
  const rawPublicStyles = [
    source('../../styles/public-content.scss'),
    source('../../styles/public-shell.scss'),
    source('../../styles/public-pricing.scss'),
    layout, header, footer, home, hero, section, about, legal, notFound, preview,
    ...readdirSync(new URL('../../components/public/', import.meta.url))
      .filter(file => file.endsWith('.vue'))
      .map(file => source(`../../components/public/${file}`)),
  ].join('\n')
  const sourceBundle = [layout, header, footer, home, hero, section, about, legal, notFound, preview, publicMessages, ...runtimePublicMessages, ...publicComponents]
    .map(withoutStyles)
    .join('\n')

  assert.doesNotMatch(rawPublicStyles, /\bcdn\.tailwindcss\.com\b/i, 'public styles must not load the Tailwind CDN')
  assert.doesNotMatch(rawPublicStyles, /(?:@import|@use)\s+(?:url\()?[^;{}\n]*(?:https?:)?\/\/[^;{}\n]*tailwind/i, 'public styles must not import Tailwind from a CDN')
  assert.doesNotMatch(rawPublicStyles, /<(?:script|link)\b[^>]*(?:src|href)\s*=\s*["'][^"']*(?:https?:)?\/\/[^"']*tailwind/i, 'public Vue sources must not load Tailwind from a remote script or stylesheet')

  assert.match(home, /<HeroPreview/)
  assert.equal((home.match(/<PublicSection/g) || []).length, 3)
  assert.match(hero, /aria-hidden="true"/)
  assert.match(hero, /capability-preview/)
  assert.doesNotMatch(hero, /v-html|api[_-]?key|token|user(?:name)?|chat/i)
  assert.match(styles, /radial-gradient/)
  assert.match(styles, /repeat\(3,\s*minmax\(0,\s*1fr\)\)/)
  assert.match(styles, /prefers-reduced-motion:\s*reduce/)
  assert.match(styles, /max-width:\s*767px/)
  assert.match(`${about}${legal}`, /public-document__content/)
  assert.match(legal, /public-document__meta/)
  assert.match(legal, /table-of-contents/)
  assert.match(notFound, /public-not-found/)
  assert.match(preview, /preview-banner/)
  assert.match(preview, /aria-live="polite"/)
  assert.match(`${home}${about}${legal}`, /v-html="(?:home\.|content\.)/)
  const forbiddenClaims = [
    [/ModelHub/i, 'prototype product name'],
    [/(?:>|['"])[^<"']*40\+[^<"']*(?:<|['"])/i, 'prototype model count'],
    [/(?:>|['"])[^<"']*100%[^<"']*(?:<|['"])/i, 'prototype percentage claim'],
    [/MIT License/i, 'prototype license claim'],
    [/Tailwind\s+CDN/i, 'Tailwind CDN claim'],
    [/(?:admin|demo)(?:@[^\s<"']+)?\s*(?:\/|:|：)\s*(?:admin|password|123456)/i, 'demo credentials'],
    [/\b(?:admin|demo)@[A-Z0-9._%+-]+\.[A-Z]{2,}\b/i, 'demo account email'],
    [/(?:password|密码)\s*[:=：]\s*["']?(?:admin\d*|demo\d*|123456(?:78)?)/i, 'demo password'],
    [/(?:API[_ -]?KEY\s*[=:]|sk-[A-Za-z0-9_-]{8,})/i, 'demo API credential'],
    [/(?:>|['"])[^<"']*\d+(?:\.\d+)?\s*(?:x|×|倍)[^<"']*(?:<|['"])/i, 'prototype multiplier'],
    [/(?:单次调用价|(?:每次请求|每请求)[^<\n]{0,20}(?:价|[$¥￥]\s*\d)|(?:[$¥￥]\s*\d+(?:\.\d+)?|\d+(?:\.\d+)?\s*(?:USD|CNY))\s*\/\s*request\b|per[- ]request\s+(?:price|pricing))/i, 'per-request pricing'],
  ]
  for (const [pattern, label] of forbiddenClaims) {
    assert.doesNotMatch(sourceBundle, pattern, label)
  }
})
