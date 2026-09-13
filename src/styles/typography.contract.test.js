import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8')
const splitTopLevel = (value, delimiter) => {
  const parts = []
  let start = 0
  let quote = ''
  let escaped = false
  let depth = 0
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]
    if (escaped) { escaped = false; continue }
    if (quote) {
      if (character === '\\') escaped = true
      else if (character === quote) quote = ''
      continue
    }
    if (character === '"' || character === "'") { quote = character; continue }
    if ('([{'.includes(character)) depth += 1
    else if (')]}'.includes(character)) depth -= 1
    else if (character === delimiter && depth === 0) { parts.push(value.slice(start, index).trim()); start = index + 1 }
  }
  parts.push(value.slice(start).trim())
  return parts.filter(Boolean)
}
const parseDeclarations = (body, nextOrder) => splitTopLevel(body, ';').flatMap(entry => {
  const separator = splitTopLevel(entry, ':')
  if (separator.length < 2) return []
  const property = separator.shift().trim().toLowerCase()
  let value = separator.join(':').trim()
  const important = /!\s*important\s*$/i.test(value)
  value = value.replace(/!\s*important\s*$/i, '').trim()
  return [{ property, value, important, order: nextOrder() }]
})
const parseCssRules = source => {
  const rules = []
  let declarationOrder = 0
  const clean = source.replace(/\/\*[\s\S]*?\*\//g, '')
  const parseScope = (value, media = []) => {
    let cursor = 0
    while (cursor < value.length) {
      while (/\s|;/.test(value[cursor] || '')) cursor += 1
      if (cursor >= value.length) break
      const headerStart = cursor
      let quote = ''
      let escaped = false
      let parentheses = 0
      while (cursor < value.length) {
        const character = value[cursor]
        if (escaped) escaped = false
        else if (quote) { if (character === '\\') escaped = true; else if (character === quote) quote = '' }
        else if (character === '"' || character === "'") quote = character
        else if (character === '(') parentheses += 1
        else if (character === ')') parentheses -= 1
        else if ((character === '{' || character === ';') && parentheses === 0) break
        cursor += 1
      }
      if (value[cursor] === ';') { cursor += 1; continue }
      if (value[cursor] !== '{') break
      const header = value.slice(headerStart, cursor).trim()
      const bodyStart = ++cursor
      let braces = 1
      quote = ''
      escaped = false
      while (cursor < value.length && braces > 0) {
        const character = value[cursor]
        if (escaped) escaped = false
        else if (quote) { if (character === '\\') escaped = true; else if (character === quote) quote = '' }
        else if (character === '"' || character === "'") quote = character
        else if (character === '{') braces += 1
        else if (character === '}') braces -= 1
        cursor += 1
      }
      const body = value.slice(bodyStart, cursor - 1)
      if (/^@media\b/i.test(header)) parseScope(body, media.concat(header.replace(/^@media\s*/i, '')))
      else if (/^@(?:supports|layer|container)\b/i.test(header)) parseScope(body, media)
      else if (!header.startsWith('@')) rules.push({ selectors: splitTopLevel(header, ','), declarations: parseDeclarations(body, () => declarationOrder++), media })
    }
  }
  parseScope(clean)
  return rules
}
const root = path => parseCssRules(read(path))
const tokens = root('./tokens.scss')
const foundations = root('./foundations.scss')
const global = root('./global.scss')
const publicShell = root('./public-shell.scss')
const publicContent = root('./public-content.scss')
const consoleShell = root('./console-shell.scss')
const consolePages = root('./console-pages.scss')
const publicPricing = root('./public-pricing.scss')
const surfaces = [tokens, foundations, global, publicShell, publicContent, consoleShell, consolePages, publicPricing]

const exactRules = (stylesheet, selector, media) => stylesheet.filter(rule => {
  if (!rule.selectors.includes(selector)) return false
  return media === 'all' || (!media && rule.media.length === 0) || (media instanceof RegExp && rule.media.some(value => media.test(value)))
})
const mediaQueryMatchesScreen = (query, width) => {
  if (/(?:^|\s|\()print(?:\s|$|\))/i.test(query) && !/not\s+print/i.test(query)) return false
  if (/not\s+screen/i.test(query)) return false
  if (/prefers-reduced-motion\s*:\s*reduce/i.test(query)) return false
  const minimums = [...query.matchAll(/min-width\s*:\s*(\d+(?:\.\d+)?)px/gi)].map(match => Number(match[1]))
  const maximums = [...query.matchAll(/max-width\s*:\s*(\d+(?:\.\d+)?)px/gi)].map(match => Number(match[1]))
  return minimums.every(minimum => width >= minimum) && maximums.every(maximum => width <= maximum)
}
const mediaMatchesScreen = (conditions, width) => conditions.every(condition => splitTopLevel(condition, ',').some(query => mediaQueryMatchesScreen(query, width)))
const fontSizeFromShorthand = value => value.match(/(?:^|\s)(var\([^)]*\)|(?:\d*\.)?\d+(?:px|rem|em|%|vw|vh)|xx-small|x-small|small|medium|large|x-large|xx-large|smaller|larger)(?:\s*\/|\s|$)/i)?.[1] || value
const effectiveValue = (stylesheet, selector, property, width) => {
  let winner
  const apply = declaration => {
    if (!winner || Number(declaration.important) > Number(winner.important) || (declaration.important === winner.important && declaration.order > winner.order)) winner = declaration
  }
  for (const rule of stylesheet) {
    if (!rule.selectors.includes(selector) || !mediaMatchesScreen(rule.media, width)) continue
    for (const declaration of rule.declarations) {
      if (declaration.property === property) apply(declaration)
      else if (property === 'font-size' && declaration.property === 'font') apply({ ...declaration, property, value: fontSizeFromShorthand(declaration.value) })
    }
  }
  return winner?.value.trim()
}
const assertMapping = (stylesheet, selector, property, expected, message, widths = [375, 1440]) => {
  for (const width of widths) assert.equal(effectiveValue(stylesheet, selector, property, width), expected, `${message} at ${width}px`)
}
const assertMinimumControl = (stylesheet, selector, property, message, widths = [375, 1440]) => {
  for (const width of widths) {
    const value = effectiveValue(stylesheet, selector, property, width)
    const pixels = value === 'var(--control-min-size)' ? 44 : Number(value?.match(/^(\d+(?:\.\d+)?)px$/)?.[1])
    assert.ok(Number.isFinite(pixels) && pixels >= 44, `${message} at ${width}px; found ${JSON.stringify(value)}`)
  }
}

test('semantic typography tokens keep the approved exact pixel scale', () => {
  const expected = {
    xs: '11px', sm: '12px', body: '14px', subtitle: '16px',
    'page-title': '20px', 'section-title': '30px', hero: '44px', 'hero-mobile': '34px',
  }
  for (const [name, value] of Object.entries(expected)) {
    assertMapping(tokens, 'html:root', `--font-size-${name}`, value, `--font-size-${name} must remain ${value}`)
  }
})

test('foundations and global components map body, page and component text to semantic tokens', () => {
  assertMapping(foundations, 'body', 'font-size', 'var(--font-size-body)', 'body text uses the body token')
  assertMapping(global, '.page-title', 'font-size', 'var(--font-size-page-title)', 'page titles use the page-title token')
  assertMapping(global, '.el-dialog', '--el-dialog-title-font-size', 'var(--font-size-subtitle)', 'dialog titles use the subtitle token')
  assertMapping(global, '.el-alert', '--el-alert-title-font-size', 'var(--font-size-sm)', 'alert titles use the small token')
})

test('public pages map hero, section and supporting copy to the shared typography scale', () => {
  assertMapping(publicShell, '.public-brand', 'font-size', 'var(--font-size-subtitle)', 'public brand uses subtitle text')
  assertMapping(publicShell, '.public-hero h1', 'font-size', 'var(--font-size-hero)', 'desktop hero uses the hero token', [1440])
  assertMapping(publicShell, '.public-lead', 'font-size', 'var(--font-size-subtitle)', 'lead copy uses the subtitle token')
  assertMapping(publicShell, '.public-eyebrow', 'font-size', 'var(--font-size-sm)', 'eyebrows use the small token')
  assertMapping(publicContent, '.public-content-section__heading h2', 'font-size', 'var(--font-size-section-title)', 'public section headings use the section-title token')
  assertMapping(publicShell, '.public-hero h1', 'font-size', 'var(--font-size-hero-mobile)', 'mobile hero uses the hero-mobile token', [375])
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
    for (const rule of stylesheet) {
      const hasFontSize = rule.declarations.some(declaration => ['font', 'font-size'].includes(declaration.property))
      if (hasFontSize) for (const selector of rule.selectors) {
        if (!/(?:^|[-_])icon(?:$|[-_\s.:>])|\bsvg\b|spinner/i.test(selector)) typographySelectors.add(selector.trim())
      }
    }
    for (const selector of typographySelectors) {
      for (const rule of exactRules(stylesheet, selector, 'all')) {
        if (/:hover|:active|:focus/.test(selector)) continue
        for (const node of rule.declarations) {
          assert.notEqual(node.property, 'zoom', `${selector} must not resize typography with zoom`)
          if (node.property === 'transform') assert.doesNotMatch(node.value, /\bscale(?:x|y|3d)?\s*\(/i, `${selector} must not resize typography with transform scale`)
        }
      }
    }
  }

  assertMapping(tokens, 'html:root', '--control-min-size', '44px', 'shared controls retain a 44px minimum')
  assertMinimumControl(publicShell, '.public-locale', 'min-height', 'public header controls keep the shared touch target')
  assertMinimumControl(publicShell, '.public-button', 'min-height', 'public actions keep the shared touch target')
  assertMinimumControl(consoleShell, '.user-trigger', 'min-height', 'console user control keeps the shared touch target')
  for (const selector of ['.pricing-pagination button', '.pricing-pagination select', '.pricing-detail-back', '.pricing-console-cta']) assertMinimumControl(publicPricing, selector, 'min-height', `${selector} keeps a 44px target`)
  assertMinimumControl(publicPricing, '.pricing-filter-toggle', 'min-height', 'mobile pricing filter keeps a 44px target', [375])
  assertMinimumControl(publicPricing, '.pricing-drawer > header button', 'min-width', 'mobile drawer close control keeps a 44px width', [375])
  assertMinimumControl(publicPricing, '.pricing-drawer > header button', 'min-height', 'mobile drawer close control keeps a 44px height', [375])
})
