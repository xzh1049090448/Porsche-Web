import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vuePlugin from '@vitejs/plugin-vue'
import { messages } from '../../i18n/messages.js'
import { publicText } from '../../i18n/public-runtime.js'
import { formatPublicPrice, mapPublicModel, PUBLIC_PRICING } from '../../utils/public-catalog.js'
import { publicPriceState } from '../../utils/public-pricing-query.js'

const read = path => readFile(new URL(path, import.meta.url), 'utf8')
const vueCompiler = (() => {
  const plugin = vuePlugin()
  plugin.buildStart()
  return plugin.api.options.compiler
})()
const parseVue = (value, label = 'pricing Vue component') => {
  const parsed = vueCompiler.parse(value, { filename: label })
  assert.deepEqual(parsed.errors, [], `${label} must parse cleanly: ${parsed.errors.map(String).join('; ')}`)
  return parsed.descriptor
}
const splitCssTopLevel = (value, delimiter) => {
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
const parseDeclarations = (body, nextOrder) => splitCssTopLevel(body, ';').flatMap(entry => {
  const separator = splitCssTopLevel(entry, ':')
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
      else if (!header.startsWith('@')) rules.push({ selectors: splitCssTopLevel(header, ','), declarations: parseDeclarations(body, () => declarationOrder++), media })
    }
  }
  parseScope(clean)
  return rules
}
const styleRoot = (source, sfc = false) => parseCssRules(sfc ? parseVue(source).styles.map(style => style.content).join('\n') : source)
const templateAst = source => parseVue(source).template?.ast || { children: [] }
const staticBindingInitializers = value => {
  const bindings = new Map()
  const descriptor = parseVue(value)
  for (const block of [descriptor.script, descriptor.scriptSetup].filter(Boolean)) {
    let ast
    try { ast = vueCompiler.babelParse(block.content, { sourceType: 'module', plugins: ['typescript'] }) }
    catch (error) { throw new Error(`pricing Vue script must parse cleanly: ${error.message}`, { cause: error }) }
    for (const statement of ast.program.body) {
      const node = statement.type === 'ExportNamedDeclaration' ? statement.declaration : statement
      if (node?.type === 'VariableDeclaration' && node.kind === 'const') for (const declaration of node.declarations) {
        if (declaration.id.type !== 'Identifier' || !declaration.init) continue
        if (!bindings.has(declaration.id.name)) bindings.set(declaration.id.name, [])
        bindings.get(declaration.id.name).push(declaration.init)
      }
    }
  }
  return bindings
}
const unwrapExpression = node => {
  while (node && ['ParenthesizedExpression', 'TSAsExpression', 'TSTypeAssertion', 'TSNonNullExpression', 'TypeCastExpression'].includes(node.type)) node = node.expression
  return node
}
const staticPropertyKey = node => {
  node = unwrapExpression(node)
  if (node?.type === 'Identifier') return node.name
  if (node?.type === 'StringLiteral' || node?.type === 'NumericLiteral') return String(node.value)
  return undefined
}
const memberReference = node => {
  node = unwrapExpression(node)
  const path = []
  while (node?.type === 'MemberExpression' || node?.type === 'OptionalMemberExpression') {
    const key = node.computed ? staticPropertyKey(node.property) : node.property?.name
    if (key === undefined) return undefined
    path.unshift(key)
    node = unwrapExpression(node.object)
  }
  return node?.type === 'Identifier' ? { name: node.name, path } : undefined
}
const staticExpressionPossibilities = (node, bindings, resolving = new Set()) => {
  node = unwrapExpression(node)
  if (node?.type === 'StringLiteral' || node?.type === 'NumericLiteral' || node?.type === 'BooleanLiteral') return [node.value]
  if (node?.type === 'NullLiteral') return [null]
  if (node?.type === 'Identifier') return bindingPossibilities(node.name, [], bindings, resolving)
  if (node?.type === 'MemberExpression' || node?.type === 'OptionalMemberExpression') {
    const reference = memberReference(node)
    return reference ? bindingPossibilities(reference.name, reference.path, bindings, resolving) : []
  }
  if (node?.type === 'BinaryExpression' && node.operator === '+') {
    const left = staticExpressionPossibilities(node.left, bindings, resolving)
    const right = staticExpressionPossibilities(node.right, bindings, resolving)
    return left.flatMap(leftValue => right.map(rightValue => leftValue + rightValue))
  }
  if (node?.type === 'ConditionalExpression') return [node.consequent, node.alternate].flatMap(branch => staticExpressionPossibilities(branch, bindings, resolving))
  if (node?.type === 'LogicalExpression') return [node.left, node.right].flatMap(branch => staticExpressionPossibilities(branch, bindings, resolving))
  if (node?.type === 'SequenceExpression') return staticExpressionPossibilities(node.expressions.at(-1), bindings, resolving)
  if (node?.type === 'CallExpression' || node?.type === 'OptionalCallExpression' || node?.type === 'NewExpression') return node.arguments.flatMap(argument => staticExpressionPossibilities(argument, bindings, resolving))
  if (node?.type === 'TemplateLiteral') {
    let values = ['']
    for (let index = 0; index < node.quasis.length; index += 1) {
      values = values.map(value => value + (node.quasis[index].value.cooked ?? node.quasis[index].value.raw))
      if (index < node.expressions.length) {
        const inserts = staticExpressionPossibilities(node.expressions[index], bindings, resolving)
        if (!inserts.length) return []
        values = values.flatMap(value => inserts.map(insert => value + insert))
      }
    }
    return values
  }
  return []
}
const bindingPossibilities = (name, path, bindings, resolving = new Set()) => {
  const resolution = `${name}.${path.join('.')}`
  if (resolving.has(resolution)) return []
  const next = new Set(resolving).add(resolution)
  return (bindings.get(name) || []).flatMap(initializer => possibilitiesAtPath(initializer, path, bindings, next))
}
const possibilitiesAtPath = (node, path, bindings, resolving) => {
  node = unwrapExpression(node)
  if (!node) return []
  if (node.type === 'Identifier') return bindingPossibilities(node.name, path, bindings, resolving)
  if (node.type === 'ConditionalExpression' || node.type === 'LogicalExpression') return [node.consequent || node.left, node.alternate || node.right].flatMap(branch => possibilitiesAtPath(branch, path, bindings, resolving))
  if (node.type === 'SequenceExpression') return possibilitiesAtPath(node.expressions.at(-1), path, bindings, resolving)
  if (!path.length) return staticExpressionPossibilities(node, bindings, resolving)
  if (node.type === 'ObjectExpression') {
    const [head, ...tail] = path
    return node.properties.flatMap(property => {
      if (property.type === 'SpreadElement') return possibilitiesAtPath(property.argument, path, bindings, resolving)
      const key = property.computed ? staticPropertyKey(property.key) : staticPropertyKey(property.key)
      return key === head ? possibilitiesAtPath(property.value, tail, bindings, resolving) : []
    })
  }
  if (node.type === 'ArrayExpression') {
    const [head, ...tail] = path
    return /^\d+$/.test(head) && node.elements[Number(head)] ? possibilitiesAtPath(node.elements[Number(head)], tail, bindings, resolving) : []
  }
  if (node.type === 'CallExpression' || node.type === 'OptionalCallExpression' || node.type === 'NewExpression') {
    const remaining = path[0] === 'value' ? path.slice(1) : path
    return node.arguments.flatMap(argument => possibilitiesAtPath(argument, remaining, bindings, resolving))
  }
  const reference = memberReference(node)
  return reference ? bindingPossibilities(reference.name, reference.path.concat(path), bindings, resolving) : []
}
const referencedBindingLeaves = (name, path, bindings, resolving = new Set()) => {
  const resolution = `${name}.${path.join('.')}`
  if (resolving.has(resolution)) return []
  const next = new Set(resolving).add(resolution)
  return (bindings.get(name) || []).flatMap(initializer => leavesAtPath(initializer, path, bindings, next))
}
const leavesAtPath = (node, path, bindings, resolving) => {
  node = unwrapExpression(node)
  if (!node) return []
  if (node.type === 'Identifier') return referencedBindingLeaves(node.name, path, bindings, resolving)
  if (node.type === 'ConditionalExpression' || node.type === 'LogicalExpression') return [node.consequent || node.left, node.alternate || node.right].flatMap(branch => leavesAtPath(branch, path, bindings, resolving))
  if (node.type === 'SequenceExpression') return leavesAtPath(node.expressions.at(-1), path, bindings, resolving)
  if (!path.length) return staticLiteralLeaves(node, bindings, resolving)
  if (node.type === 'ObjectExpression') {
    const [head, ...tail] = path
    return node.properties.flatMap(property => {
      if (property.type === 'SpreadElement') return leavesAtPath(property.argument, path, bindings, resolving)
      const key = staticPropertyKey(property.key)
      return key === head ? leavesAtPath(property.value, tail, bindings, resolving) : []
    })
  }
  if (node.type === 'ArrayExpression') {
    const [head, ...tail] = path
    return /^\d+$/.test(head) && node.elements[Number(head)] ? leavesAtPath(node.elements[Number(head)], tail, bindings, resolving) : []
  }
  if (node.type === 'CallExpression' || node.type === 'OptionalCallExpression' || node.type === 'NewExpression') {
    const remaining = path[0] === 'value' ? path.slice(1) : path
    return node.arguments.flatMap(argument => leavesAtPath(argument, remaining, bindings, resolving))
  }
  const reference = memberReference(node)
  return reference ? referencedBindingLeaves(reference.name, reference.path.concat(path), bindings, resolving) : []
}
const staticLiteralLeaves = (node, bindings, resolving = new Set()) => {
  node = unwrapExpression(node)
  if (!node) return []
  const combined = staticExpressionPossibilities(node, bindings, resolving).filter(value => typeof value === 'string' && value)
  if (node.type === 'Identifier') return combined.concat(referencedBindingLeaves(node.name, [], bindings, resolving))
  if (node.type === 'MemberExpression' || node.type === 'OptionalMemberExpression') {
    const reference = memberReference(node)
    return combined.concat(reference ? referencedBindingLeaves(reference.name, reference.path, bindings, resolving) : [])
  }
  if (node.type === 'BinaryExpression' && node.operator === '+') return combined.length ? combined : staticLiteralLeaves(node.left, bindings, resolving).concat(staticLiteralLeaves(node.right, bindings, resolving))
  if (node.type === 'TemplateLiteral') return combined.length ? combined : node.expressions.flatMap(expression => staticLiteralLeaves(expression, bindings, resolving))
  if (node.type === 'CallExpression' || node.type === 'OptionalCallExpression' || node.type === 'NewExpression') return combined.concat(node.arguments.flatMap(argument => staticLiteralLeaves(argument, bindings, resolving)))
  if (node.type === 'ObjectExpression') return combined.concat(node.properties.flatMap(property => property.type === 'SpreadElement' ? staticLiteralLeaves(property.argument, bindings, resolving) : staticLiteralLeaves(property.value, bindings, resolving)))
  if (node.type === 'ArrayExpression') return combined.concat(node.elements.flatMap(element => staticLiteralLeaves(element, bindings, resolving)))
  if (node.type === 'ConditionalExpression') return combined.concat(staticLiteralLeaves(node.consequent, bindings, resolving), staticLiteralLeaves(node.alternate, bindings, resolving))
  if (node.type === 'LogicalExpression') return combined.concat(staticLiteralLeaves(node.left, bindings, resolving), staticLiteralLeaves(node.right, bindings, resolving))
  if (node.type === 'TaggedTemplateExpression') return combined.concat(staticLiteralLeaves(node.quasi, bindings, resolving))
  if (node.type === 'SequenceExpression') return combined.concat(staticLiteralLeaves(node.expressions.at(-1), bindings, resolving))
  if (node.type === 'UnaryExpression' || node.type === 'AwaitExpression') return combined.concat(staticLiteralLeaves(node.argument, bindings, resolving))
  return combined
}
const literalExpressionStrings = (expression, bindings) => {
  let ast
  try { ast = vueCompiler.babelParse(`(${expression})`, { sourceType: 'module', plugins: ['typescript'] }).program.body[0]?.expression }
  catch (error) { throw new Error(`visible Vue expression must parse cleanly: ${error.message}`, { cause: error }) }
  return [...new Set(staticLiteralLeaves(ast, bindings))]
}
const visibleStrings = source => {
  const values = []
  const bindings = staticBindingInitializers(source)
  const visibleAttributes = new Set(['alt', 'aria-label', 'placeholder', 'title'])
  const visit = node => {
    if (node.type === 2 && node.content.trim()) values.push(node.content.trim())
    if (node.type === 5) values.push(...literalExpressionStrings(node.content.content, bindings))
    if (node.type === 1) for (const prop of node.props) {
      if (prop.type === 6 && visibleAttributes.has(prop.name) && prop.value?.content) values.push(prop.value.content)
      const visibleBinding = prop.type === 7 && prop.name === 'bind' && prop.arg?.type === 4 && prop.arg.isStatic && visibleAttributes.has(prop.arg.content)
      const visibleDirective = prop.type === 7 && ['text', 'html'].includes(prop.name)
      if ((visibleBinding || visibleDirective) && prop.exp?.content) values.push(...literalExpressionStrings(prop.exp.content, bindings))
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
const mediaAncestors = rule => rule.media
const exactRules = (root, selector, context = 'base') => {
  const matches = []
  for (const rule of root) {
    if (!rule.selectors?.map(value => value.trim()).includes(selector)) continue
    const media = mediaAncestors(rule)
    if (context === 'all' || (context === 'base' && media.length === 0) || (context instanceof RegExp && media.some(value => context.test(value)))) matches.push(rule)
  }
  return matches
}
const normalizeCssValue = value => value.replace(/\s+/g, ' ').replace(/\s*,\s*/g, ', ').trim()
const propertyMap = rules => {
  const result = new Map()
  for (const rule of rules) for (const node of rule.declarations) {
    const key = node.property
    if (!result.has(key)) result.set(key, [])
    result.get(key).push(normalizeCssValue(node.value))
  }
  return result
}
const mediaMatchesWidth = (conditions, width) => conditions.every(condition => splitCssTopLevel(condition, ',').some(query => {
  const minimums = [...query.matchAll(/min-width\s*:\s*(\d+(?:\.\d+)?)px/gi)].map(match => Number(match[1]))
  const maximums = [...query.matchAll(/max-width\s*:\s*(\d+(?:\.\d+)?)px/gi)].map(match => Number(match[1]))
  return minimums.every(minimum => width >= minimum) && maximums.every(maximum => width <= maximum)
}))
const rootSelectorSpecificity = selector => (selector.match(/#[\w-]+/g) || []).length * 100 + (selector.match(/\.[\w-]+|\[[^\]]+\]|:(?!:)[\w-]+/g) || []).length * 10 + (selector.match(/(?:^|[\s>+~])(?:[a-z][\w-]*|\*)/gi) || []).filter(token => !token.trim().endsWith('*')).length
const selectorTargetsRoot = (selector, targetClass) => {
  const compounds = selector.trim().split(/\s+|[>+~]/).filter(Boolean)
  const last = compounds.at(-1) || ''
  const classes = [...last.matchAll(/\.([\w-]+)/g)].map(match => match[1])
  if (!classes.includes(targetClass) || classes.some(name => name !== targetClass)) return false
  const remainder = last.replace(new RegExp(`\\.${targetClass}\\b`), '').replace(/^(?:table|div|\*)/i, '')
  return remainder === ''
}
const effectiveRootProperties = (rules, targetClass, width) => {
  const winners = new Map()
  for (const rule of rules) {
    if (!mediaMatchesWidth(rule.media, width)) continue
    const matching = rule.selectors.filter(selector => selectorTargetsRoot(selector, targetClass))
    if (!matching.length) continue
    const specificity = Math.max(...matching.map(rootSelectorSpecificity))
    for (const declaration of rule.declarations) {
      const previous = winners.get(declaration.property)
      const candidate = { ...declaration, specificity }
      if (!previous || Number(candidate.important) > Number(previous.important) || (candidate.important === previous.important && (candidate.specificity > previous.specificity || (candidate.specificity === previous.specificity && candidate.order > previous.order)))) winners.set(declaration.property, candidate)
    }
  }
  return new Map([...winners].map(([property, declaration]) => [property, normalizeCssValue(declaration.value).toLowerCase()]))
}
const rootIsHidden = properties => properties.get('display') === 'none' || ['hidden', 'collapse'].includes(properties.get('visibility')) || /^(?:0(?:\.0+)?|\.0+)$/.test(properties.get('opacity') || '')
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
const numericPerRequestOffer = /(?:(?:每(?:次)?请求|每请求|单次(?:请求|调用)|per[-\s]?request)[^.!。；;\n]{0,40}(?:[$¥￥]\s*\d|\d+(?:\.\d+)?\s*(?:USD|CNY|元|美元))|(?:[$¥￥]\s*\d|\d+(?:\.\d+)?\s*(?:USD|CNY|元|美元))[^.!。；;\n]{0,24}(?:每(?:次)?请求|每请求|单次(?:请求|调用)|per[-\s]?request)|(?:[$¥￥]\s*\d+(?:\.\d+)?|\d+(?:\.\d+)?\s*(?:USD|CNY))\s*\/\s*request)/i
const perRequestPriceClaim = /(?:单次调用价|每次请求(?:价格|价)|每请求(?:价格|价)|per[- ]request\s+(?:price|pricing))/gi
const locallyNegatedPerRequestClaim = (value, match) => {
  const before = value.slice(Math.max(0, match.index - 48), match.index)
  const after = value.slice(match.index + match[0].length, match.index + match[0].length + 48)
  const negativeBefore = /(?:\bno\s+|(?:不|未)\s*(?:单独\s*)?(?:提供|展示|显示|公布|采用|支持)\s*)$/iu.test(before)
  const negativeAfter = /^(?:\s*(?:(?:is|are)\s+)?(?:not|never)\s+(?:offered|provided|available|displayed|shown)\b|\s*(?:is|are)\s+unavailable\b|\s*(?:不|未)\s*(?:单独\s*)?(?:计价|定价|收费|提供|展示|显示|公布|可用)|\s*不可用)/iu.test(after)
  return negativeBefore || negativeAfter
}
const positivePerRequestClaims = value => [...value.matchAll(perRequestPriceClaim)]
  .filter(match => !locallyNegatedPerRequestClaim(value, match))
  .map(match => match[0])
const prototypePatterns = [
  [/ModelHub/i, 'prototype product name'],
  [/40\+|\b\d+\+?\s*(?:个\s*)?(?:模型|供应商)|\b\d+\+?\s*(?:models?|providers?)\b/i, 'hard-coded prototype model or provider count'],
  [/100%/i, 'prototype percentage claim'],
  [/MIT License/i, 'prototype license claim'],
  [/Tailwind\s+CDN/i, 'Tailwind CDN claim'],
  [/\d+(?:\.\d+)?\s*(?:x|×|倍)(?![\w-])/i, 'prototype multiplier'],
  [numericPerRequestOffer, 'numeric per-request price offer'],
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
  const responsiveCss = parseCssRules(`${parseVue(table).styles.map(style => style.content).join('\n')}\n${styles}`)
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
  for (const target of ['pricing-table-wrap', 'pricing-table']) assert.equal(rootIsHidden(effectiveRootProperties(responsiveCss, target, 1440)), false, `desktop .${target} root must remain visible at 1440px`)
  assert.equal(rootIsHidden(effectiveRootProperties(responsiveCss, 'pricing-table-wrap', 375)), true, 'mobile may hide the table root wrapper at 375px')
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
  const presentation = [page, detail, filters, table, cards].flatMap(visibleStrings).concat(pricingMessages)
  for (const [pattern, label] of prototypePatterns) for (const copy of presentation) assert.doesNotMatch(copy, pattern, label)
  for (const copy of presentation) assert.deepEqual(positivePerRequestClaims(copy), [], 'positive per-request pricing claim')
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
