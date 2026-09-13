import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import postcss from 'postcss'

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8')
const root = path => postcss.parse(read(path), { from: path })
const tokens = root('./tokens.scss')
const foundations = root('./foundations.scss')
const global = root('./global.scss')
const publicShell = root('./public-shell.scss')
const publicContent = root('./public-content.scss')
const consoleShell = root('./console-shell.scss')
const consolePages = root('./console-pages.scss')
const publicPricing = root('./public-pricing.scss')
const surfaces = [tokens, foundations, global, publicShell, publicContent, consoleShell, consolePages, publicPricing]

const mediaAncestors = rule => {
  const media = []
  for (let parent = rule.parent; parent; parent = parent.parent) {
    if (parent.type === 'atrule' && parent.name.toLowerCase() === 'media') media.push(parent.params)
  }
  return media
}
const exactRules = (stylesheet, selector, media) => {
  const matches = []
  stylesheet.walkRules(rule => {
    if (!rule.selectors?.map(value => value.trim()).includes(selector)) return
    const ancestors = mediaAncestors(rule)
    if (media === 'all' || (!media && ancestors.length === 0) || (media instanceof RegExp && ancestors.some(value => media.test(value)))) matches.push(rule)
  })
  return matches
}
const values = (rules, property) => rules.flatMap(rule => rule.nodes
  .filter(node => node.type === 'decl' && node.prop === property)
  .map(node => node.value.trim()))
const assertMapping = (stylesheet, selector, property, expected, message, media) => {
  const actual = values(exactRules(stylesheet, selector, media), property)
  assert.ok(actual.includes(expected), `${message}; found ${JSON.stringify(actual)}`)
}

test('semantic typography tokens keep the approved exact pixel scale', () => {
  const expected = {
    xs: '11px', sm: '12px', body: '14px', subtitle: '16px',
    'page-title': '20px', 'section-title': '30px', hero: '44px', 'hero-mobile': '34px',
  }
  for (const [name, value] of Object.entries(expected)) {
    const actual = []
    tokens.walkDecls(`--font-size-${name}`, declaration => actual.push(declaration.value.trim()))
    assert.deepEqual(actual, [value], `--font-size-${name} must remain ${value}`)
  }
})

test('foundations and global components map body, page and component text to semantic tokens', () => {
  assertMapping(foundations, 'body', 'font-size', 'var(--font-size-body)', 'body text uses the body token')
  assertMapping(global, '.page-title', 'font-size', 'var(--font-size-page-title)', 'page titles use the page-title token')
  assertMapping(global, '.el-dialog', '--el-dialog-title-font-size', 'var(--font-size-subtitle)', 'dialog titles use the subtitle token')
  assertMapping(global, '.el-alert', '--el-alert-title-font-size', 'var(--font-size-sm)', 'alert titles use the small token')
  assertMapping(global, '.page-title', 'font-size', 'var(--font-size-page-title)', 'mobile page titles keep the page-title token', /max-width\s*:\s*768px/i)
})

test('public pages map hero, section and supporting copy to the shared typography scale', () => {
  assertMapping(publicShell, '.public-brand', 'font-size', 'var(--font-size-subtitle)', 'public brand uses subtitle text')
  assertMapping(publicShell, '.public-hero h1', 'font-size', 'var(--font-size-hero)', 'desktop hero uses the hero token')
  assertMapping(publicShell, '.public-lead', 'font-size', 'var(--font-size-subtitle)', 'lead copy uses the subtitle token')
  assertMapping(publicShell, '.public-eyebrow', 'font-size', 'var(--font-size-sm)', 'eyebrows use the small token')
  assertMapping(publicContent, '.public-content-section__heading h2', 'font-size', 'var(--font-size-section-title)', 'public section headings use the section-title token')
  assertMapping(publicShell, '.public-hero h1', 'font-size', 'var(--font-size-hero-mobile)', 'mobile hero uses the hero-mobile token', /max-width\s*:\s*767px/i)
  assertMapping(publicPricing, '.pricing-heading h1', 'font-size', 'var(--font-size-section-title)', 'pricing headings use the section-title token')
  assertMapping(publicPricing, '.pricing-heading p', 'font-size', 'var(--font-size-body)', 'pricing supporting copy uses the body token')
})

test('console surfaces map brand, navigation, headings and statuses to semantic tokens', () => {
  assertMapping(consoleShell, '.app-brand__copy strong', 'font-size', 'var(--font-size-subtitle)', 'console brand uses subtitle text')
  assertMapping(consoleShell, '.app-brand__copy small', 'font-size', 'var(--font-size-xs)', 'console brand detail uses extra-small text')
  assertMapping(consoleShell, '.token-stat', 'font-size', 'var(--font-size-sm)', 'token stats use small text')
  assertMapping(consoleShell, '.console-sidebar__group', 'font-size', 'var(--font-size-xs)', 'sidebar group labels use extra-small text')
  assertMapping(consoleShell, '.page-header h1', 'font-size', 'var(--font-size-page-title)', 'console headings use the page-title token')
  assertMapping(consoleShell, '.page-header__eyebrow', 'font-size', 'var(--font-size-sm)', 'console eyebrows use small text')
  assertMapping(consoleShell, '.page-header__description', 'font-size', 'var(--font-size-body)', 'console descriptions use body text')
  assertMapping(consoleShell, '.status-badge', 'font-size', 'var(--font-size-sm)', 'status badges use small text')
  assertMapping(consolePages, '.auth-brand h1', 'font-size', 'var(--font-size-page-title)', 'auth headings use the page-title token')
})

test('typography stays at real size and interactive controls retain 44px targets', () => {
  const semanticSelectors = new Set([
    'body', '.page-title', '.el-dialog', '.el-alert', '.public-brand', '.public-hero h1', '.public-lead', '.public-eyebrow',
    '.public-content-section__heading h2', '.pricing-heading h1', '.pricing-heading p', '.app-brand__copy strong',
    '.app-brand__copy small', '.token-stat', '.console-sidebar__group', '.page-header h1', '.page-header__eyebrow',
    '.page-header__description', '.status-badge', '.auth-brand h1',
  ])
  for (const stylesheet of surfaces) {
    const typographySelectors = new Set(semanticSelectors)
    stylesheet.walkRules(rule => {
      const hasFontSize = rule.nodes.some(node => node.type === 'decl' && ['font', 'font-size'].includes(node.prop))
      if (hasFontSize) for (const selector of rule.selectors || []) {
        if (!/(?:^|[-_])icon(?:$|[-_\s.:>])|\bsvg\b|spinner/i.test(selector)) typographySelectors.add(selector.trim())
      }
    })
    for (const selector of typographySelectors) {
      for (const rule of exactRules(stylesheet, selector, 'all')) {
        if (/:hover|:active|:focus/.test(selector)) continue
        for (const node of rule.nodes) {
          if (node.type !== 'decl') continue
          assert.notEqual(node.prop.toLowerCase(), 'zoom', `${selector} must not resize typography with zoom`)
          if (node.prop.toLowerCase() === 'transform') assert.doesNotMatch(node.value, /\bscale(?:x|y|3d)?\s*\(/i, `${selector} must not resize typography with transform scale`)
        }
      }
    }
  }

  const controlSizes = []
  tokens.walkDecls('--control-min-size', declaration => controlSizes.push(declaration.value.trim()))
  assert.deepEqual(controlSizes, ['44px'])
  assertMapping(publicShell, '.public-locale', 'min-height', 'var(--control-min-size)', 'public header controls keep the shared touch target')
  assertMapping(publicShell, '.public-button', 'min-height', 'var(--control-min-size)', 'public actions keep the shared touch target')
  assertMapping(consoleShell, '.user-trigger', 'min-height', 'var(--control-min-size)', 'console user control keeps the shared touch target')
  const pricingTargets = []
  publicPricing.walkDecls('min-height', declaration => pricingTargets.push(declaration.value.trim()))
  assert.ok(pricingTargets.some(value => value === '44px' || value === 'var(--control-min-size)'), 'pricing controls retain at least a 44px target')
})
