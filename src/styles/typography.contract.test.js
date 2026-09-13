import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
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

const collectProductionSources = (directory = new URL('../', import.meta.url)) => readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
  const url = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory)
  const file = decodeURIComponent(url.pathname)
  if (/(?:^|\/)(?:__tests__|fixtures?|test-fixtures)(?:\/|$)|\.(?:test|spec)\.[^/]+$/i.test(file)) return []
  if (entry.isDirectory()) return collectProductionSources(url)
  return /\.(?:css|scss|vue)$/i.test(entry.name) ? [{ file, source: readFileSync(url, 'utf8') }] : []
})
const collectSiteStyleSources = (directory = new URL('../', import.meta.url)) => collectProductionSources(directory).flatMap(({ file, source }) => {
  if (/\.(?:css|scss)$/i.test(file)) return [{ file, source }]
  return [...source.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi)].map((match, index) => ({ file: `${file}#style-${index + 1}`, source: match[1] }))
})
const readMarkupTag = (source, start) => {
  if (source.startsWith('<!--', start)) {
    const end = source.indexOf('-->', start + 4)
    return { start, end: end < 0 ? source.length : end + 3, comment: true }
  }
  let cursor = start + 1
  let quote = ''
  while (cursor < source.length) {
    const character = source[cursor]
    if (quote) { if (character === quote && source[cursor - 1] !== '\\') quote = '' }
    else if (character === '"' || character === "'") quote = character
    else if (character === '>') break
    cursor += 1
  }
  const raw = source.slice(start + 1, cursor)
  const match = raw.match(/^\s*(\/?)\s*([\w.-]+)/)
  return { start, end: Math.min(cursor + 1, source.length), closing: Boolean(match?.[1]), name: match?.[2], attrs: match ? raw.slice(match[0].length) : '', selfClosing: /\/\s*$/.test(raw) }
}
const staticAttribute = (attrs, name) => attrs.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*(["'])(.*?)\\1`, 'i'))?.[2]
const typographyEvidenceFromVue = (files = collectProductionSources()) => {
  const evidence = new Set(['html', ':root', 'body', '#app'])
  const voidElements = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'])
  const vueFiles = files.filter(entry => entry.file.endsWith('.vue'))
  const sourceRoot = vueFiles.map(entry => entry.file.match(/^(.*\/src)(?:\/|$)/)?.[1]).find(Boolean)
  const componentKey = name => name.replace(/-/g, '').toLowerCase()
  const addNode = node => {
    if (node.name !== 'template') evidence.add(node.name.toLowerCase())
    for (const className of node.classes) evidence.add(`.${className}`)
    if (node.id) evidence.add(`#${node.id}`)
  }
  const graphs = new Map()
  for (const { file, source } of vueFiles) {
    const imports = new Map()
    for (const match of source.matchAll(/\bimport\s+([A-Za-z_$][\w$]*)\s+from\s*(["'])([^"']+\.vue)\2/g)) {
      const target = match[3].startsWith('@/') && sourceRoot ? resolve(sourceRoot, match[3].slice(2)) : resolve(dirname(file), match[3])
      imports.set(componentKey(match[1]), target)
    }
    const nodes = []
    const opening = /<template\b[^>]*>/i.exec(source)
    if (opening) {
      const stack = []
      let cursor = opening.index + opening[0].length
      let textStart = cursor
      while (cursor < source.length) {
        const start = source.indexOf('<', cursor)
        if (start < 0) break
        if (stack.length && /\S/.test(source.slice(textStart, start))) stack.at(-1).typography = true
        const tag = readMarkupTag(source, start)
        cursor = tag.end
        textStart = cursor
        if (tag.comment || !tag.name) continue
        const name = tag.name.toLowerCase()
        if (tag.closing) {
          if (name === 'template' && stack.length === 0) break
          stack.pop()
          continue
        }
        const classes = (staticAttribute(tag.attrs, 'class') || '').split(/\s+/).filter(Boolean)
        const dynamicTypography = ['routerview', 'router-view', 'slot'].includes(name)
          || (name === 'component' && /(?:^|\s):is\s*=/.test(tag.attrs))
        const node = { name, classes, id: staticAttribute(tag.attrs, 'id'), parent: stack.at(-1), typography: /(?:^|\s)(?:v-html|v-text)(?:\s|=|$)/i.test(tag.attrs) || dynamicTypography }
        nodes.push(node)
        if (!tag.selfClosing && !voidElements.has(name)) stack.push(node)
      }
    }
    graphs.set(file, { imports, nodes })
    if (/(?:^|\/)(?:App|AuthApp|[^/]*Layout)\.vue$/.test(file) && /\b(?:RouterView|router-view)\b/.test(source)) {
      for (const match of source.matchAll(/\bclass\s*:\s*(["'])(.*?)\1/g)) for (const name of match[2].split(/\s+/).filter(Boolean)) evidence.add(`.${name}`)
      for (const match of source.matchAll(/\bid\s*:\s*(["'])(.*?)\1/g)) evidence.add(`#${match[2]}`)
    }
  }
  // A memoized fixed point propagates text through arbitrary component depth while pure cycles settle at false.
  // Missing local Vue targets stay conservative because their rendering cannot be inspected.
  const renderMemo = new Map([...graphs].map(([file, graph]) => [file, graph.nodes.some(node => node.typography)]))
  let changed = true
  while (changed) {
    changed = false
    for (const [file, graph] of graphs) {
      if (renderMemo.get(file)) continue
      const renders = graph.nodes.some(node => {
        const child = graph.imports.get(componentKey(node.name))
        return child ? !graphs.has(child) || renderMemo.get(child) : false
      })
      if (renders) { renderMemo.set(file, true); changed = true }
    }
  }
  const componentRendersTypography = file => !graphs.has(file) || renderMemo.get(file)
  for (const graph of graphs.values()) for (const node of graph.nodes) {
    const child = graph.imports.get(componentKey(node.name))
    if (!node.typography && !(child && componentRendersTypography(child))) continue
    for (let current = node; current; current = current.parent) addNode(current)
  }
  return evidence
}
const nestedStyleDeclarations = source => {
  const declarations = []
  const clean = source.replace(/\/\*[\s\S]*?\*\//g, '')
  const parseScope = (start, contexts) => {
    let statementStart = start
    let cursor = start
    let quote = ''
    let escaped = false
    let parentheses = 0
    const record = end => {
      const statement = clean.slice(statementStart, end).trim()
      const match = statement.match(/^((?:--|\$)?[\w-]+)\s*:\s*([\s\S]+)$/)
      if (match) declarations.push({ property: match[1].startsWith('$') || match[1].startsWith('--') ? match[1] : match[1].toLowerCase(), value: match[2].trim(), contexts })
    }
    while (cursor < clean.length) {
      const character = clean[cursor]
      if (escaped) escaped = false
      else if (quote) { if (character === '\\') escaped = true; else if (character === quote) quote = '' }
      else if (character === '"' || character === "'") quote = character
      else if (character === '(' || character === '[') parentheses += 1
      else if (character === ')' || character === ']') parentheses -= 1
      else if (parentheses === 0 && character === ';') { record(cursor); statementStart = cursor + 1 }
      else if (parentheses === 0 && character === '{') {
        const header = clean.slice(statementStart, cursor).trim()
        cursor = parseScope(cursor + 1, contexts.concat(header))
        statementStart = cursor
        continue
      } else if (parentheses === 0 && character === '}') { record(cursor); return cursor + 1 }
      cursor += 1
    }
    record(cursor)
    return cursor
  }
  parseScope(0, [])
  return declarations
}
const normalizedStyleContext = contexts => contexts.filter(context => !context.startsWith('@')).map(context => context.replace(/\s+/g, ' ').trim()).join(' ')
const effectiveStyleSelectors = contexts => contexts.filter(context => !context.startsWith('@')).reduce((parents, context) => {
  const children = splitTopLevel(context, ',')
  return parents.flatMap(parent => children.map(child => child.includes('&') ? child.replaceAll('&', parent) : parent ? `${parent} ${child}` : child))
}, ['']).map(selector => normalizeSelector(selector))
const selectorTargetsTypography = (selector, evidence) => {
  const compounds = selectorCompounds(selector)
  const rightmost = compounds.at(-1) || ''
  const tokens = compoundTokens(rightmost)
  const identities = tokens.filter(token => /^[.#]/.test(token) && !token.startsWith(':'))
  if (identities.length ? identities.some(token => evidence.has(token.toLowerCase())) : tokens.some(token => evidence.has(token.toLowerCase()))) return true
  return /(^|[^\w-])\*/.test(rightmost) && (compounds.length === 1 || compounds.slice(0, -1).some(compound => compoundTokens(compound).some(token => evidence.has(token.toLowerCase()))))
}
const scopeHeaders = declaration => declaration.contexts.filter(context => !context.startsWith('@')).map(context => normalizeSelector(context))
const scopeContains = (outer, inner) => outer.length <= inner.length && outer.every((value, index) => value === inner[index])
const cssVariableCandidates = (name, declaration, declarations) => declarations.filter(candidate => candidate.property === name && (
  (candidate.file === declaration.file && scopeContains(scopeHeaders(candidate), scopeHeaders(declaration)))
  || effectiveStyleSelectors(candidate.contexts).some(candidateSelector => /^(?::root|html|body|#app)$/.test(candidateSelector)
    || effectiveStyleSelectors(declaration.contexts).some(selector => selector === candidateSelector || selector.startsWith(`${candidateSelector} `)))
)).map(candidate => candidate.value)
const sassVariableCandidates = (name, declaration, declarations) => declarations.filter(candidate => candidate.file === declaration.file && candidate.property === name && scopeContains(scopeHeaders(candidate), scopeHeaders(declaration))).map(candidate => candidate.value)
const variableReference = value => {
  const sass = /\$[A-Za-z_-][\w-]*/g
  const sassMatch = sass.exec(value)
  const varStart = value.search(/\bvar\s*\(/i)
  if (sassMatch && (varStart < 0 || sassMatch.index < varStart)) return { start: sassMatch.index, end: sassMatch.index + sassMatch[0].length, name: sassMatch[0], fallback: undefined }
  if (varStart < 0) return undefined
  const open = value.indexOf('(', varStart)
  let depth = 1
  let cursor = open + 1
  let quote = ''
  for (; cursor < value.length && depth > 0; cursor += 1) {
    const character = value[cursor]
    if (quote) { if (character === quote && value[cursor - 1] !== '\\') quote = '' }
    else if (character === '"' || character === "'") quote = character
    else if (character === '(') depth += 1
    else if (character === ')') depth -= 1
  }
  if (depth !== 0) return { start: varStart, end: value.length, unresolved: true }
  const [name, ...fallback] = splitTopLevel(value.slice(open + 1, cursor - 1), ',')
  return { start: varStart, end: cursor, name: name?.trim(), fallback: fallback.length ? fallback.join(',').trim() : undefined }
}
const resolvedTransformValues = (value, declaration, declarations, resolving = new Set()) => {
  const reference = variableReference(value)
  if (!reference) return [value]
  if (reference.unresolved || !reference.name || resolving.has(reference.name)) return [undefined]
  const candidates = reference.name.startsWith('$') ? sassVariableCandidates(reference.name, declaration, declarations) : cssVariableCandidates(reference.name, declaration, declarations)
  if (candidates.length === 0) return [undefined]
  const replacements = reference.fallback === undefined ? candidates : candidates.concat(reference.fallback)
  return replacements.flatMap(replacement => resolvedTransformValues(replacement, declaration, declarations, new Set(resolving).add(reference.name)))
    .flatMap(replacement => replacement === undefined ? [undefined] : resolvedTransformValues(`${value.slice(0, reference.start)}${replacement}${value.slice(reference.end)}`, declaration, declarations, resolving))
}
const assertTypographyScalingPolicy = (styleSources, evidence) => {
  const declarations = styleSources.flatMap(style => nestedStyleDeclarations(style.source).map(declaration => ({ ...declaration, file: style.file })))
  for (const declaration of declarations) {
    const targetsTypography = effectiveStyleSelectors(declaration.contexts).some(selector => selectorTargetsTypography(selector, evidence))
    if (!targetsTypography) continue
    if (declaration.property === 'zoom') assert.fail(`zoom is forbidden on typography in ${declaration.file} (${normalizedStyleContext(declaration.contexts) || 'root'})`)
    if (/(?:^|-)transform$/.test(declaration.property)) {
      const resolved = resolvedTransformValues(declaration.value, declaration, declarations)
      assert.ok(resolved.length > 0 && resolved.every(value => value !== undefined), `transform variables must resolve on typography in ${declaration.file} (${normalizedStyleContext(declaration.contexts) || 'root'})`)
      for (const value of resolved) assert.doesNotMatch(value, /\bscale(?:x|y|3d)?\s*\(/i, `transform scale is forbidden on typography in ${declaration.file} (${normalizedStyleContext(declaration.contexts) || 'root'})`)
    }
  }
}

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
const compoundTokens = compound => [...compound.matchAll(/[.#:][\w-]+|\[[^\]]+\]|(?:^|(?<=[^\w.#:-]))[a-z][\w-]*/gi)].map(match => match[0])
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
  assertTypographyScalingPolicy(collectSiteStyleSources(), typographyEvidenceFromVue())

  assertMapping(tokens, 'html:root', '--control-min-size', '44px', 'shared controls retain a 44px minimum')
  assertMinimumControl(publicShell, '.public-locale', 'min-height', 'public header controls keep the shared touch target')
  assertMinimumControl(publicShell, '.public-button', 'min-height', 'public actions keep the shared touch target')
  assertMinimumControl(consoleShell, '.user-trigger', 'min-height', 'console user control keeps the shared touch target')
  for (const selector of ['.pricing-pagination button', '.pricing-pagination select', '.pricing-detail-back', '.pricing-console-cta']) assertMinimumControl(publicPricing, selector, 'min-height', `${selector} keeps a 44px target`)
  assertMinimumControl(publicPricing, '.pricing-filter-toggle', 'min-height', 'mobile pricing filter keeps a 44px target', mobileWidths)
  assertMinimumControl(publicPricing, '.pricing-drawer > header button', 'min-width', 'mobile drawer close control keeps a 44px width', mobileWidths)
  assertMinimumControl(publicPricing, '.pricing-drawer > header button', 'min-height', 'mobile drawer close control keeps a 44px height', mobileWidths)
})
