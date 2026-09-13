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

const normalizeSelector = selector => selector.trim().replace(/\s*([>+~])\s*/g, '$1').replace(/\s+/g, ' ')
const exactRules = (stylesheet, selector, media) => stylesheet.filter(rule => {
  if (!rule.selectors.some(candidate => normalizeSelector(candidate) === normalizeSelector(selector))) return false
  return media === 'all' || (!media && rule.media.length === 0) || (media instanceof RegExp && rule.media.some(value => media.test(value)))
})
const mediaQueryIsScreen = query => {
  if (/(?:^|\s|\()print(?:\s|$|\))/i.test(query) && !/not\s+print/i.test(query)) return false
  if (/not\s+screen/i.test(query)) return false
  if (/(?:^|\s|\()speech(?:\s|$|\))/i.test(query) && !/not\s+speech/i.test(query)) return false
  return true
}
const widthComparison = (width, operator, threshold) => ({ '>': width > threshold, '>=': width >= threshold, '<': width < threshold, '<=': width <= threshold }[operator])
const mediaQueryMatchesScreen = (query, width, reduced) => {
  if (!mediaQueryIsScreen(query)) return false
  if (/prefers-reduced-motion\s*:\s*no-preference/i.test(query) && reduced) return false
  if (/prefers-reduced-motion\s*:\s*reduce/i.test(query) && !reduced) return false
  const minimums = [...query.matchAll(/min-width\s*:\s*(\d+(?:\.\d+)?)px/gi)].map(match => Number(match[1]))
  const maximums = [...query.matchAll(/max-width\s*:\s*(\d+(?:\.\d+)?)px/gi)].map(match => Number(match[1]))
  const exacts = [...query.matchAll(/(?:^|[\s(])width\s*:\s*(\d+(?:\.\d+)?)px/gi)].map(match => Number(match[1]))
  const directRanges = [...query.matchAll(/\bwidth\s*(<=|>=|<|>)\s*(\d+(?:\.\d+)?)px/gi)]
  const reverseRanges = [...query.matchAll(/(\d+(?:\.\d+)?)px\s*(<=|>=|<|>)\s*width\b/gi)]
  const reverseOperator = { '<': '>', '<=': '>=', '>': '<', '>=': '<=' }
  return minimums.every(minimum => width >= minimum)
    && maximums.every(maximum => width <= maximum)
    && exacts.every(exact => width === exact)
    && directRanges.every(match => widthComparison(width, match[1], Number(match[2])))
    && reverseRanges.every(match => widthComparison(width, reverseOperator[match[2]], Number(match[1])))
}
const mediaMatchesScreen = (conditions, width, reduced) => conditions.every(condition => splitTopLevel(condition, ',').some(query => mediaQueryMatchesScreen(query, width, reduced)))
const representativeScreenWidths = (...stylesheets) => {
  const thresholds = [...new Set(stylesheets.flat().flatMap(rule => rule.media.flatMap(condition => splitTopLevel(condition, ',')))
    .filter(mediaQueryIsScreen)
    .flatMap(query => [...query.matchAll(/(\d+(?:\.\d+)?)px/gi)].map(match => Number(match[1]))))]
    .filter(threshold => Number.isFinite(threshold) && threshold > 0 && threshold <= Number.MAX_SAFE_INTEGER)
    .sort((left, right) => left - right)
  const widths = new Set([375, 767, 768, 1440])
  const add = candidate => { if (Number.isFinite(candidate) && candidate > 0 && candidate <= Number.MAX_SAFE_INTEGER) widths.add(candidate) }
  for (const threshold of thresholds) {
    const delta = Math.max(0.01, Math.abs(threshold) * Number.EPSILON * 8)
    for (const candidate of [threshold - 1, threshold - delta, threshold, threshold + delta, threshold + 1]) add(candidate)
  }
  for (let index = 1; index < thresholds.length; index += 1) add(thresholds[index - 1] + (thresholds[index] - thresholds[index - 1]) / 2)
  return [...widths].sort((left, right) => left - right)
}
const allScreenWidths = representativeScreenWidths(...surfaces)
const selectorCompounds = selector => {
  const compounds = []
  let start = 0
  let quote = ''
  let escaped = false
  let depth = 0
  const push = end => {
    const value = selector.slice(start, end).trim()
    if (value) compounds.push(value)
  }
  for (let index = 0; index < selector.length; index += 1) {
    const character = selector[index]
    if (escaped) { escaped = false; continue }
    if (quote) {
      if (character === '\\') escaped = true
      else if (character === quote) quote = ''
      continue
    }
    if (character === '"' || character === "'") quote = character
    else if (character === '(' || character === '[') depth += 1
    else if (character === ')' || character === ']') depth -= 1
    else if (depth === 0 && (/\s/.test(character) || /[>+~]/.test(character))) { push(index); start = index + 1 }
  }
  push(selector.length)
  return compounds
}
const compoundTokens = compound => [...compound.matchAll(/(?:^|(?<=[^\w-]))(?:[a-z][\w-]*|[.#:][\w-]+|\[[^\]]+\])/gi)].map(match => match[0])
const selectorTargetsContract = (selector, target) => {
  const candidateCompounds = selectorCompounds(selector)
  const targetCompounds = selectorCompounds(target)
  if (candidateCompounds.length < targetCompounds.length) return false
  const offset = candidateCompounds.length - targetCompounds.length
  return targetCompounds.every((compound, index) => {
    const candidateTokens = new Set(compoundTokens(candidateCompounds[offset + index]))
    return compoundTokens(compound).every(token => candidateTokens.has(token))
  })
}
const assertNoContextualOverrides = (stylesheet, selector, properties, message, widths) => {
  for (const width of widths) for (const reduced of [false, true]) for (const rule of stylesheet) {
    if (!mediaMatchesScreen(rule.media, width, reduced)) continue
    const conflicting = rule.selectors.filter(candidate => normalizeSelector(candidate) !== normalizeSelector(selector) && selectorTargetsContract(candidate, selector))
    const guarded = rule.declarations.filter(declaration => properties.includes(declaration.property))
    assert.ok(conflicting.length === 0 || guarded.length === 0, `${message} at ${width}px: contextual selector ${conflicting.join(', ')} writes ${guarded.map(declaration => declaration.property).join(', ')}`)
  }
}
const fontSizeFromShorthand = value => value.match(/(?:^|\s)(var\([^)]*\)|(?:\d*\.)?\d+(?:px|rem|em|%|vw|vh)|xx-small|x-small|small|medium|large|x-large|xx-large|smaller|larger)(?:\s*\/|\s|$)/i)?.[1] || value
const effectiveValue = (stylesheet, selector, property, width, reduced) => {
  let winner
  const apply = declaration => {
    if (!winner || Number(declaration.important) > Number(winner.important) || (declaration.important === winner.important && declaration.order > winner.order)) winner = declaration
  }
  for (const rule of stylesheet) {
    if (!rule.selectors.some(candidate => normalizeSelector(candidate) === normalizeSelector(selector)) || !mediaMatchesScreen(rule.media, width, reduced)) continue
    for (const declaration of rule.declarations) {
      if (declaration.property === property) apply(declaration)
      else if (property === 'font-size' && declaration.property === 'font') apply({ ...declaration, property, value: fontSizeFromShorthand(declaration.value) })
    }
  }
  return winner?.value.trim()
}
const assertMapping = (stylesheet, selector, property, expected, message, widths = allScreenWidths) => {
  assertNoContextualOverrides(stylesheet, selector, property === 'font-size' ? ['font', 'font-size'] : [property], message, widths)
  for (const width of widths) for (const reduced of [false, true]) assert.equal(effectiveValue(stylesheet, selector, property, width, reduced), expected, `${message} at ${width}px with reduced motion ${reduced}`)
}
const assertMinimumControl = (stylesheet, selector, property, message, widths = allScreenWidths) => {
  assertNoContextualOverrides(stylesheet, selector, property === 'min-height' ? ['height', 'min-height'] : ['min-width', 'width'], message, widths)
  for (const width of widths) {
    for (const reduced of [false, true]) {
      const value = effectiveValue(stylesheet, selector, property, width, reduced)
      const pixels = value === 'var(--control-min-size)' ? 44 : Number(value?.match(/^(\d+(?:\.\d+)?)px$/)?.[1])
      assert.ok(Number.isFinite(pixels) && pixels >= 44, `${message} at ${width}px with reduced motion ${reduced}; found ${JSON.stringify(value)}`)
    }
  }
}
const assertNoTypographyScaling = (stylesheet, selector, widths = allScreenWidths) => {
  for (const width of widths) for (const reduced of [false, true]) for (const rule of stylesheet) {
    if (!mediaMatchesScreen(rule.media, width, reduced) || !rule.selectors.some(candidate => selectorTargetsContract(candidate, selector))) continue
    for (const declaration of rule.declarations) {
      assert.notEqual(declaration.property, 'zoom', `${selector} must not resize typography with zoom through ${rule.selectors.join(', ')} at ${width}px`)
      if (declaration.property === 'transform') assert.doesNotMatch(declaration.value, /\bscale(?:x|y|3d)?\s*\(/i, `${selector} must not resize typography with transform scale through ${rule.selectors.join(', ')} at ${width}px`)
    }
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
  const mobileWidths = allScreenWidths.filter(width => width <= 767)
  const desktopWidths = allScreenWidths.filter(width => width >= 768)
  assertMapping(publicShell, '.public-brand', 'font-size', 'var(--font-size-subtitle)', 'public brand uses subtitle text')
  assertMapping(publicShell, '.public-hero h1', 'font-size', 'var(--font-size-hero)', 'desktop hero uses the hero token', desktopWidths)
  assertMapping(publicShell, '.public-lead', 'font-size', 'var(--font-size-subtitle)', 'lead copy uses the subtitle token')
  assertMapping(publicShell, '.public-eyebrow', 'font-size', 'var(--font-size-sm)', 'eyebrows use the small token')
  assertMapping(publicContent, '.public-content-section__heading h2', 'font-size', 'var(--font-size-section-title)', 'public section headings use the section-title token')
  assertMapping(publicShell, '.public-hero h1', 'font-size', 'var(--font-size-hero-mobile)', 'mobile hero uses the hero-mobile token', mobileWidths)
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
  const mobileWidths = allScreenWidths.filter(width => width <= 767)
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
    for (const selector of typographySelectors) assertNoTypographyScaling(stylesheet, selector)
  }

  assertMapping(tokens, 'html:root', '--control-min-size', '44px', 'shared controls retain a 44px minimum')
  assertMinimumControl(publicShell, '.public-locale', 'min-height', 'public header controls keep the shared touch target')
  assertMinimumControl(publicShell, '.public-button', 'min-height', 'public actions keep the shared touch target')
  assertMinimumControl(consoleShell, '.user-trigger', 'min-height', 'console user control keeps the shared touch target')
  for (const selector of ['.pricing-pagination button', '.pricing-pagination select', '.pricing-detail-back', '.pricing-console-cta']) assertMinimumControl(publicPricing, selector, 'min-height', `${selector} keeps a 44px target`)
  assertMinimumControl(publicPricing, '.pricing-filter-toggle', 'min-height', 'mobile pricing filter keeps a 44px target', mobileWidths)
  assertMinimumControl(publicPricing, '.pricing-drawer > header button', 'min-width', 'mobile drawer close control keeps a 44px width', mobileWidths)
  assertMinimumControl(publicPricing, '.pricing-drawer > header button', 'min-height', 'mobile drawer close control keeps a 44px height', mobileWidths)
})
