import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vuePlugin from '@vitejs/plugin-vue'
import { messages } from '../../i18n/messages.js'
import { publicText } from '../../i18n/public-runtime.js'
import { formatPublicPrice, mapPublicModel, PUBLIC_PRICING } from '../../utils/public-catalog.js'
import { publicPriceState } from '../../utils/public-pricing-query.js'

const callableBodyEffect = (body, expressionEffect, staticCondition) => {
  const expressionPaths = (expression, normalKind = 'normal') => {
    const effect = expressionEffect(expression)
    if (effect === 'mustThrow') return [{ kind: 'throw' }]
    return effect === 'mayThrow' ? [{ kind: normalKind }, { kind: 'throw' }] : [{ kind: normalKind }]
  }
  const statements = (items, seed = [{ kind: 'normal' }]) => {
    let paths = seed
    for (const statement of items || []) paths = paths.flatMap(path => path.kind === 'normal' ? one(statement) : [path])
    return paths
  }
  const one = statement => {
    if (!statement) return [{ kind: 'normal' }]
    if (statement.type === 'BlockStatement') return statements(statement.body)
    if (statement.type === 'ReturnStatement') return expressionPaths(statement.argument, 'return')
    if (statement.type === 'ThrowStatement') return [{ kind: 'throw' }]
    if (statement.type === 'IfStatement') {
      const effect = expressionEffect(statement.test)
      const result = effect === 'mustThrow' ? [] : (() => {
        const condition = staticCondition(statement.test)
        return condition.known ? one(condition.value ? statement.consequent : statement.alternate) : [...one(statement.consequent), ...one(statement.alternate)]
      })()
      if (effect !== 'cannotThrow') result.push({ kind: 'throw' })
      return result
    }
    if (statement.type === 'TryStatement') {
      let paths = one(statement.block).flatMap(path => path.kind === 'throw' && statement.handler ? one(statement.handler.body) : [path])
      if (statement.finalizer) paths = paths.flatMap(path => one(statement.finalizer).flatMap(finalPath => finalPath.kind === 'normal' ? [path] : [finalPath]))
      return paths
    }
    if (statement.type === 'VariableDeclaration') return expressionPaths({ type: 'SequenceExpression', expressions: statement.declarations.map(item => item.init).filter(Boolean) })
    if (statement.type === 'ExpressionStatement') return expressionPaths(statement.expression)
    return [{ kind: 'normal' }]
  }
  const outcomes = body?.type === 'BlockStatement' ? statements(body.body) : expressionPaths(body, 'return')
  const throws = outcomes.some(path => path.kind === 'throw')
  const completes = outcomes.some(path => path.kind !== 'throw')
  return throws ? completes ? 'mayThrow' : 'mustThrow' : 'cannotThrow'
}

const read = path => readFile(new URL(path, import.meta.url), 'utf8')
const vueCompiler = (() => {
  const plugin = vuePlugin()
  plugin.buildStart()
  return plugin.api.options.compiler
})()
// This helper is intentionally mirrored in the public-pages contract: importing a *.test.js file would register its tests and alter the node:test harness.
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
const staticAttribute = (node, name) => node.props?.find(prop => prop.type === 6 && prop.name === name)?.value?.content
const hasClass = (node, name) => staticAttribute(node, 'class')?.split(/\s+/).includes(name)
const unknownStaticValue = Symbol('unknown static value')
const staticValue = node => {
  node = unwrapExpression(node)
  if (!node) return unknownStaticValue
  if (['BooleanLiteral', 'NumericLiteral', 'StringLiteral'].includes(node.type)) return node.value
  if (node.type === 'Identifier' && node.name === 'undefined') return undefined
  if (node.type === 'Identifier' && node.name === 'NaN') return Number.NaN
  if (node.type === 'NullLiteral') return null
  if (node.type === 'BigIntLiteral') return BigInt(node.value)
  if (['CallExpression', 'OptionalCallExpression'].includes(node.type) && node.callee?.type === 'Identifier' && ['Boolean', 'Number', 'String'].includes(node.callee.name) && node.arguments.length <= 1) {
    if (node.arguments.length === 0) return node.callee.name === 'Boolean' ? false : node.callee.name === 'Number' ? 0 : ''
    const value = staticValue(node.arguments[0])
    if (value === unknownStaticValue) return unknownStaticValue
    if (node.callee.name === 'Boolean') return Boolean(value)
    if (node.callee.name === 'Number') return Number(value)
    return String(value)
  }
  if (node.type === 'UnaryExpression' && ['!', '+', '-', '~', 'void'].includes(node.operator)) {
    if (node.operator === 'void') return undefined
    const value = staticValue(node.argument)
    if (value === unknownStaticValue) return unknownStaticValue
    if (node.operator === '!') return !value
    if (node.operator === '+') return +value
    if (node.operator === '-') return -value
    return ~value
  }
  if (node.type === 'BinaryExpression' && ['+', '-', '*', '/', '%', '**', '<', '<=', '>', '>=', '===', '!==', '==', '!='].includes(node.operator)) {
    const left = staticValue(node.left)
    const right = staticValue(node.right)
    if (left === unknownStaticValue || right === unknownStaticValue) return unknownStaticValue
    if (node.operator === '+') return left + right
    if (node.operator === '-') return left - right
    if (node.operator === '*') return left * right
    if (node.operator === '/') return left / right
    if (node.operator === '%') return left % right
    if (node.operator === '**') return left ** right
    if (node.operator === '<') return left < right
    if (node.operator === '<=') return left <= right
    if (node.operator === '>') return left > right
    if (node.operator === '>=') return left >= right
    if (node.operator === '===') return left === right
    if (node.operator === '!==') return left !== right
    if (node.operator === '==') return left == right
    return left != right
  }
  if (node.type === 'LogicalExpression') {
    const left = staticValue(node.left)
    const right = staticValue(node.right)
    if (left !== unknownStaticValue) {
      if (node.operator === '&&') return left ? right : left
      if (node.operator === '||') return left ? left : right
      if (node.operator === '??') return left === null || left === undefined ? right : left
    }
    if (right !== unknownStaticValue && node.operator === '&&' && !right) return false
    if (right !== unknownStaticValue && node.operator === '||' && right) return true
    return unknownStaticValue
  }
  if (node.type === 'ConditionalExpression') {
    const condition = staticValue(node.test)
    if (condition !== unknownStaticValue) return staticValue(condition ? node.consequent : node.alternate)
    const consequent = staticValue(node.consequent)
    const alternate = staticValue(node.alternate)
    return consequent !== unknownStaticValue && alternate !== unknownStaticValue && Boolean(consequent) === Boolean(alternate) ? Boolean(consequent) : unknownStaticValue
  }
  return unknownStaticValue
}
const directiveIsStaticallyFalse = prop => {
  if (prop.type !== 7 || !['if', 'else-if', 'show'].includes(prop.name) || !prop.exp?.content) return false
  let expression
  try { expression = vueCompiler.babelParse(`(${prop.exp.content})`, { sourceType: 'module', plugins: ['typescript'] }).program.body[0]?.expression }
  catch (error) { throw new Error(`pricing visibility expression must parse cleanly: ${error.message}`, { cause: error }) }
  const value = staticValue(expression)
  return value !== unknownStaticValue && !value
}
const staticallyHidden = node => node.type === 1 && node.props?.some(directiveIsStaticallyFalse)
const reachableVueBranches = node => {
  if (node.type !== 9) return node.branches || []
  const branches = []
  for (const branch of node.branches || []) {
    if (!branch.condition) { branches.push(branch); break }
    let expression
    try { expression = vueCompiler.babelParse(`(${branch.condition.content})`, { sourceType: 'module', plugins: ['typescript'] }).program.body[0]?.expression }
    catch (error) { throw new Error(`pricing v-if branch must parse cleanly: ${error.message}`, { cause: error }) }
    const condition = staticValue(expression)
    if (condition === unknownStaticValue) branches.push(branch)
    else if (condition) { branches.push(branch); break }
  }
  return branches
}
const conditionalDirective = node => node?.type === 1
  ? node.props?.find(prop => prop.type === 7 && ['if', 'else-if', 'else'].includes(prop.name))
  : undefined
const reachableChildPaths = node => {
  const children = node.children || []
  let paths = [[]]
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index]
    const directive = conditionalDirective(child)
    if (directive?.name !== 'if') { paths = paths.map(path => [...path, child]); continue }
    const chain = [child]
    let cursor = index + 1
    while (cursor < children.length) {
      while (cursor < children.length && ((children[cursor].type === 2 && !children[cursor].content.trim()) || children[cursor].type === 3)) cursor += 1
      const next = conditionalDirective(children[cursor])
      if (!next || !['else-if', 'else'].includes(next.name)) break
      chain.push(children[cursor]); cursor += 1
    }
    index = cursor - 1
    const alternatives = []
    let guaranteed = false
    for (const branch of chain) {
      const branchDirective = conditionalDirective(branch)
      if (branchDirective.name === 'else') { alternatives.push(branch); guaranteed = true; break }
      let expression
      try { expression = vueCompiler.babelParse(`(${branchDirective.exp?.content})`, { sourceType: 'module', plugins: ['typescript'] }).program.body[0]?.expression }
      catch (error) { throw new Error(`pricing v-if branch must parse cleanly: ${error.message}`, { cause: error }) }
      const condition = staticValue(expression)
      if (condition === unknownStaticValue) alternatives.push(branch)
      else if (condition) { alternatives.push(branch); guaranteed = true; break }
    }
    if (!guaranteed) alternatives.push(undefined)
    paths = paths.flatMap(path => alternatives.map(branch => branch ? [...path, branch] : path))
  }
  return paths
}
const templateNodeScopes = new WeakMap()
const renderedElements = (root, name) => {
  const visit = (node, inherited) => {
    if (staticallyHidden(node)) return []
    const scoped = node.type === 1 ? new Set([...inherited, ...vForBindingNames(node), ...slotBindingNames(node)]) : inherited
    templateNodeScopes.set(node, scoped)
    if (node.type === 9) return reachableVueBranches(node).map(branch => visit(branch, scoped)).sort((left, right) => right.length - left.length)[0] || []
    const own = node.type === 1 && node.tag === name ? [node] : []
    const children = reachableChildPaths(node).map(path => path.flatMap(child => visit(child, scoped))).sort((left, right) => right.length - left.length)[0] || []
    return [...own, ...children, ...reachableVueBranches(node).flatMap(branch => visit(branch, scoped))]
  }
  return visit(root, templateNodeScopes.get(root) || new Set())
}
const templateExpressionScopes = new WeakMap()
const templateBindingPatterns = (pattern, label) => {
  const parameters = String(pattern || '').trim().replace(/^\(([\s\S]*)\)$/, '$1')
  if (!parameters) return []
  try { return vueCompiler.babelParse(`(${parameters}) => 0`, { sourceType: 'module', plugins: ['typescript'] }).program.body[0]?.expression?.params || [] }
  catch (error) { throw new Error(`${label} bindings must parse cleanly: ${error.message}`, { cause: error }) }
}
const templatePatternBindingNames = (pattern, label) => {
  const names = []
  const collect = value => {
    if (!value) return
    if (value.type === 'Identifier') names.push(value.name)
    else if (value.type === 'AssignmentPattern') collect(value.left)
    else if (value.type === 'RestElement') collect(value.argument)
    else if (value.type === 'ObjectPattern') for (const property of value.properties) collect(property.type === 'RestElement' ? property.argument : property.value)
    else if (value.type === 'ArrayPattern') for (const element of value.elements) collect(element)
  }
  for (const parameter of templateBindingPatterns(pattern, label)) collect(parameter)
  return names
}
const vForParts = node => {
  const expression = node?.props?.find(prop => prop.type === 7 && prop.name === 'for')?.exp?.content
  const match = expression?.match(/^\s*(.*?)\s+(?:in|of)\s+([\s\S]+)$/)
  return match ? { bindings: match[1], source: match[2] } : undefined
}
const vForBindingNames = node => {
  const parts = vForParts(node)
  if (!parts) return []
  return templatePatternBindingNames(parts.bindings, 'pricing v-for aliases')
}
const slotBindingNames = node => (node?.props || [])
  .filter(prop => prop.type === 7 && prop.name === 'slot' && prop.exp?.content)
  .flatMap(prop => templatePatternBindingNames(prop.exp.content, 'pricing slot props'))
const templateExpressionAsts = root => {
  const expressions = []
  const add = (content, locals) => {
    if (!content) return
    try {
      const expression = vueCompiler.babelParse(`(${content})`, { sourceType: 'module', plugins: ['typescript'] }).program.body[0]?.expression
      const mark = node => {
        if (!node || typeof node !== 'object') return
        templateExpressionScopes.set(node, locals)
        for (const [key, value] of Object.entries(node)) {
          if (['loc', 'start', 'end', 'extra'].includes(key)) continue
          if (Array.isArray(value)) for (const item of value) mark(item)
          else mark(value)
        }
      }
      mark(expression)
      expressions.push(expression)
    }
    catch (error) { throw new Error(`pricing rendered expression must parse cleanly: ${error.message}`, { cause: error }) }
  }
  const visit = (node, inherited = new Set()) => {
    if (staticallyHidden(node)) return
    const scoped = node.type === 1 ? new Set([...inherited, ...vForBindingNames(node), ...slotBindingNames(node)]) : inherited
    if (node.type === 5) add(node.content.content, scoped)
    if (node.type === 1) for (const prop of node.props || []) if (prop.type === 7 && prop.exp?.content && prop.name !== 'slot') {
      add(prop.name === 'for' ? vForParts(node)?.source : prop.exp.content, prop.name === 'for' ? inherited : scoped)
    }
    for (const child of new Set(reachableChildPaths(node).flat())) visit(child, scoped)
    for (const branch of reachableVueBranches(node)) visit(branch, scoped)
  }
  visit(root, templateNodeScopes.get(root) || new Set())
  return expressions.filter(Boolean)
}
const astContains = (node, predicate) => {
  if (!node || typeof node !== 'object') return false
  if (predicate(node)) return true
  return Object.entries(node).some(([key, value]) => !['loc', 'start', 'end', 'extra'].includes(key) && (Array.isArray(value) ? value.some(item => astContains(item, predicate)) : astContains(value, predicate)))
}
const reachableAstContains = (node, predicate) => {
  node = unwrapExpression(node)
  if (!node || typeof node !== 'object') return false
  if (predicate(node)) return true
  if (['ArrowFunctionExpression', 'FunctionExpression', 'FunctionDeclaration', 'ObjectMethod'].includes(node.type)) return false
  if (node.type === 'LogicalExpression') {
    const leftMatches = reachableAstContains(node.left, predicate)
    const left = staticValue(node.left)
    if (left === unknownStaticValue) return leftMatches || reachableAstContains(node.right, predicate)
    const reachesRight = node.operator === '&&' ? Boolean(left) : node.operator === '||' ? !left : left === null || left === undefined
    return leftMatches || (reachesRight && reachableAstContains(node.right, predicate))
  }
  if (node.type === 'ConditionalExpression') {
    const testMatches = reachableAstContains(node.test, predicate)
    const condition = staticValue(node.test)
    if (condition !== unknownStaticValue) return testMatches || reachableAstContains(condition ? node.consequent : node.alternate, predicate)
    return testMatches || reachableAstContains(node.consequent, predicate) || reachableAstContains(node.alternate, predicate)
  }
  return Object.entries(node).some(([key, value]) => !['loc', 'start', 'end', 'extra'].includes(key) && (Array.isArray(value) ? value.some(item => reachableAstContains(item, predicate)) : reachableAstContains(value, predicate)))
}
const callsFunction = (node, name, argument) => reachableAstContains(node, candidate => {
  if (!['CallExpression', 'OptionalCallExpression'].includes(candidate.type) || candidate.callee?.type !== 'Identifier' || candidate.callee.name !== name) return false
  if (argument === undefined) return true
  return candidate.arguments.some(value => value?.type === 'StringLiteral' && value.value === argument)
})
const functionParameters = node => ['ArrowFunctionExpression', 'FunctionExpression', 'FunctionDeclaration', 'ObjectMethod'].includes(node?.type) ? node.params || [] : []
const knownObjectOmitsProperty = (node, propertyName, definitions, resolving = new Set()) => {
  node = unwrapExpression(node)
  if (!node) return false
  if (node.type === 'Identifier' && definitions.has(node.name) && !resolving.has(node.name)) return knownObjectOmitsProperty(definitions.get(node.name), propertyName, definitions, new Set(resolving).add(node.name))
  if (node.type !== 'ObjectExpression') return false
  for (const property of node.properties) {
    if (property.type === 'SpreadElement') {
      if (!knownObjectOmitsProperty(property.argument, propertyName, definitions, resolving)) return false
    } else {
      const key = property.computed ? staticPropertyKey(property.key) : property.key?.name || property.key?.value
      if (String(key) === String(propertyName)) return false
    }
  }
  return true
}
const expressionDerivedFrom = (node, origins, definitions = new Map(), path = [], resolving = new Set()) => {
  node = unwrapExpression(node)
  if (!node) return false
  if (origins(node)) return path.length === 0 || ['state', 'value'].includes(String(path[0]))
  if (node.type === 'Identifier') {
    if (!definitions.has(node.name)) return false
    const key = `${node.name}:${path.join('.')}`
    if (resolving.has(key)) return false
    return expressionDerivedFrom(definitions.get(node.name), origins, definitions, path, new Set([...resolving, key]))
  }
  if (['MemberExpression', 'OptionalMemberExpression'].includes(node.type)) {
    const property = node.computed ? staticPropertyKey(node.property) : node.property?.name
    return property !== undefined && expressionDerivedFrom(node.object, origins, definitions, [property, ...path], resolving)
  }
  if (node.type === 'SequenceExpression') return expressionDerivedFrom(node.expressions.at(-1), origins, definitions, path, resolving)
  if (node.type === 'ConditionalExpression') return expressionDerivedFrom(node.test, origins, definitions, [], resolving)
    || (expressionDerivedFrom(node.consequent, origins, definitions, path, resolving) && expressionDerivedFrom(node.alternate, origins, definitions, path, resolving))
  if (node.type === 'LogicalExpression') return expressionDerivedFrom(node.left, origins, definitions, path, resolving) && expressionDerivedFrom(node.right, origins, definitions, path, resolving)
  if (['CallExpression', 'OptionalCallExpression', 'NewExpression'].includes(node.type)) {
    if (path.length > 0) return false
    return node.callee?.type === 'Identifier' && node.callee.name === 't'
      && node.arguments.some(argument => expressionDerivedFrom(argument, origins, definitions, [], resolving))
  }
  if (node.type === 'ObjectExpression') {
    if (path.length === 0) return node.properties.some(property => property.type === 'SpreadElement'
      ? expressionDerivedFrom(property.argument, origins, definitions, [], resolving)
      : expressionDerivedFrom(property.value, origins, definitions, [], resolving))
    for (let index = node.properties.length - 1; index >= 0; index -= 1) {
      const property = node.properties[index]
      if (property.type === 'SpreadElement') {
        if (expressionDerivedFrom(property.argument, origins, definitions, path, resolving)) return true
        if (knownObjectOmitsProperty(property.argument, path[0], definitions, resolving)) continue
        return false
      }
      const key = property.computed ? staticPropertyKey(property.key) : property.key?.name || property.key?.value
      if (String(key) === path[0]) {
        const derived = expressionDerivedFrom(property.value, origins, definitions, path.slice(1), resolving)
        if (path.length !== 1 || path[0] !== 'label') return derived
        const members = directlyReadStateMembers(property.value, origins, definitions)
        return derived && members.has('state') && members.has('value')
      }
    }
    return false
  }
  if (node.type === 'ArrayExpression') {
    if (path.length === 0) return node.elements.some(element => expressionDerivedFrom(element, origins, definitions, [], resolving))
    const index = Number(path[0])
    return Number.isInteger(index) && expressionDerivedFrom(node.elements[index], origins, definitions, path.slice(1), resolving)
  }
  if (node.type === 'TemplateLiteral') return path.length === 0 && node.expressions.some(value => expressionDerivedFrom(value, origins, definitions, [], resolving))
  if (node.type === 'TaggedTemplateExpression') return path.length === 0 && expressionDerivedFrom(node.quasi, origins, definitions, [], resolving)
  if (node.type === 'BinaryExpression') return path.length === 0 && (expressionDerivedFrom(node.left, origins, definitions, [], resolving) || expressionDerivedFrom(node.right, origins, definitions, [], resolving))
  if (node.type === 'AwaitExpression') return expressionDerivedFrom(node.argument, origins, definitions, path, resolving)
  if (node.type === 'UnaryExpression') return path.length === 0 && expressionDerivedFrom(node.argument, origins, definitions, [], resolving)
  return false
}
const directlyReadStateMembers = (node, origins, definitions, resolving = new Set()) => {
  node = unwrapExpression(node)
  const members = new Set()
  if (!node || typeof node !== 'object') return members
  if (node.type === 'Identifier' && definitions.has(node.name)) {
    if (resolving.has(node.name)) return members
    return directlyReadStateMembers(definitions.get(node.name), origins, definitions, new Set([...resolving, node.name]))
  }
  if (['MemberExpression', 'OptionalMemberExpression'].includes(node.type)) {
    const property = node.computed ? staticPropertyKey(node.property) : node.property?.name
    if (['state', 'value'].includes(String(property)) && expressionDerivedFrom(node, origins, definitions)) members.add(String(property))
  }
  if (['CallExpression', 'OptionalCallExpression'].includes(node.type) && !(node.callee?.type === 'Identifier' && node.callee.name === 't')) return members
  for (const [key, value] of Object.entries(node)) {
    if (['loc', 'start', 'end', 'extra'].includes(key)) continue
    const children = Array.isArray(value) ? value : [value]
    for (const child of children) for (const member of directlyReadStateMembers(child, origins, definitions, resolving)) members.add(member)
  }
  return members
}
const derivedStateMember = (node, origins, definitions, resolving = new Set()) => {
  node = unwrapExpression(node)
  if (!node) return undefined
  if (node.type === 'Identifier' && definitions.has(node.name)) {
    if (resolving.has(node.name)) return undefined
    return derivedStateMember(definitions.get(node.name), origins, definitions, new Set([...resolving, node.name]))
  }
  if (!['MemberExpression', 'OptionalMemberExpression'].includes(node.type)) return undefined
  const property = node.computed ? staticPropertyKey(node.property) : node.property?.name
  return ['state', 'value'].includes(String(property)) && expressionDerivedFrom(node, origins, definitions) ? String(property) : undefined
}
const labelConditionModes = (node, origins, definitions, inherited = 'unknown') => {
  node = unwrapExpression(node)
  if (node?.type !== 'BinaryExpression' || !['===', '==', '!==', '!='].includes(node.operator)) return [inherited, inherited, false]
  const pairs = [[node.left, node.right], [node.right, node.left]]
  const pair = pairs.find(([member, literal]) => derivedStateMember(member, origins, definitions) === 'state' && literal?.type === 'StringLiteral')
  if (!pair) return [inherited, inherited, false]
  const status = pair[1].value
  const equal = ['===', '=='].includes(node.operator)
  if (status === 'published') return equal ? ['published', 'nonpublished', true] : ['nonpublished', 'published', true]
  return equal ? ['nonpublished', inherited, true] : [inherited, 'nonpublished', true]
}
const everyStateMemberUsesOrigin = (node, origins, definitions, resolving = new Set()) => {
  node = unwrapExpression(node)
  if (!node || typeof node !== 'object') return true
  if (node.type === 'Identifier' && definitions.has(node.name)) {
    if (resolving.has(node.name)) return false
    return everyStateMemberUsesOrigin(definitions.get(node.name), origins, definitions, new Set(resolving).add(node.name))
  }
  if (['MemberExpression', 'OptionalMemberExpression'].includes(node.type)) {
    const property = node.computed ? staticPropertyKey(node.property) : node.property?.name
    if (['state', 'value'].includes(String(property)) && !expressionDerivedFrom(node, origins, definitions)) return false
  }
  return Object.entries(node).every(([key, value]) => ['loc', 'start', 'end', 'extra'].includes(key)
    || (Array.isArray(value) ? value.every(child => everyStateMemberUsesOrigin(child, origins, definitions, resolving)) : everyStateMemberUsesOrigin(value, origins, definitions, resolving)))
}
const legitimateFallback = (node, origins, definitions, mode) => {
  node = unwrapExpression(node)
  if (mode !== 'nonpublished' || !node) return false
  if (node.type === 'StringLiteral') return /^(?:—|-|N\/A)$/i.test(node.value.trim())
  if (!['CallExpression', 'OptionalCallExpression'].includes(node.type) || node.callee?.type !== 'Identifier' || node.callee.name !== 't') return false
  const members = directlyReadStateMembers(node.arguments, origins, definitions)
  const knownFallbackKey = node.arguments.some(argument => argument?.type === 'StringLiteral' && /(?:unpublished|login.?required|missing|unavailable)/i.test(argument.value))
  return everyStateMemberUsesOrigin(node.arguments, origins, definitions) && (members.has('state') || knownFallbackKey)
}
const validLabelExpression = (node, origins, definitions, mode = 'unknown', resolving = new Set()) => {
  node = unwrapExpression(node)
  if (!node) return false
  if (node.type === 'Identifier' && definitions.has(node.name)) {
    if (resolving.has(node.name)) return false
    return validLabelExpression(definitions.get(node.name), origins, definitions, mode, new Set([...resolving, node.name]))
  }
  if (node.type === 'ConditionalExpression') {
    const [consequentMode, alternateMode, recognized] = labelConditionModes(node.test, origins, definitions, mode)
    if (!recognized) return false
    return validLabelExpression(node.consequent, origins, definitions, consequentMode, resolving)
      && validLabelExpression(node.alternate, origins, definitions, alternateMode, resolving)
  }
  if (node.type === 'LogicalExpression' && node.operator === '||') {
    const guarded = unwrapExpression(node.left)
    if (guarded?.type !== 'LogicalExpression' || guarded.operator !== '&&') return false
    const [truthyMode, falsyMode, recognized] = labelConditionModes(guarded.left, origins, definitions, mode)
    if (!recognized) return false
    return validLabelExpression(guarded.right, origins, definitions, truthyMode, resolving)
      && validLabelExpression(node.right, origins, definitions, falsyMode, resolving)
  }
  if (mode === 'published') return derivedStateMember(node, origins, definitions, resolving) === 'value'
  return legitimateFallback(node, origins, definitions, mode)
}
const absentObjectLabel = Symbol('absent object label')
const unknownObjectLabel = Symbol('unknown object label')
const effectiveObjectLabel = (node, definitions, resolving = new Set()) => {
  node = unwrapExpression(node)
  if (!node) return { knownObject: false, labels: [unknownObjectLabel] }
  if (node.type === 'Identifier' && definitions.has(node.name)) {
    if (resolving.has(node.name)) return { knownObject: false, labels: [unknownObjectLabel] }
    return effectiveObjectLabel(definitions.get(node.name), definitions, new Set([...resolving, node.name]))
  }
  if (node.type === 'SequenceExpression') return effectiveObjectLabel(node.expressions.at(-1), definitions, resolving)
  if (node.type === 'ConditionalExpression' || node.type === 'LogicalExpression') {
    const branches = [node.consequent || node.left, node.alternate || node.right].map(branch => effectiveObjectLabel(branch, definitions, resolving))
    return { knownObject: branches.every(branch => branch.knownObject), labels: branches.flatMap(branch => branch.labels) }
  }
  if (node.type !== 'ObjectExpression') return { knownObject: false, labels: [unknownObjectLabel] }
  let labels = [absentObjectLabel]
  for (const property of node.properties) {
    if (property.type === 'SpreadElement') {
      const spread = effectiveObjectLabel(property.argument, definitions, resolving)
      if (!spread.knownObject) labels = [unknownObjectLabel]
      else labels = labels.flatMap(current => spread.labels.map(candidate => candidate === absentObjectLabel ? current : candidate))
      continue
    }
    const key = property.computed ? staticPropertyKey(property.key) : property.key?.name || property.key?.value
    if (key === undefined) labels = [unknownObjectLabel]
    else if (String(key) === 'label') labels = [property.value]
  }
  return { knownObject: true, labels }
}
const forwardedArgument = (argument, binding, renderedCall) => {
  argument = unwrapExpression(argument)
  if (argument?.type !== 'Identifier') return undefined
  const parameterIndex = functionParameters(binding).findIndex(parameter => parameter.type === 'Identifier' && parameter.name === argument.name)
  return parameterIndex >= 0 ? unwrapExpression(renderedCall.arguments[parameterIndex]) : undefined
}
const normalizedStateArgument = (argument, definitions, binding, renderedCall, resolving = new Set()) => {
  argument = unwrapExpression(argument)
  if (argument?.type === 'Identifier' && definitions?.has(argument.name) && !resolving.has(argument.name)) {
    return normalizedStateArgument(definitions.get(argument.name), definitions, binding, renderedCall, new Set(resolving).add(argument.name))
  }
  const forwarded = binding ? forwardedArgument(argument, binding, renderedCall) : undefined
  if (forwarded) return normalizedStateArgument(forwarded, definitions, undefined, undefined, resolving)
  if (argument?.type === 'TemplateLiteral' && argument.expressions.length === 0) return { type: 'StringLiteral', value: argument.quasis.map(part => part.value.cooked ?? part.value.raw).join('') }
  return argument
}
const forwardedStateArgument = (argument, definitions, binding, renderedCall, resolving = new Set()) => {
  argument = unwrapExpression(argument)
  if (argument?.type === 'Identifier' && definitions?.has(argument.name) && !resolving.has(argument.name)) {
    return forwardedStateArgument(definitions.get(argument.name), definitions, binding, renderedCall, new Set(resolving).add(argument.name))
  }
  return binding ? forwardedArgument(argument, binding, renderedCall) : undefined
}
const correctPublicStateCall = (stateCall, component, modelName, binding, renderedCall, stateAuthority, definitions = new Map()) => {
  if (stateCall.callee?.type !== 'Identifier') return false
  if (templateExpressionScopes.get(stateCall)?.has(stateCall.callee.name)) return false
  const authorized = stateAuthority?.scriptCalls?.has(stateCall)
    ? stateAuthority.authorizedCalls.has(stateCall)
    : stateAuthority?.templateNames?.has(stateCall.callee.name)
  if (!authorized) return false
  const stateModel = normalizedStateArgument(stateCall.arguments[0], definitions, binding, renderedCall)
  const stateComponent = normalizedStateArgument(stateCall.arguments[1], definitions, binding, renderedCall)
  const forwardedComponent = forwardedStateArgument(stateCall.arguments[1], definitions, binding, renderedCall)
  const renderedComponent = forwardedComponent ? normalizedStateArgument(forwardedComponent, definitions) : undefined
  const rendersAComponentArgument = binding && renderedCall.arguments.some(argument => argument?.type === 'StringLiteral' && ['input', 'output'].includes(argument.value))
  const componentMatches = renderedComponent
    ? renderedComponent.type === 'StringLiteral' && renderedComponent.value === component
    : stateComponent?.type === 'StringLiteral' && stateComponent.value === component && !rendersAComponentArgument
  return stateModel?.type === 'Identifier' && stateModel.name === modelName && componentMatches
}
const transparentlyCarriesState = (node, origins, definitions, resolving = new Set()) => {
  node = unwrapExpression(node)
  if (!node) return false
  if (origins(node)) return true
  if (node.type === 'Identifier' && definitions.has(node.name)) {
    if (resolving.has(node.name)) return false
    return transparentlyCarriesState(definitions.get(node.name), origins, definitions, new Set([...resolving, node.name]))
  }
  if (node.type === 'ObjectExpression') return node.properties.some(property => property.type === 'SpreadElement' && transparentlyCarriesState(property.argument, origins, definitions, resolving))
  if (node.type === 'SequenceExpression') return transparentlyCarriesState(node.expressions.at(-1), origins, definitions, resolving)
  if (node.type === 'ConditionalExpression' || node.type === 'LogicalExpression') return [node.consequent || node.left, node.alternate || node.right].every(branch => transparentlyCarriesState(branch, origins, definitions, resolving))
  if (node.type === 'AwaitExpression') return transparentlyCarriesState(node.argument, origins, definitions, resolving)
  return false
}
const helperReturnsCorrectStateFromOrigin = (binding, component, modelName, renderedCall, renderedPaths, stateAuthority) => {
  // Repeated calls with the same forwarded model/component are one semantic source; output or unrelated calls are not.
  const originsFor = definitions => node => ['CallExpression', 'OptionalCallExpression'].includes(node?.type)
    && correctPublicStateCall(node, component, modelName, binding, renderedCall, stateAuthority, definitions)
  const returnIsValid = (node, definitions, mode, resolving = new Set()) => {
    const origins = originsFor(definitions)
    node = unwrapExpression(node)
    if (!node) return false
    if (node.type === 'Identifier' && definitions.has(node.name)) {
      if (resolving.has(node.name)) return false
      return returnIsValid(definitions.get(node.name), definitions, mode, new Set([...resolving, node.name]))
    }
    if (node.type === 'SequenceExpression') return returnIsValid(node.expressions.at(-1), definitions, mode, resolving)
    if (node.type === 'ConditionalExpression') {
      const [consequentMode, alternateMode] = labelConditionModes(node.test, origins, definitions, mode)
      return returnIsValid(node.consequent, definitions, consequentMode, resolving)
        && returnIsValid(node.alternate, definitions, alternateMode, resolving)
    }
    const labelResult = effectiveObjectLabel(node, definitions)
    const labelRequired = renderedPaths.some(path => path[0] === 'label')
    const directStateReturn = expressionDerivedFrom(node, origins, definitions)
    const objectLabelValid = labelResult.labels.length > 0 && labelResult.labels.every(label => label === absentObjectLabel
      ? !labelRequired
      : label !== unknownObjectLabel && validLabelExpression(label, origins, definitions, mode))
    const labelValid = labelResult.knownObject ? objectLabelValid : !labelRequired && directStateReturn
    return transparentlyCarriesState(node, origins, definitions)
      && expressionDerivedFrom(node, origins, definitions, ['state'])
      && expressionDerivedFrom(node, origins, definitions, ['value'])
      && labelValid
      && renderedPaths.every(path => path[0] === 'label' || expressionDerivedFrom(node, origins, definitions, path))
  }
  if (binding.body?.type !== 'BlockStatement') return returnIsValid(binding.body, new Map(), 'unknown')
  const returns = []
  const alwaysReturns = statement => statement?.type === 'ReturnStatement'
    || (statement?.type === 'BlockStatement' && alwaysReturns(statement.body.at(-1)))
    || (statement?.type === 'IfStatement' && statement.alternate && alwaysReturns(statement.consequent) && alwaysReturns(statement.alternate))
  const visitStatements = (statements, inherited = new Map(), inheritedMode = 'unknown', reuse = false) => {
    const definitions = reuse ? inherited : new Map(inherited)
    let mode = inheritedMode
    const applyAssignment = expression => {
      expression = unwrapExpression(expression)
      if (expression?.type === 'AssignmentExpression' && expression.operator === '=' && expression.left?.type === 'Identifier') definitions.set(expression.left.name, expression.right)
      if (expression?.type === 'SequenceExpression') for (const item of expression.expressions) applyAssignment(item)
    }
    for (const statement of statements || []) {
      if (statement.type === 'VariableDeclaration') {
        for (const declaration of statement.declarations) if (declaration.id?.type === 'Identifier') {
          if (declaration.init) definitions.set(declaration.id.name, declaration.init)
          else definitions.delete(declaration.id.name)
        }
      } else if (statement.type === 'ExpressionStatement') {
        applyAssignment(statement.expression)
      } else if (statement.type === 'ReturnStatement') { returns.push(returnIsValid(statement.argument, definitions, mode)); return true }
      else if (statement.type === 'BlockStatement') { if (visitStatements(statement.body, definitions, mode)) return true }
      else if (statement.type === 'IfStatement') {
        const condition = staticValue(statement.test)
        if (condition !== unknownStaticValue) {
          const branch = condition ? statement.consequent : statement.alternate
          if (branch && visitStatements(branch.type === 'BlockStatement' ? branch.body : [branch], definitions, mode, true)) return true
          continue
        }
        const [consequentMode, alternateMode] = labelConditionModes(statement.test, originsFor(definitions), definitions, mode)
        visitStatements(statement.consequent?.type === 'BlockStatement' ? statement.consequent.body : [statement.consequent], definitions, consequentMode)
        if (statement.alternate) visitStatements(statement.alternate.type === 'BlockStatement' ? statement.alternate.body : [statement.alternate], definitions, alternateMode)
        if (statement.alternate && alwaysReturns(statement.consequent) && alwaysReturns(statement.alternate)) return true
        if (!statement.alternate && alwaysReturns(statement.consequent)) mode = alternateMode
      } else if (statement.type === 'SwitchStatement') {
        const origins = originsFor(definitions)
        const switchesOnState = expressionDerivedFrom(statement.discriminant, origins, definitions, ['state'])
        const caseValues = statement.cases.map(branch => branch.test ? staticValue(branch.test) : undefined)
        const hasPublished = caseValues.some(value => value === 'published')
        const fallback = statement.cases.findIndex(branch => !branch.test)
        const discriminant = switchesOnState ? unknownStaticValue : staticValue(statement.discriminant)
        const casesKnown = caseValues.every((value, index) => index === fallback || value !== unknownStaticValue)
        const matched = discriminant !== unknownStaticValue && casesKnown
          ? caseValues.findIndex((value, index) => index !== fallback && Object.is(value, discriminant))
          : -1
        const entries = discriminant !== unknownStaticValue && casesKnown
          ? [matched >= 0 ? matched : fallback].filter(index => index >= 0)
          : statement.cases.map((_, index) => index)
        for (const entry of entries) {
          const entryValue = caseValues[entry]
          const entryMode = switchesOnState
            ? entryValue === 'published' ? 'published' : (entryValue !== unknownStaticValue && (statement.cases[entry].test || hasPublished)) ? 'nonpublished' : mode
            : mode
          const pathDefinitions = new Map(definitions)
          for (let index = entry; index < statement.cases.length; index += 1) {
            const consequent = statement.cases[index].consequent
            const abrupt = consequent.findIndex(child => ['BreakStatement', 'ThrowStatement'].includes(child.type))
            const path = abrupt < 0 ? consequent : consequent.slice(0, abrupt)
            if (visitStatements(path, pathDefinitions, entryMode, true) || abrupt >= 0) break
          }
        }
      }
      else if (statement.type === 'TryStatement') {
        visitStatements(statement.block?.body, definitions, mode)
        visitStatements(statement.handler?.body?.body, definitions, mode)
        visitStatements(statement.finalizer?.body, definitions, mode)
      }
    }
    return false
  }
  visitStatements(binding.body.body)
  return returns.length > 0 && returns.every(Boolean)
}
const helperReturnsCorrectState = (binding, component, modelName, renderedCall, renderedPaths, bindings) => {
  return helperReturnsCorrectStateFromOrigin(binding, component, modelName, renderedCall, renderedPaths, bindings.publicPriceStateAuthority)
}
const staticRenderedLabel = node => {
  node = unwrapExpression(node)
  if (!node) return false
  if (node.type === 'StringLiteral') return /^(?:—|-|N\/A|.*(?:unpublished|login.?required|missing|unavailable).*)$/i.test(node.value.trim())
  return ['CallExpression', 'OptionalCallExpression'].includes(node.type) && node.callee?.type === 'Identifier' && node.callee.name === 't'
    && node.arguments.length > 0 && node.arguments.every(staticRenderedLabel)
}
const renderedPriceStateFor = (expression, component, modelName, bindings, path = []) => {
  const node = unwrapExpression(expression)
  if (!node) return false
  const stateAuthority = bindings.publicPriceStateAuthority
  const directOrigins = candidate => ['CallExpression', 'OptionalCallExpression'].includes(candidate?.type)
    && correctPublicStateCall(candidate, component, modelName, undefined, undefined, stateAuthority)
  if (path.length === 0 && ['ConditionalExpression', 'LogicalExpression'].includes(node.type)
    && directlyReadStateMembers(node, directOrigins, new Map()).size > 0) {
    return validLabelExpression(node, directOrigins, new Map())
  }
  if (['MemberExpression', 'OptionalMemberExpression'].includes(node.type)) {
    const property = node.computed ? staticPropertyKey(node.property) : node.property?.name
    return property !== undefined && renderedPriceStateFor(node.object, component, modelName, bindings, [property, ...path])
  }
  if (['CallExpression', 'OptionalCallExpression'].includes(node.type)) {
    if (node.callee?.type === 'Identifier' && correctPublicStateCall(node, component, modelName, undefined, undefined, stateAuthority)) {
      return path.length === 0 || ['state', 'value'].includes(String(path[0]))
    }
    if (node.callee?.type === 'Identifier' && !templateExpressionScopes.get(node)?.has(node.callee.name) && bindings.has(node.callee.name)) {
      const candidates = bindings.get(node.callee.name) || []
      return candidates.length > 0 && candidates.every(binding => helperReturnsCorrectState(binding, component, modelName, node, [path], bindings))
    }
    if (path.length > 0 || node.callee?.type !== 'Identifier' || node.callee.name !== 't') return false
    return node.arguments.some(argument => renderedPriceStateFor(argument, component, modelName, bindings))
  }
  if (node.type === 'SequenceExpression') return renderedPriceStateFor(node.expressions.at(-1), component, modelName, bindings, path)
  if (node.type === 'ConditionalExpression') {
    const condition = staticValue(node.test)
    if (condition !== unknownStaticValue) return renderedPriceStateFor(condition ? node.consequent : node.alternate, component, modelName, bindings, path)
    const testDerived = renderedPriceStateFor(node.test, component, modelName, bindings)
    const branches = [node.consequent, node.alternate]
    const derived = branches.map(branch => renderedPriceStateFor(branch, component, modelName, bindings, path))
    return derived.every(Boolean) || (testDerived && branches.every((branch, index) => derived[index] || staticRenderedLabel(branch)))
  }
  if (node.type === 'LogicalExpression') {
    const leftValue = staticValue(node.left)
    if (leftValue !== unknownStaticValue) {
      const useRight = node.operator === '&&' ? Boolean(leftValue) : node.operator === '||' ? !leftValue : leftValue === null || leftValue === undefined
      return renderedPriceStateFor(useRight ? node.right : node.left, component, modelName, bindings, path)
    }
    const leftDerived = renderedPriceStateFor(node.left, component, modelName, bindings, path)
    const rightDerived = renderedPriceStateFor(node.right, component, modelName, bindings, path)
    return leftDerived && (rightDerived || staticRenderedLabel(node.right))
  }
  if (node.type === 'TemplateLiteral') return path.length === 0 && node.expressions.some(value => renderedPriceStateFor(value, component, modelName, bindings))
  if (node.type === 'BinaryExpression') return path.length === 0 && (renderedPriceStateFor(node.left, component, modelName, bindings) || renderedPriceStateFor(node.right, component, modelName, bindings))
  if (node.type === 'AwaitExpression') return renderedPriceStateFor(node.argument, component, modelName, bindings, path)
  if (node.type === 'UnaryExpression') return path.length === 0 && renderedPriceStateFor(node.argument, component, modelName, bindings)
  return false
}
const renderedPriceLabelFor = (expression, component, modelName, bindings) => {
  const node = unwrapExpression(expression)
  if (!node) return false
  if (['MemberExpression', 'OptionalMemberExpression'].includes(node.type)) {
    const property = node.computed ? staticPropertyKey(node.property) : node.property?.name
    return property === 'label' && renderedPriceStateFor(node, component, modelName, bindings)
  }
  return ['ConditionalExpression', 'LogicalExpression'].includes(node.type)
    && renderedPriceStateFor(node, component, modelName, bindings)
}
const vForAlias = node => node?.props?.find(prop => prop.type === 7 && prop.name === 'for')?.exp?.content.match(/^\s*(?:\(\s*)?([A-Za-z_$][\w$]*)/)?.[1]
const staticBindingInitializers = (value, importer) => {
  const bindings = new Map()
  const publicPriceStateAuthority = { templateNames: new Set(), scriptCalls: new WeakSet(), authorizedCalls: new WeakSet() }
  const authoritativeModule = new URL('../../utils/public-pricing-query.js', import.meta.url).pathname
  const resolvesToAuthoritativeModule = specifier => {
    if (specifier === '@/utils/public-pricing-query.js') return true
    if (!importer || !specifier.startsWith('.')) return false
    return new URL(specifier, new URL(importer, import.meta.url)).pathname === authoritativeModule
  }
  const descriptor = parseVue(value)
  for (const block of [descriptor.script, descriptor.scriptSetup].filter(Boolean)) {
    let ast
    try { ast = vueCompiler.babelParse(block.content, { sourceType: 'module', plugins: ['typescript'] }) }
    catch (error) { throw new Error(`pricing Vue script must parse cleanly: ${error.message}`, { cause: error }) }
    const member = (object, key) => ({ type: 'MemberExpression', object, property: { type: 'StringLiteral', value: String(key) }, computed: true })
    const authoritativeImports = new Set()
    const safeOptionWrappers = new Set()
    for (const statement of ast.program.body) if (statement.type === 'ImportDeclaration' && resolvesToAuthoritativeModule(statement.source.value)) {
      for (const specifier of statement.specifiers) if ((specifier.imported?.name ?? specifier.imported?.value) === 'publicPriceState') authoritativeImports.add(specifier.local.name)
    }
    for (const statement of ast.program.body) if (statement.type === 'ImportDeclaration' && statement.source.value === 'vue') {
      for (const specifier of statement.specifiers) if ((specifier.imported?.name ?? specifier.imported?.value) === 'defineComponent') safeOptionWrappers.add(specifier.local.name)
    }
    if (block === descriptor.scriptSetup) for (const name of authoritativeImports) publicPriceStateAuthority.templateNames.add(name)
    const patternNames = (pattern, names = []) => {
      pattern = unwrapExpression(pattern)
      if (pattern?.type === 'Identifier') names.push(pattern.name)
      else if (pattern?.type === 'AssignmentPattern') patternNames(pattern.left, names)
      else if (pattern?.type === 'RestElement') patternNames(pattern.argument, names)
      else if (pattern?.type === 'ObjectPattern') for (const property of pattern.properties) patternNames(property.type === 'RestElement' ? property.argument : property.value, names)
      else if (pattern?.type === 'ArrayPattern') for (const element of pattern.elements) if (element) patternNames(element, names)
      return names
    }
    const scopedBindings = (statements, inherited) => {
      const scope = new Map(inherited)
      for (const raw of statements || []) {
        const statement = raw?.type === 'ExportNamedDeclaration' ? raw.declaration : raw
        if (!statement) continue
        if (statement.type === 'ImportDeclaration') for (const specifier of statement.specifiers) {
          scope.set(specifier.local.name, authoritativeImports.has(specifier.local.name))
        }
        else if (statement.type === 'VariableDeclaration') for (const declaration of statement.declarations) for (const name of patternNames(declaration.id)) scope.set(name, false)
        else if ((statement.type === 'FunctionDeclaration' || statement.type === 'ClassDeclaration') && statement.id) scope.set(statement.id.name, false)
      }
      return scope
    }
    const visitScope = (node, inherited = new Map()) => {
      if (!node || typeof node !== 'object') return
      if (node.type === 'Program' || node.type === 'BlockStatement') {
        const scope = scopedBindings(node.body, inherited)
        for (const statement of node.body) visitScope(statement, scope)
        return
      }
      if (['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression', 'ObjectMethod', 'ClassMethod'].includes(node.type)) {
        const scope = new Map(inherited)
        if (node.id?.name) scope.set(node.id.name, false)
        for (const parameter of node.params || []) for (const name of patternNames(parameter)) scope.set(name, false)
        if (node.body?.type === 'BlockStatement') {
          const bodyScope = scopedBindings(node.body.body, scope)
          for (const statement of node.body.body) visitScope(statement, bodyScope)
        } else visitScope(node.body, scope)
        return
      }
      if (node.type === 'CatchClause') {
        const scope = new Map(inherited)
        for (const name of patternNames(node.param)) scope.set(name, false)
        visitScope(node.body, scope)
        return
      }
      if (node.type === 'SwitchStatement') {
        visitScope(node.discriminant, inherited)
        const scope = scopedBindings(node.cases.flatMap(branch => branch.consequent), inherited)
        for (const branch of node.cases) {
          visitScope(branch.test, scope)
          for (const statement of branch.consequent) visitScope(statement, scope)
        }
        return
      }
      if (node.type === 'CallExpression' || node.type === 'OptionalCallExpression') {
        publicPriceStateAuthority.scriptCalls.add(node)
        if (node.callee?.type === 'Identifier' && inherited.get(node.callee.name) === true) publicPriceStateAuthority.authorizedCalls.add(node)
      }
      for (const [key, child] of Object.entries(node)) {
        if (key === 'loc' || key === 'start' || key === 'end') continue
        if (Array.isArray(child)) for (const item of child) visitScope(item, inherited)
        else if (child && typeof child === 'object' && typeof child.type === 'string') visitScope(child, inherited)
      }
    }
    visitScope(ast.program)
    const selected = (expression, key) => {
      expression = unwrapExpression(expression)
      if (expression?.type === 'ArrayExpression' && /^\d+$/.test(String(key))) return expression.elements[Number(key)]
      if (expression?.type === 'ObjectExpression') for (let index = expression.properties.length - 1; index >= 0; index -= 1) {
        const property = expression.properties[index]
        if (property.type === 'SpreadElement') break
        const propertyKey = property.computed ? staticPropertyKey(property.key) : staticPropertyKey(property.key)
        if (propertyKey === String(key)) return propertyExpression(property)
      }
      return member(expression, key)
    }
    const staticContainer = (expression, target, resolving = new Set()) => {
      expression = unwrapExpression(expression)
      if (['ObjectExpression', 'ArrayExpression'].includes(expression?.type)) return expression
      if (expression?.type === 'Identifier' && !resolving.has(expression.name)) {
        const values = target.get(expression.name) || []
        if (values.length === 1) return staticContainer(values[0], target, new Set(resolving).add(expression.name))
      }
      if (expression?.type === 'SequenceExpression') return staticContainer(expression.expressions.at(-1), target, resolving)
      return undefined
    }
    const objectRest = (expression, excluded, target) => {
      const object = staticContainer(expression, target)
      return object?.type === 'ObjectExpression'
        ? { type: 'ObjectExpression', properties: object.properties.filter(property => property.type === 'SpreadElement' || !excluded.has(staticPropertyKey(property.key))) }
        : expression
    }
    const arrayRest = (expression, index, target) => {
      const array = staticContainer(expression, target)
      return array?.type === 'ArrayExpression' ? { type: 'ArrayExpression', elements: array.elements.slice(index) } : expression
    }
    const bindPattern = (pattern, expression, target) => {
      pattern = unwrapExpression(pattern)
      if (pattern?.type === 'Identifier') { target.set(pattern.name, expression ? [expression] : []); return }
      if (pattern?.type === 'AssignmentPattern') { bindPattern(pattern.left, expression || pattern.right, target); return }
      if (pattern?.type === 'ObjectPattern') {
        const excluded = new Set(pattern.properties.filter(property => property.type !== 'RestElement').map(property => staticPropertyKey(property.key)))
        for (const property of pattern.properties) bindPattern(property.type === 'RestElement' ? property.argument : property.value, property.type === 'RestElement' ? objectRest(expression, excluded, target) : selected(expression, staticPropertyKey(property.key)), target)
      }
      if (pattern?.type === 'ArrayPattern') for (let index = 0; index < pattern.elements.length; index += 1) if (pattern.elements[index]) {
        const element = pattern.elements[index]
        bindPattern(element.type === 'RestElement' ? element.argument : element, element.type === 'RestElement' ? arrayRest(expression, index, target) : selected(expression, index), target)
      }
    }
    const applyExpression = (expression, target) => {
      expression = unwrapExpression(expression)
      if (expression?.type === 'AssignmentExpression' && expression.operator === '=') bindPattern(expression.left, expression.right, target)
      if (expression?.type === 'SequenceExpression') for (const item of expression.expressions) applyExpression(item, target)
    }
    const merge = (left, right) => {
      const merged = new Map()
      for (const name of new Set([...left.keys(), ...right.keys()])) merged.set(name, [...new Set([...(left.get(name) || []), ...(right.get(name) || [])])])
      return merged
    }
    const expressionNullish = (node, environment, resolving = new Set(), chain = false) => {
      node = unwrapExpression(node)
      if (node?.type === 'ChainExpression') return expressionNullish(node.expression, environment, resolving, true)
      if (!node) return 'unknown'
      if (node.type === 'NullLiteral' || node.type === 'Identifier' && node.name === 'undefined' || node.type === 'UnaryExpression' && node.operator === 'void') return 'nullish'
      if (['StringLiteral', 'NumericLiteral', 'BooleanLiteral', 'BigIntLiteral', 'ObjectExpression', 'ArrayExpression', 'ArrowFunctionExpression', 'FunctionExpression', 'FunctionDeclaration', 'ObjectMethod'].includes(node.type)) return 'nonnull'
      if (node.type === 'Identifier' && environment.has(node.name) && !resolving.has(node.name)) {
        const values = environment.get(node.name).map(value => expressionNullish(value, environment, new Set(resolving).add(node.name)))
        return values.length && values.every(value => value === values[0]) ? values[0] : 'unknown'
      }
      if (['MemberExpression', 'OptionalMemberExpression'].includes(node.type)) {
        const receiverNullish = expressionNullish(node.object, environment, resolving, chain || node.type === 'OptionalMemberExpression')
        if (receiverNullish === 'short-circuit') return chain || node.type === 'OptionalMemberExpression' ? 'short-circuit' : 'unknown'
        if (receiverNullish === 'nullish') return node.optional ? 'short-circuit' : 'unknown'
        if (receiverNullish === 'unknown') return 'unknown'
        const key = node.computed ? staticPropertyKey(node.property) : node.property?.name
        const selectedValue = key === undefined ? { unknown: true } : factorySelection(node.object, key, environment, resolving)
        if (selectedValue.missing) return 'nullish'
        return selectedValue.value ? expressionNullish(selectedValue.value, environment, resolving) : 'unknown'
      }
      if (node.type === 'OptionalCallExpression') {
        const calleeNullish = expressionNullish(node.callee, environment, resolving)
        if (calleeNullish === 'short-circuit') return 'short-circuit'
        if (calleeNullish === 'nullish' && node.optional) return 'short-circuit'
        return 'unknown'
      }
      return 'unknown'
    }
    const sequenceEffect = effects => effects.includes('mustThrow') ? 'mustThrow' : effects.includes('mayThrow') ? 'mayThrow' : 'cannotThrow'
    const alternativeEffect = effects => effects.every(effect => effect === 'mustThrow') ? 'mustThrow' : effects.every(effect => effect === 'cannotThrow') ? 'cannotThrow' : 'mayThrow'
    const resolvedEffectCandidates = (node, environment, resolving = new Set()) => {
      node = unwrapExpression(node)
      if (!node || resolving.size > 32) return []
      if (node.type === 'Identifier' && environment.has(node.name) && !resolving.has(node.name)) return environment.get(node.name).flatMap(value => resolvedEffectCandidates(value, environment, new Set(resolving).add(node.name)))
      if (node.type === 'ConditionalExpression') {
        const condition = boundStaticValue(node.test, environment)
        return condition !== unknownStaticValue
          ? resolvedEffectCandidates(condition ? node.consequent : node.alternate, environment, resolving)
          : [...resolvedEffectCandidates(node.consequent, environment, resolving), ...resolvedEffectCandidates(node.alternate, environment, resolving)]
      }
      return [node]
    }
    const objectSpreadOperationEffect = (node, environment, resolving) => {
      const candidates = resolvedEffectCandidates(node, environment, resolving)
      if (!candidates.length) return 'mayThrow'
      return alternativeEffect(candidates.map(candidate => {
        candidate = unwrapExpression(candidate)
        if (candidate?.type === 'NullLiteral' || candidate?.type === 'Identifier' && candidate.name === 'undefined') return 'cannotThrow'
        if (candidate?.type !== 'ObjectExpression') return ['StringLiteral', 'TemplateLiteral', 'NumericLiteral', 'BooleanLiteral', 'BigIntLiteral', 'ArrayExpression'].includes(candidate?.type) ? 'cannotThrow' : 'mayThrow'
        return sequenceEffect(candidate.properties.filter(property => property.type === 'ObjectMethod' && property.kind === 'get').map(property => callableBodyEffect(property.body, value => expressionEffect(value, environment, resolving), value => {
          const result = boundStaticValue(value, environment); return { known: result !== unknownStaticValue, value: result }
        })))
      }))
    }
    const expressionEffect = (node, environment, resolving = new Set(), chain = false) => {
      node = unwrapExpression(node)
      if (!node || typeof node !== 'object') return 'cannotThrow'
      if (node.type === 'ChainExpression') return expressionEffect(node.expression, environment, resolving, true)
      if (['ArrowFunctionExpression', 'FunctionExpression', 'FunctionDeclaration', 'ObjectMethod'].includes(node.type)) return 'cannotThrow'
      if (node.type === 'ObjectExpression') return sequenceEffect(node.properties.flatMap(property => property.type === 'SpreadElement'
        ? [sequenceEffect([expressionEffect(property.argument, environment, resolving), objectSpreadOperationEffect(property.argument, environment, resolving)])]
        : [property.computed ? expressionEffect(property.key, environment, resolving) : 'cannotThrow', property.type === 'ObjectMethod' ? 'cannotThrow' : expressionEffect(property.value, environment, resolving)]))
      if (['CallExpression', 'OptionalCallExpression'].includes(node.type)) {
        const calleeEffect = expressionEffect(node.callee, environment, resolving, chain || node.type === 'OptionalCallExpression')
        if (calleeEffect === 'mustThrow') return 'mustThrow'
        const calleeNullish = expressionNullish(node.callee, environment, resolving, chain || node.type === 'OptionalCallExpression')
        if (((chain || node.type === 'OptionalCallExpression') && calleeNullish === 'short-circuit') || (node.optional && calleeNullish === 'nullish')) return calleeEffect
        const argumentEffect = sequenceEffect(node.arguments.map(argument => expressionEffect(argument.type === 'SpreadElement' ? argument.argument : argument, environment, resolving)))
        const prerequisite = sequenceEffect([calleeEffect, argumentEffect])
        const mayShortCircuit = (chain || node.type === 'OptionalCallExpression' || node.optional) && calleeNullish === 'unknown'
        if (prerequisite === 'mustThrow') return mayShortCircuit ? 'mayThrow' : 'mustThrow'
        const functions = factoryFunctions(node.callee, environment, resolving)
        const invocation = unwrapExpression(node.callee)?.type === 'Identifier' && safeOptionWrappers.has(node.callee.name)
          ? 'cannotThrow'
          : functions.length
            ? alternativeEffect(functions.map(fn => {
              if (resolving.has(fn)) return 'mayThrow'
              const factoryLocal = new Map(environment)
              const replacements = new Map()
              for (let index = 0; index < (fn.params || []).length; index += 1) bindFactoryPattern(fn.params[index], node.arguments[index], factoryLocal, replacements)
              const returned = safeFactoryReturns(fn, factoryLocal, replacements)
              if (returned.safe) return 'cannotThrow'
              const next = new Set(resolving).add(fn)
              return callableBodyEffect(fn.body, value => expressionEffect(substituteFactoryBindings(value, replacements), factoryLocal, next), value => {
                const result = boundStaticValue(substituteFactoryBindings(value, replacements), factoryLocal); return { known: result !== unknownStaticValue, value: result }
              })
            }))
            : 'mayThrow'
        return sequenceEffect([prerequisite, invocation])
      }
      if (['NewExpression', 'AwaitExpression', 'TaggedTemplateExpression'].includes(node.type)) return 'mayThrow'
      if (['MemberExpression', 'OptionalMemberExpression'].includes(node.type)) {
        const receiverEffect = expressionEffect(node.object, environment, resolving, chain || node.type === 'OptionalMemberExpression')
        if (receiverEffect === 'mustThrow') return 'mustThrow'
        const receiverNullish = expressionNullish(node.object, environment, resolving, chain || node.type === 'OptionalMemberExpression')
        if (receiverNullish === 'short-circuit') return chain || node.type === 'OptionalMemberExpression' ? receiverEffect : 'mustThrow'
        if (receiverNullish === 'nullish' && node.optional) return receiverEffect
        const propertyEffect = node.computed ? expressionEffect(node.property, environment, resolving) : 'cannotThrow'
        const prerequisite = sequenceEffect([receiverEffect, propertyEffect])
        if (receiverNullish === 'unknown') return 'mayThrow'
        if (prerequisite === 'mustThrow') return 'mustThrow'
        if (receiverNullish === 'nullish') return prerequisite === 'cannotThrow' ? 'mustThrow' : 'mayThrow'
        const key = node.computed ? staticPropertyKey(node.property) : node.property?.name
        const selectedValue = key === undefined ? { unknown: true } : factorySelection(node.object, key, environment, resolving)
        if (selectedValue.getter) return sequenceEffect([prerequisite, optionGetterEffect(selectedValue.getter, environment, resolving)])
        return selectedValue.unknown ? 'mayThrow' : prerequisite
      }
      if (node.type === 'Identifier' && environment.has(node.name) && !resolving.has(node.name)) {
        const effects = environment.get(node.name).map(value => expressionEffect(value, environment, new Set(resolving).add(node.name)))
        return effects.length && effects.every(effect => effect === 'mustThrow') ? 'mustThrow' : effects.some(effect => effect !== 'cannotThrow') ? 'mayThrow' : 'cannotThrow'
      }
      const effects = []
      for (const [name, child] of Object.entries(node)) if (!['loc', 'start', 'end', 'extra'].includes(name)) {
        if (Array.isArray(child)) effects.push(...child.map(item => expressionEffect(item, environment, resolving)))
        else effects.push(expressionEffect(child, environment, resolving))
      }
      return sequenceEffect(effects)
    }
    const setupReturns = (body, baseLocal = new Map(), includeCompletions = false) => {
      const unknownThrown = { type: 'Identifier', name: '__unknown_thrown_value__' }
      const localCallPaths = (expression, environment, replacements, resolving) => {
        expression = unwrapExpression(expression)
        if (!['CallExpression', 'OptionalCallExpression'].includes(expression?.type)) return undefined
        const calleeNullish = expressionNullish(expression.callee, environment, resolving, expression.type === 'OptionalCallExpression')
        const optional = expression.type === 'OptionalCallExpression' || expression.optional
        if (optional && ['nullish', 'short-circuit'].includes(calleeNullish)) return [{ kind: 'normal', replacements, environment }]
        const shortCircuitPaths = optional && calleeNullish === 'unknown' ? [{ kind: 'normal', replacements, environment }] : []
        const argumentEffect = sequenceEffect(expression.arguments.map(argument => expressionEffect(argument.type === 'SpreadElement' ? argument.argument : argument, environment, resolving)))
        if (argumentEffect === 'mustThrow') return shortCircuitPaths.concat({ kind: 'throw', expression: unknownThrown, replacements, environment })
        const key = expression.callee?.type === 'Identifier' ? expression.callee.name : `iife:${expression.callee?.start ?? expression.start}`
        if (resolving.has(key)) return [{ kind: 'normal', replacements, environment }, { kind: 'throw', expression: unknownThrown, replacements, environment }]
        const functions = factoryFunctions(expression.callee, environment, resolving)
        if (!functions.length) return undefined
        const invokedPaths = functions.flatMap(fn => {
          const local = new Map(environment)
          const bound = new Map(replacements)
          const localNames = new Set()
          const collectVarDeclarations = node => {
            if (!node || typeof node !== 'object') return
            if (node !== fn && ['ArrowFunctionExpression', 'FunctionExpression', 'FunctionDeclaration', 'ObjectMethod'].includes(node.type)) return
            if (node.type === 'VariableDeclaration' && node.kind === 'var') for (const declaration of node.declarations) for (const name of factoryPatternNames(declaration.id)) localNames.add(name)
            for (const [name, child] of Object.entries(node)) if (!['loc', 'start', 'end', 'extra'].includes(name)) {
              if (Array.isArray(child)) for (const item of child) collectVarDeclarations(item)
              else collectVarDeclarations(child)
            }
          }
          for (let index = 0; index < fn.params.length; index += 1) {
            const parameter = unwrapExpression(fn.params[index])
            for (const name of factoryPatternNames(parameter)) localNames.add(name)
            const argument = parameter?.type === 'RestElement' ? { type: 'ArrayExpression', elements: expression.arguments.slice(index) } : expression.arguments[index]
            bindFactoryPattern(parameter, argument, local, bound)
            if (parameter?.type === 'RestElement') break
          }
          for (const statement of fn.body?.body || []) {
            if (statement.type === 'VariableDeclaration') for (const declaration of statement.declarations) for (const name of factoryPatternNames(declaration.id)) localNames.add(name)
            if (['FunctionDeclaration', 'ClassDeclaration'].includes(statement.type) && statement.id) localNames.add(statement.id.name)
          }
          collectVarDeclarations(fn.body)
          for (const statement of fn.body?.body || []) if (statement.type === 'FunctionDeclaration' && statement.id) local.set(statement.id.name, [statement])
          return flow(fn.body, bound, true, local, new Set(resolving).add(key), true).map(path => {
            const completedEnvironment = new Map(environment)
            const completedReplacements = new Map(replacements)
            for (const name of environment.keys()) if (!localNames.has(name) && path.environment.has(name)) completedEnvironment.set(name, path.environment.get(name))
            for (const name of replacements.keys()) if (!localNames.has(name) && path.replacements.has(name)) completedReplacements.set(name, path.replacements.get(name))
            return path.kind === 'return'
              ? { kind: 'normal', replacements: completedReplacements, environment: completedEnvironment }
              : { ...path, replacements: completedReplacements, environment: completedEnvironment }
          })
        })
        return shortCircuitPaths.concat(invokedPaths, argumentEffect === 'mayThrow' ? [{ kind: 'throw', expression: unknownThrown, replacements, environment }] : [])
      }
      const directCall = node => {
        node = unwrapExpression(node)
        if (['CallExpression', 'OptionalCallExpression'].includes(node?.type)) return node
        if (node?.type === 'ExpressionStatement') return directCall(node.expression)
        if (node?.type === 'AwaitExpression') return directCall(node.argument)
        return undefined
      }
      const flowStatements = (statements, replacements, catchesUnknown, environment, resolving) => {
        let paths = [{ kind: 'normal', replacements, environment }]
        for (const statement of statements || []) paths = paths.flatMap(path => path.kind === 'normal' ? flow(statement, path.replacements, catchesUnknown, path.environment, resolving) : [path])
        return paths
      }
      const flow = (node, replacements = new Map(), catchesUnknown = false, environment = baseLocal, resolving = new Set(), root = false) => {
        if (!node) return [{ kind: 'normal', replacements, environment }]
        if (node.type === 'BlockStatement') {
          const scopedNames = new Set()
          const blockEnvironment = new Map(environment)
          const blockReplacements = new Map(replacements)
          for (const statement of node.body) {
            if (!root && statement.type === 'VariableDeclaration' && statement.kind !== 'var') for (const declaration of statement.declarations) for (const name of factoryPatternNames(declaration.id)) scopedNames.add(name)
            if (statement.type === 'FunctionDeclaration' && statement.id) {
              blockEnvironment.set(statement.id.name, [statement]); blockReplacements.set(statement.id.name, statement)
              if (!root) scopedNames.add(statement.id.name)
            }
            if (!root && statement.type === 'ClassDeclaration' && statement.id) scopedNames.add(statement.id.name)
          }
          return flowStatements(node.body, blockReplacements, catchesUnknown, blockEnvironment, resolving).map(path => {
            if (root) return path
            const nextEnvironment = new Map(path.environment)
            const nextReplacements = new Map(path.replacements)
            for (const name of scopedNames) {
              if (environment.has(name)) nextEnvironment.set(name, environment.get(name)); else nextEnvironment.delete(name)
              if (replacements.has(name)) nextReplacements.set(name, replacements.get(name)); else nextReplacements.delete(name)
            }
            return { ...path, environment: nextEnvironment, replacements: nextReplacements }
          })
        }
        if (node.type === 'ReturnStatement') {
          const returned = { kind: 'return', expression: node.argument ? substituteFactoryBindings(node.argument, replacements) : undefined, replacements, environment }
          const callPaths = localCallPaths(directCall(node.argument), environment, replacements, resolving)
          if (callPaths) return callPaths.map(path => path.kind === 'normal' ? { ...returned, replacements: path.replacements, environment: path.environment } : path)
          const effect = expressionEffect(node.argument, environment)
          return effect === 'mustThrow'
            ? catchesUnknown ? [{ kind: 'throw', expression: unknownThrown, replacements, environment }] : []
            : catchesUnknown && effect === 'mayThrow' ? [returned, { kind: 'throw', expression: unknownThrown, replacements, environment }] : [returned]
        }
        if (node.type === 'ThrowStatement') return [{ kind: 'throw', expression: substituteFactoryBindings(node.argument, replacements), replacements, environment }]
        if (node.type === 'BreakStatement') return [{ kind: 'break', replacements, environment }]
        if (node.type === 'VariableDeclaration') {
          let paths = [{ kind: 'normal', replacements, environment }]
          for (const declaration of node.declarations) paths = paths.flatMap(path => {
            const calls = localCallPaths(directCall(declaration.init), path.environment, path.replacements, resolving)
            if (calls) return calls.flatMap(candidate => {
              if (candidate.kind !== 'normal') return catchesUnknown ? [candidate] : []
              const nextEnvironment = new Map(candidate.environment)
              const nextReplacements = new Map(candidate.replacements)
              bindFactoryPattern(declaration.id, declaration.init, nextEnvironment, nextReplacements)
              return [{ kind: 'normal', replacements: nextReplacements, environment: nextEnvironment }]
            })
            const effect = expressionEffect(declaration.init, path.environment)
            const next = []
            if (effect !== 'mustThrow') {
              const nextEnvironment = new Map(path.environment)
              const nextReplacements = new Map(path.replacements)
              bindFactoryPattern(declaration.id, declaration.init, nextEnvironment, nextReplacements)
              next.push({ kind: 'normal', replacements: nextReplacements, environment: nextEnvironment })
            }
            if (catchesUnknown && effect !== 'cannotThrow') next.push({ kind: 'throw', expression: unknownThrown, replacements: path.replacements, environment: path.environment })
            return next
          })
          return paths
        }
        if (node.type === 'FunctionDeclaration') {
          const nextEnvironment = new Map(environment)
          if (node.id) nextEnvironment.set(node.id.name, [node])
          return [{ kind: 'normal', replacements, environment: nextEnvironment }]
        }
        if (node.type === 'ExpressionStatement' && unwrapExpression(node.expression)?.type === 'AssignmentExpression') {
          const calls = localCallPaths(directCall(node.expression.right), environment, replacements, resolving)
          if (calls) return calls.flatMap(candidate => {
            if (candidate.kind !== 'normal') return catchesUnknown ? [candidate] : []
            const nextEnvironment = new Map(candidate.environment)
            const nextReplacements = new Map(candidate.replacements)
            bindFactoryPattern(node.expression.left, node.expression.right, nextEnvironment, nextReplacements)
            return [{ kind: 'normal', replacements: nextReplacements, environment: nextEnvironment }]
          })
          const effect = expressionEffect(node.expression.right, environment)
          const paths = []
          if (effect !== 'mustThrow') {
            const nextEnvironment = new Map(environment)
            const nextReplacements = new Map(replacements)
            bindFactoryPattern(node.expression.left, node.expression.right, nextEnvironment, nextReplacements)
            paths.push({ kind: 'normal', replacements: nextReplacements, environment: nextEnvironment })
          }
          if (catchesUnknown && effect !== 'cannotThrow') paths.push({ kind: 'throw', expression: unknownThrown, replacements, environment })
          return paths
        }
        if (node.type === 'IfStatement') {
          const condition = staticValue(substituteFactoryBindings(node.test, replacements))
          return condition !== unknownStaticValue
            ? flow(condition ? node.consequent : node.alternate, replacements, catchesUnknown, environment, resolving)
            : [...flow(node.consequent, replacements, catchesUnknown, environment, resolving), ...flow(node.alternate, replacements, catchesUnknown, environment, resolving)]
        }
        if (node.type === 'SwitchStatement') {
          const discriminant = substituteFactoryBindings(node.discriminant, replacements)
          const effect = expressionEffect(discriminant, environment)
          if (effect === 'mustThrow') return catchesUnknown ? [{ kind: 'throw', expression: unknownThrown, replacements, environment }] : []
          const known = boundStaticValue(discriminant, environment)
          const cases = node.cases || []
          const defaultIndex = cases.findIndex(branch => !branch.test)
          const caseExpressionPaths = (expression, currentReplacements, currentEnvironment) => {
            expression = unwrapExpression(expression)
            if (expression?.type === 'SequenceExpression') {
              let paths = [{ kind: 'normal', replacements: new Map(currentReplacements), environment: new Map(currentEnvironment), value: undefined }]
              for (const item of expression.expressions) paths = paths.flatMap(candidate => candidate.kind === 'normal' ? caseExpressionPaths(item, candidate.replacements, candidate.environment) : [candidate])
              return paths
            }
            if (expression?.type === 'AssignmentExpression' && ['=', '&&=', '||=', '??='].includes(expression.operator)) {
              let references = [{ kind: 'normal', replacements: new Map(currentReplacements), environment: new Map(currentEnvironment), receiver: 'identifier', currentValue: substituteFactoryBindings(expression.left, currentReplacements) }]
              if (['MemberExpression', 'OptionalMemberExpression'].includes(expression.left?.type)) {
                references = caseExpressionPaths(expression.left.object, currentReplacements, currentEnvironment).flatMap(candidate => {
                  if (candidate.kind !== 'normal') return [candidate]
                  const nullish = expressionNullish(candidate.value, candidate.environment)
                  const receiverNode = unwrapExpression(candidate.value)
                  const receiverStatic = boundStaticValue(candidate.value, candidate.environment)
                  const primitive = receiverStatic !== unknownStaticValue && receiverStatic != null
                    || ['StringLiteral', 'NumericLiteral', 'BooleanLiteral', 'BigIntLiteral'].includes(receiverNode?.type)
                    || receiverNode?.type === 'CallExpression' && receiverNode.callee?.type === 'Identifier' && receiverNode.callee.name === 'Symbol'
                  return ['nullish', 'short-circuit'].includes(nullish)
                    ? [{ kind: 'throw', expression: unknownThrown, replacements: candidate.replacements, environment: candidate.environment }]
                    : [{ ...candidate, receiverValue: candidate.value, receiver: primitive ? 'primitive' : nullish === 'nonnull' ? 'object' : 'unknown' }]
                })
                if (expression.left.computed) references = references.flatMap(candidate => candidate.kind === 'normal'
                  ? caseExpressionPaths(expression.left.property, candidate.replacements, candidate.environment).map(propertyPath => ({ ...candidate, ...propertyPath, receiverValue: candidate.receiverValue, propertyValue: propertyPath.value, value: undefined }))
                  : [candidate])
                const inheritedKeys = new Set(['constructor', 'toString', 'toLocaleString', 'valueOf', 'hasOwnProperty', 'isPrototypeOf', 'propertyIsEnumerable', '__proto__'])
                references = references.map(candidate => {
                  if (candidate.kind !== 'normal') return candidate
                  const property = expression.left.computed ? boundStaticValue(candidate.propertyValue, candidate.environment) : expression.left.property?.name
                  if (property === unknownStaticValue) return { ...candidate, currentValue: substituteFactoryBindings(expression.left, candidate.replacements) }
                  const key = String(property)
                  const receiver = expression.left.object
                  let selected = factorySelection(receiver, key, candidate.environment)
                  if (selected.missing && inheritedKeys.has(key)) selected = { value: { type: 'BooleanLiteral', value: true } }
                  const primitive = boundStaticValue(receiver, candidate.environment)
                  if (selected.unknown && (primitive !== unknownStaticValue && primitive != null || candidate.receiver === 'primitive')) {
                    if (typeof primitive === 'string' && key === 'length') selected = { value: { type: 'NumericLiteral', value: primitive.length } }
                    else if (typeof primitive === 'string' && /^\d+$/.test(key)) selected = Number(key) < primitive.length ? { value: { type: 'StringLiteral', value: primitive[Number(key)] } } : { missing: true }
                    else selected = inheritedKeys.has(key) ? { value: { type: 'BooleanLiteral', value: true } } : { missing: true }
                  }
                  return { ...candidate, selected, currentValue: selected.value ?? (selected.missing ? { type: 'Identifier', name: 'undefined' } : substituteFactoryBindings(expression.left, candidate.replacements)) }
                }).flatMap(candidate => {
                  if (candidate.kind !== 'normal' || !candidate.selected?.getter) return [candidate]
                  const getter = optionGetterValues(candidate.selected.getter, candidate.environment)
                  const localNames = new Set()
                  const collectLocals = node => {
                    if (!node || typeof node !== 'object') return
                    if (node !== candidate.selected.getter && ['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression', 'ObjectMethod'].includes(node.type)) { if (node.type === 'FunctionDeclaration') for (const name of factoryPatternNames(node.id)) localNames.add(name); return }
                    if (node.type === 'VariableDeclarator') for (const name of factoryPatternNames(node.id)) localNames.add(name)
                    if (node.type === 'ClassDeclaration' && node.id) localNames.add(node.id.name)
                    if (node.type === 'CatchClause') for (const name of factoryPatternNames(node.param)) localNames.add(name)
                    for (const [name, child] of Object.entries(node)) if (!['loc', 'start', 'end', 'extra'].includes(name)) {
                      if (Array.isArray(child)) for (const item of child) collectLocals(item)
                      else collectLocals(child)
                    }
                  }
                  collectLocals(candidate.selected.getter.body)
                  const mergeOuter = path => {
                    const environment = new Map(candidate.environment)
                    const replacements = new Map(candidate.replacements)
                    for (const name of candidate.environment.keys()) if (!localNames.has(name) && path.environment.has(name)) environment.set(name, path.environment.get(name))
                    for (const name of candidate.replacements.keys()) if (!localNames.has(name) && path.replacements?.has(name)) replacements.set(name, path.replacements.get(name))
                    return { environment, replacements }
                  }
                  const paths = getter.values.map(path => ({ ...candidate, ...mergeOuter(path), currentValue: path.value }))
                  for (const path of getter.fallthroughs) paths.push({ ...candidate, ...mergeOuter(path), currentValue: { type: 'Identifier', name: 'undefined' } })
                  for (const path of getter.throws) paths.push({ kind: 'throw', expression: unknownThrown, ...mergeOuter(path) })
                  return paths
                })
              }
              const write = reference => caseExpressionPaths(expression.right, reference.replacements, reference.environment).flatMap(candidate => {
                if (candidate.kind !== 'normal') return [candidate]
                const nextEnvironment = new Map(candidate.environment)
                const nextReplacements = new Map(candidate.replacements)
                bindFactoryPattern(expression.left, candidate.value, nextEnvironment, nextReplacements)
                const success = { ...candidate, environment: nextEnvironment, replacements: nextReplacements }
                if (['nullish', 'primitive'].includes(reference.receiver)) return [{ kind: 'throw', expression: unknownThrown, environment: nextEnvironment, replacements: nextReplacements }]
                return reference.receiver === 'unknown' && catchesUnknown ? [success, { kind: 'throw', expression: unknownThrown, environment: new Map(nextEnvironment), replacements: new Map(nextReplacements) }] : [success]
              })
              return references.flatMap(reference => {
                if (reference.kind !== 'normal') return [reference]
                if (expression.operator === '=') return write(reference)
                let current = boundStaticValue(reference.currentValue, reference.environment)
                if (current === unknownStaticValue && ['ObjectExpression', 'ArrayExpression', 'ArrowFunctionExpression', 'FunctionExpression', 'FunctionDeclaration', 'ObjectMethod'].includes(unwrapExpression(reference.currentValue)?.type)) current = true
                const writes = current !== unknownStaticValue && (expression.operator === '&&=' ? Boolean(current) : expression.operator === '||=' ? !current : current == null)
                if (current !== unknownStaticValue) return writes ? write(reference) : [{ ...reference, value: reference.currentValue }]
                return [{ ...reference, value: reference.currentValue }, ...write({ ...reference, environment: new Map(reference.environment), replacements: new Map(reference.replacements) })]
              })
            }
            if (expression?.type === 'ConditionalExpression') return caseExpressionPaths(expression.test, currentReplacements, currentEnvironment).flatMap(candidate => {
              if (candidate.kind !== 'normal') return [candidate]
              const condition = boundStaticValue(candidate.value, candidate.environment)
              return condition !== unknownStaticValue
                ? caseExpressionPaths(condition ? expression.consequent : expression.alternate, candidate.replacements, candidate.environment)
                : [...caseExpressionPaths(expression.consequent, candidate.replacements, candidate.environment), ...caseExpressionPaths(expression.alternate, candidate.replacements, candidate.environment)]
            })
            if (expression?.type === 'LogicalExpression') return caseExpressionPaths(expression.left, currentReplacements, currentEnvironment).flatMap(candidate => {
              if (candidate.kind !== 'normal') return [candidate]
              const left = boundStaticValue(candidate.value, candidate.environment)
              const shortCircuits = left !== unknownStaticValue && (expression.operator === '&&' ? !left : expression.operator === '||' ? Boolean(left) : left != null)
              if (left !== unknownStaticValue) return shortCircuits ? [candidate] : caseExpressionPaths(expression.right, candidate.replacements, candidate.environment)
              return [candidate, ...caseExpressionPaths(expression.right, new Map(candidate.replacements), new Map(candidate.environment))]
            })
            const value = substituteFactoryBindings(expression, currentReplacements)
            const testEffect = expressionEffect(value, currentEnvironment)
            const outcomes = catchesUnknown && testEffect !== 'cannotThrow' ? [{ kind: 'throw', expression: unknownThrown, replacements: new Map(currentReplacements), environment: new Map(currentEnvironment) }] : []
            if (testEffect !== 'mustThrow') outcomes.unshift({ kind: 'normal', value, replacements: new Map(currentReplacements), environment: new Map(currentEnvironment) })
            return outcomes
          }
          let searches = [{ kind: 'search', replacements: new Map(replacements), environment: new Map(environment) }]
          for (let index = 0; index < cases.length; index += 1) {
            if (!cases[index].test) continue
            searches = searches.flatMap(search => {
              if (search.kind !== 'search') return [search]
              return caseExpressionPaths(cases[index].test, search.replacements, search.environment).flatMap(testPath => {
                if (testPath.kind === 'throw') return [testPath]
                const candidate = boundStaticValue(testPath.value, testPath.environment)
                if (known !== unknownStaticValue && candidate !== unknownStaticValue) return [{ kind: candidate === known ? 'entry' : 'search', index, replacements: testPath.replacements, environment: testPath.environment }]
                return [{ kind: 'entry', index, replacements: testPath.replacements, environment: testPath.environment }, { kind: 'search', replacements: new Map(testPath.replacements), environment: new Map(testPath.environment) }]
              })
            })
          }
          const entries = searches.map(search => search.kind === 'search' ? { ...search, kind: 'entry', index: defaultIndex } : search)
          const paths = entries.flatMap(entry => {
            if (entry.kind === 'throw') return [entry]
            const index = entry.index
            if (index < 0) return [{ kind: 'normal', replacements: entry.replacements, environment: entry.environment }]
            let branches = [{ kind: 'normal', replacements: entry.replacements, environment: entry.environment }]
            for (let caseIndex = index; caseIndex < cases.length; caseIndex += 1) branches = branches.flatMap(path => path.kind === 'normal' ? flowStatements(cases[caseIndex].consequent, path.replacements, catchesUnknown, path.environment, resolving) : [path])
            return branches.map(path => path.kind === 'break' ? { ...path, kind: 'normal' } : path)
          })
          if (catchesUnknown && effect === 'mayThrow') paths.push({ kind: 'throw', expression: unknownThrown, replacements, environment })
          return paths
        }
        if (node.type === 'TryStatement') {
          let paths = flow(node.block, replacements, true, environment, resolving).flatMap(path => {
            if (path.kind !== 'throw' || !node.handler) return [path]
            const catchLocal = new Map(path.environment)
            const catchReplacements = new Map(path.replacements)
            if (path.expression !== unknownThrown) bindFactoryPattern(node.handler.param, path.expression, catchLocal, catchReplacements)
            return flow(node.handler.body, catchReplacements, false, catchLocal, resolving)
          })
          if (node.finalizer) paths = paths.flatMap(path => flow(node.finalizer, path.replacements, true, path.environment, resolving).flatMap(finalPath => finalPath.kind === 'normal' ? [{ ...path, replacements: finalPath.replacements, environment: finalPath.environment }] : [finalPath]))
          return paths
        }
        const callPaths = localCallPaths(directCall(node), environment, replacements, resolving)
        if (callPaths) return callPaths.map(path => path.kind === 'return' ? { kind: 'normal', replacements: path.replacements, environment: path.environment } : path)
        const normal = { kind: 'normal', replacements, environment }
        const effect = expressionEffect(node, environment)
        return effect === 'mustThrow'
          ? catchesUnknown ? [{ kind: 'throw', expression: unknownThrown, replacements, environment }] : []
          : catchesUnknown && effect === 'mayThrow' ? [normal, { kind: 'throw', expression: unknownThrown, replacements, environment }] : [normal]
      }
      const paths = flow(body, new Map(), includeCompletions, new Map(baseLocal), new Set(), true)
      return includeCompletions ? paths : paths.filter(path => path.kind === 'return' && path.expression)
    }
    function optionGetterEffect(getter, local, resolving = new Set()) {
      if (resolving.has(getter)) return 'mayThrow'
      const next = new Set(resolving).add(getter)
      return callableBodyEffect(getter.body, value => expressionEffect(value, local, next), value => {
        const result = boundStaticValue(value, local)
        return { known: result !== unknownStaticValue, value: result }
      })
    }
    function optionGetterValues(getter, local, resolving = new Set()) {
      const completions = setupReturns(getter.body, new Map(local), true)
      const values = completions.filter(path => path.kind === 'return' && path.expression).map(path => ({ value: path.expression, environment: path.environment, replacements: path.replacements }))
      const throws = completions.filter(path => path.kind === 'throw')
      const fallthroughs = completions.filter(path => path.kind === 'normal')
      const effect = throws.length ? completions.some(path => path.kind !== 'throw') ? 'mayThrow' : 'mustThrow' : 'cannotThrow'
      return { effect, values, throws, fallthroughs, fallthrough: fallthroughs.length > 0, incomplete: completions.some(path => path.kind !== 'return') }
    }
    const resolvedLocalValues = (expression, local, resolving = new Set()) => {
      expression = unwrapExpression(expression)
      if (expression?.type === 'Identifier' && local.has(expression.name) && !resolving.has(expression.name)) return local.get(expression.name).flatMap(value => resolvedLocalValues(value, local, new Set(resolving).add(expression.name)))
      if (expression?.type === 'SequenceExpression') return resolvedLocalValues(expression.expressions.at(-1), local, resolving)
      return expression ? [expression] : []
    }
    const unknownObjectValue = { type: 'Identifier', name: '__unknown_object_value__' }
    const boundStaticValue = (expression, local, resolving = new Set()) => {
      expression = unwrapExpression(expression)
      const direct = staticValue(expression)
      if (direct !== unknownStaticValue) return direct
      if (expression?.type !== 'Identifier' || !local.has(expression.name) || resolving.has(expression.name)) return unknownStaticValue
      const values = local.get(expression.name).map(value => boundStaticValue(value, local, new Set(resolving).add(expression.name)))
      return values.length && values.every(value => value !== unknownStaticValue && Object.is(value, values[0])) ? values[0] : unknownStaticValue
    }
    const factoryFunctions = (callee, local, resolving = new Set()) => {
      callee = unwrapExpression(callee)
      if (['ArrowFunctionExpression', 'FunctionExpression', 'FunctionDeclaration', 'ObjectMethod'].includes(callee?.type)) return [callee]
      if (['MemberExpression', 'OptionalMemberExpression'].includes(callee?.type)) {
        const key = callee.computed ? staticPropertyKey(callee.property) : callee.property?.name
        const selectedValue = key === undefined ? { unknown: true } : factorySelection(callee.object, key, local, resolving)
        return selectedValue.value ? factoryFunctions(selectedValue.value, local, resolving) : []
      }
      if (callee?.type !== 'Identifier' || !local.has(callee.name) || resolving.has(callee.name)) return []
      return local.get(callee.name).flatMap(value => factoryFunctions(value, local, new Set(resolving).add(callee.name)))
    }
    const safeFactoryReturns = (fn, local, replacements = new Map()) => {
      if (fn.body?.type !== 'BlockStatement') return { values: fn.body ? [fn.body] : [], safe: true }
      const values = []
      const pureInitializer = (value, resolving = new Set()) => {
        value = unwrapExpression(value)
        if (!value || ['StringLiteral', 'NumericLiteral', 'BooleanLiteral', 'NullLiteral', 'BigIntLiteral', 'ArrowFunctionExpression', 'FunctionExpression', 'FunctionDeclaration', 'ObjectMethod'].includes(value.type)) return true
        if (value.type === 'Identifier') {
          if (!local.has(value.name) || resolving.has(value.name)) return false
          return local.get(value.name).every(candidate => pureInitializer(candidate, new Set(resolving).add(value.name)))
        }
        if (value.type === 'ObjectExpression') return value.properties.every(property => pureInitializer(property.type === 'SpreadElement' ? property.argument : propertyExpression(property), resolving))
        if (value.type === 'ArrayExpression') return value.elements.every(element => !element || pureInitializer(element.type === 'SpreadElement' ? element.argument : element, resolving))
        if (value.type === 'ConditionalExpression') return pureInitializer(value.test, resolving) && pureInitializer(value.consequent, resolving) && pureInitializer(value.alternate, resolving)
        if (value.type === 'UnaryExpression') return pureInitializer(value.argument, resolving)
        if (['MemberExpression', 'OptionalMemberExpression'].includes(value.type)) {
          const key = value.computed ? staticPropertyKey(value.property) : value.property?.name
          return key !== undefined && !factorySelection(value.object, key, local, resolving).unknown
        }
        return false
      }
      const visit = (node, root = false) => {
        if (!node) return true
        if (node.type === 'ReturnStatement') { if (node.argument) values.push(substituteFactoryBindings(node.argument, replacements)); return true }
        if (node.type === 'EmptyStatement' || node.type === 'FunctionDeclaration') {
          if (node.id) { local.set(node.id.name, [node]); replacements.set(node.id.name, node) }
          return true
        }
        if (node.type === 'VariableDeclaration') {
          let safe = true
          for (const declaration of node.declarations) {
            safe = pureInitializer(declaration.init) && safe
            if (pureInitializer(declaration.init)) bindFactoryPattern(declaration.id, declaration.init, local, replacements)
          }
          return safe
        }
        if (node.type === 'BlockStatement') {
          const savedLocal = root ? undefined : new Map(local)
          const savedReplacements = root ? undefined : new Map(replacements)
          for (const statement of node.body) if (statement.type === 'FunctionDeclaration' && statement.id) {
            local.set(statement.id.name, [statement]); replacements.set(statement.id.name, statement)
          }
          let safe = true
          for (const statement of node.body) safe = visit(statement) && safe
          if (!root) {
            local.clear(); for (const [name, value] of savedLocal) local.set(name, value)
            replacements.clear(); for (const [name, value] of savedReplacements) replacements.set(name, value)
          }
          return safe
        }
        if (node.type === 'IfStatement') {
          const condition = boundStaticValue(node.test, local)
          return condition !== unknownStaticValue
            ? visit(condition ? node.consequent : node.alternate)
            : [node.consequent, node.alternate].map(visit).every(Boolean)
        }
        return false
      }
      const completions = setupReturns(fn.body, new Map(local), true)
      return { values, safe: visit(fn.body, true) && !completions.some(path => path.kind === 'normal') }
    }
    const factoryPatternNames = (pattern, names = []) => {
      pattern = unwrapExpression(pattern)
      if (pattern?.type === 'Identifier') names.push(pattern.name)
      else if (pattern?.type === 'AssignmentPattern') factoryPatternNames(pattern.left, names)
      else if (pattern?.type === 'RestElement') factoryPatternNames(pattern.argument, names)
      else if (pattern?.type === 'ObjectPattern') for (const property of pattern.properties) factoryPatternNames(property.type === 'RestElement' ? property.argument : property.value, names)
      else if (pattern?.type === 'ArrayPattern') for (const element of pattern.elements) if (element) factoryPatternNames(element, names)
      return names
    }
    const factorySelection = (expression, key, local, resolving = new Set()) => {
      expression = unwrapExpression(expression)
      if (!expression || resolving.size > 32) return { unknown: true }
      if (expression.type === 'Identifier') {
        if (!local.has(expression.name) || resolving.has(expression.name)) return { unknown: true }
        const choices = local.get(expression.name).map(value => factorySelection(value, key, local, new Set(resolving).add(expression.name)))
        if (choices.length === 1) return choices[0]
        if (choices.length && choices.every(choice => choice.missing)) return { missing: true }
        return { unknown: true }
      }
      if (expression.type === 'ConditionalExpression') {
        const condition = boundStaticValue(expression.test, local)
        if (condition !== unknownStaticValue) return factorySelection(condition ? expression.consequent : expression.alternate, key, local, resolving)
        const branches = [factorySelection(expression.consequent, key, local, resolving), factorySelection(expression.alternate, key, local, resolving)]
        if (branches.every(branch => branch.missing)) return { missing: true }
        return { unknown: true }
      }
      if (['MemberExpression', 'OptionalMemberExpression'].includes(expression.type)) {
        const memberKey = expression.computed ? staticPropertyKey(expression.property) : expression.property?.name
        if (memberKey === undefined) return { unknown: true }
        const receiver = factorySelection(expression.object, memberKey, local, resolving)
        if (!receiver.value) return { unknown: true }
        return factorySelection(receiver.value, key, local, resolving)
      }
      if (expression.type === 'ArrayExpression' && /^\d+$/.test(String(key))) {
        const items = []
        for (const element of expression.elements) {
          if (element?.type !== 'SpreadElement') { items.push(element); continue }
          const spread = factoryArrayElements(element.argument, local, resolving)
          if (!spread) return { unknown: true }
          items.push(...spread)
        }
        return Number(key) < items.length ? { value: items[Number(key)] } : { missing: true }
      }
      if (expression.type !== 'ObjectExpression') return { unknown: true }
      for (let index = expression.properties.length - 1; index >= 0; index -= 1) {
        const property = expression.properties[index]
        if (property.type === 'SpreadElement') {
          const spread = factorySelection(property.argument, key, local, resolving)
          if (!spread.missing) return spread
          continue
        }
        const computedKey = property.computed ? boundStaticValue(property.key, local) : undefined
        const propertyKey = property.computed ? computedKey === unknownStaticValue ? undefined : String(computedKey) : staticPropertyKey(property.key)
        if (property.computed && propertyKey === undefined) return { unknown: true }
        if (propertyKey === String(key)) return property.type === 'ObjectMethod' && property.kind === 'get'
          ? { getter: property }
          : { value: propertyExpression(property) }
      }
      return { missing: true }
    }
    const factoryArrayElements = (expression, local, resolving = new Set()) => {
      expression = unwrapExpression(expression)
      if (expression?.type === 'Identifier' && local.has(expression.name) && !resolving.has(expression.name)) {
        const choices = local.get(expression.name).map(value => factoryArrayElements(value, local, new Set(resolving).add(expression.name)))
        return choices.length === 1 ? choices[0] : undefined
      }
      if (expression?.type !== 'ArrayExpression') return undefined
      const elements = []
      for (const element of expression.elements) {
        if (element?.type !== 'SpreadElement') elements.push(element)
        else {
          const spread = factoryArrayElements(element.argument, local, resolving)
          if (!spread) return undefined
          elements.push(...spread)
        }
      }
      return elements
    }
    const factorySelected = (expression, key, local) => {
      const selected = factorySelection(expression, key, local)
      return selected.value ?? (selected.missing ? undefined : member(expression, key))
    }
    const bindFactoryPattern = (pattern, expression, target, replacements) => {
      pattern = unwrapExpression(pattern)
      if (!pattern) return
      if (pattern.type === 'AssignmentPattern') {
        const missing = !expression || unwrapExpression(expression)?.type === 'Identifier' && unwrapExpression(expression).name === 'undefined'
        bindFactoryPattern(pattern.left, missing ? pattern.right : expression, target, replacements)
        return
      }
      if (pattern.type === 'RestElement') { bindFactoryPattern(pattern.argument, expression, target, replacements); return }
      if (pattern.type === 'Identifier') {
        target.set(pattern.name, expression ? [expression] : [])
        if (expression) replacements.set(pattern.name, expression)
        return
      }
      if (pattern.type === 'ObjectPattern') {
        const excluded = new Set(pattern.properties.filter(property => property.type !== 'RestElement').map(property => staticPropertyKey(property.key)))
        for (const property of pattern.properties) bindFactoryPattern(property.type === 'RestElement' ? property.argument : property.value, property.type === 'RestElement' ? objectRest(expression, excluded, target) : factorySelected(expression, staticPropertyKey(property.key), target), target, replacements)
      }
      if (pattern.type === 'ArrayPattern') for (let index = 0; index < pattern.elements.length; index += 1) if (pattern.elements[index]) {
        const element = pattern.elements[index]
        const elements = element.type === 'RestElement' ? factoryArrayElements(expression, target) : undefined
        bindFactoryPattern(element.type === 'RestElement' ? element.argument : element, element.type === 'RestElement' && elements ? { type: 'ArrayExpression', elements: elements.slice(index) } : element.type === 'RestElement' ? arrayRest(expression, index, target) : factorySelected(expression, index, target), target, replacements)
      }
    }
    const functionVarNames = node => {
      const names = []
      const visit = value => {
        if (!value || typeof value !== 'object') return
        if (value !== node && ['ArrowFunctionExpression', 'FunctionExpression', 'FunctionDeclaration', 'ObjectMethod'].includes(value.type)) return
        if (value.type === 'VariableDeclaration' && value.kind === 'var') for (const declaration of value.declarations) factoryPatternNames(declaration.id, names)
        for (const [name, child] of Object.entries(value)) if (!['loc', 'start', 'end', 'extra'].includes(name)) {
          if (Array.isArray(child)) for (const item of child) visit(item)
          else visit(child)
        }
      }
      visit(node.body)
      return names
    }
    const blockLexicalNames = node => (node.body || []).flatMap(statement => {
      if (statement.type === 'VariableDeclaration' && statement.kind !== 'var') return statement.declarations.flatMap(declaration => factoryPatternNames(declaration.id))
      return ['FunctionDeclaration', 'ClassDeclaration'].includes(statement.type) && statement.id ? [statement.id.name] : []
    })
    const substituteFactoryBindings = (node, replacements, shadowed = new Set(), parent, key, resolving = new Set()) => {
      if (!node || typeof node !== 'object') return node
      if (replacements.size === 0) return node
      if (Array.isArray(node)) {
        const values = node.map(value => substituteFactoryBindings(value, replacements, shadowed, parent, key, resolving))
        return values.some((value, index) => value !== node[index]) ? values : node
      }
      if (node.type === 'Identifier' && replacements.has(node.name) && !shadowed.has(node.name)) {
        const isStaticKey = (parent?.type === 'ObjectProperty' || parent?.type === 'ObjectMethod') && key === 'key' && !parent.computed || parent?.type === 'MemberExpression' && key === 'property' && !parent.computed
        if (!isStaticKey && !resolving.has(node.name)) return substituteFactoryBindings(replacements.get(node.name), replacements, shadowed, parent, key, new Set(resolving).add(node.name))
      }
      let nestedShadowed = shadowed
      if (['ArrowFunctionExpression', 'FunctionExpression', 'FunctionDeclaration', 'ObjectMethod'].includes(node.type)) {
        nestedShadowed = new Set(shadowed)
        for (const name of (node.params || []).flatMap(parameter => factoryPatternNames(parameter)).concat(functionVarNames(node))) nestedShadowed.add(name)
        if (node.id?.name) nestedShadowed.add(node.id.name)
      }
      if (node.type === 'BlockStatement') { nestedShadowed = new Set(shadowed); for (const name of blockLexicalNames(node)) nestedShadowed.add(name) }
      if (node.type === 'CatchClause') { nestedShadowed = new Set(shadowed); for (const name of factoryPatternNames(node.param)) nestedShadowed.add(name) }
      let changed = false
      const copy = {}
      for (const [childKey, value] of Object.entries(node)) {
        copy[childKey] = ['loc', 'start', 'end', 'extra'].includes(childKey) ? value : substituteFactoryBindings(value, replacements, nestedShadowed, node, childKey, resolving)
        if (copy[childKey] !== value) changed = true
      }
      if (changed && ['MemberExpression', 'OptionalMemberExpression'].includes(node.type)) {
        const container = staticContainer(copy.object, new Map())
        const property = copy.computed ? staticPropertyKey(copy.property) : copy.property?.name
        if (container && property !== undefined) return factorySelected(container, property, new Map())
      }
      return changed ? copy : node
    }
    const objectStates = (expression, local, resolving = new Set()) => {
      expression = unwrapExpression(expression)
      if (!expression || resolving.size > 32) return [{ map: new Map(), unknown: true }]
      if (expression.type === 'Identifier') {
        if (!local.has(expression.name) || resolving.has(expression.name)) return [{ map: new Map(), unknown: true }]
        return local.get(expression.name).flatMap(value => objectStates(value, local, new Set(resolving).add(expression.name)))
      }
      if (['CallExpression', 'OptionalCallExpression'].includes(expression.type) && expression.callee?.type === 'Identifier' && expression.callee.name === 'defineComponent') return objectStates(expression.arguments[0], local, resolving)
      if (['CallExpression', 'OptionalCallExpression'].includes(expression.type)) {
        const factories = factoryFunctions(expression.callee, local, resolving)
        if (!factories.length) return [{ map: new Map(), unknown: true }]
        return factories.flatMap(factory => {
          const factoryLocal = new Map(local)
          const replacements = new Map()
          for (let index = 0; index < factory.params.length; index += 1) {
            const parameter = unwrapExpression(factory.params[index])
            const argument = parameter?.type === 'RestElement'
              ? { type: 'ArrayExpression', elements: expression.arguments.slice(index) }
              : expression.arguments[index]
            bindFactoryPattern(parameter, argument, factoryLocal, replacements)
            if (parameter?.type === 'RestElement') break
          }
          const returned = safeFactoryReturns(factory, factoryLocal, replacements)
          const next = new Set(resolving).add(factory.id?.name || expression.callee?.name || '__iife__')
          const states = returned.values.flatMap(value => objectStates(value, factoryLocal, next).map(state => ({
            ...state,
            map: new Map([...state.map].map(([name, property]) => [name, substituteFactoryBindings(property, replacements)])),
          })))
          return returned.safe && states.length ? states : states.concat({ map: new Map(), unknown: true })
        })
      }
      if (expression.type === 'ConditionalExpression') {
        const condition = boundStaticValue(expression.test, local)
        return condition !== unknownStaticValue
          ? objectStates(condition ? expression.consequent : expression.alternate, local, resolving)
          : [...objectStates(expression.consequent, local, resolving), ...objectStates(expression.alternate, local, resolving)]
      }
      if (expression.type === 'SequenceExpression') return objectStates(expression.expressions.at(-1), local, resolving)
      if (['MemberExpression', 'OptionalMemberExpression'].includes(expression.type)) {
        const key = expression.computed ? staticPropertyKey(expression.property) : expression.property?.name
        const selected = key === undefined ? { unknown: true } : factorySelection(expression.object, key, local, resolving)
        if (selected.getter) {
          const result = optionGetterValues(selected.getter, local, resolving)
          const states = result.values.flatMap(path => objectStates(path.value, path.environment, new Set(resolving).add(selected.getter)))
          return result.effect === 'cannotThrow' && !result.incomplete ? states : result.effect === 'mustThrow' ? [{ map: new Map(), unknown: true }] : states.concat({ map: new Map(), unknown: true })
        }
        return selected.value ? objectStates(selected.value, local, resolving) : [{ map: new Map(), unknown: true }]
      }
      if (expression.type !== 'ObjectExpression') return [{ map: new Map(), unknown: true }]
      let states = [{ map: new Map(), unknown: false }]
      for (const property of expression.properties) {
        if (property.type !== 'SpreadElement') {
          for (const state of states) state.map.set(staticPropertyKey(property.key), propertyExpression(property))
          continue
        }
        const spreads = objectStates(property.argument, local, resolving)
        states = states.flatMap(state => spreads.map(spread => {
          const map = new Map(state.map)
          if (spread.unknown) for (const key of map.keys()) map.set(key, unknownObjectValue)
          for (const [key, value] of spread.map) map.set(key, value)
          return { map, unknown: state.unknown || spread.unknown }
        }))
      }
      return states
    }
    const stateValues = (states, key, local) => {
      const values = []
      let uncertain = false
      for (const state of states) {
        if (state.map.has(key)) {
          const value = state.map.get(key)
          if (value?.type === 'ObjectMethod' && value.kind === 'get') {
            const getter = optionGetterValues(value, local)
            values.push(...getter.values.map(path => path.value))
            if (getter.effect !== 'cannotThrow' || getter.incomplete) { uncertain = true; invalidOptionsExport = true }
          } else values.push(value)
        }
        else if (state.unknown) uncertain = true
        else if (states.some(candidate => candidate.map.has(key))) uncertain = true
      }
      const unique = [...new Set(values.filter(value => value !== unknownObjectValue))]
      return uncertain || values.includes(unknownObjectValue) ? unique.concat(unknownObjectValue) : unique
    }
    const returnedObjectBindings = (fn, target) => {
      const exposed = new Map()
      if (!fn?.body) return exposed
      const local = new Map(target)
      for (const statement of fn.body.type === 'BlockStatement' ? fn.body.body : []) if (statement.type === 'FunctionDeclaration' && statement.id) local.set(statement.id.name, [statement])
      const returnedPaths = fn.body.type === 'BlockStatement' ? setupReturns(fn.body, local) : [{ expression: fn.body, environment: local }]
      const branches = returnedPaths.map(path => ({ states: objectStates(path.expression, path.environment), environment: path.environment }))
      const keys = new Set(branches.flatMap(branch => branch.states.flatMap(state => [...state.map.keys()])))
      for (const key of keys) exposed.set(key, [...new Set(branches.flatMap(branch => stateValues(branch.states, key, branch.environment).flatMap(value => resolvedLocalValues(value, branch.environment))))])
      return exposed
    }
    const reachableOptionValues = (expression, target, resolving = new Set()) => {
      expression = unwrapExpression(expression)
      if (expression?.type === 'Identifier' && target.has(expression.name) && !resolving.has(expression.name)) return target.get(expression.name).flatMap(value => reachableOptionValues(value, target, new Set(resolving).add(expression.name)))
      if (expression?.type === 'ConditionalExpression') {
        const condition = boundStaticValue(expression.test, target)
        return condition !== unknownStaticValue
          ? reachableOptionValues(condition ? expression.consequent : expression.alternate, target, resolving)
          : [...reachableOptionValues(expression.consequent, target, resolving), ...reachableOptionValues(expression.alternate, target, resolving)]
      }
      if (expression?.type === 'SequenceExpression') return reachableOptionValues(expression.expressions.at(-1), target, resolving)
      return expression ? [expression] : []
    }
    const exposeOptions = (declaration, target) => {
      const options = objectStates(declaration, target)
      for (const name of ['setup', 'data']) {
        const functions = stateValues(options, name, target).flatMap(value => reachableOptionValues(value, target))
        const branches = functions.map(fn => returnedObjectBindings(unwrapExpression(fn), target))
        for (const key of new Set(branches.flatMap(branch => [...branch.keys()]))) target.set(key, [...new Set(branches.flatMap(branch => branch.get(key) || [unknownObjectValue]))])
      }
      for (const name of ['computed', 'methods']) {
        const registries = stateValues(options, name, target).flatMap(value => objectStates(value, target))
        for (const key of new Set(registries.flatMap(state => [...state.map.keys()]))) target.set(key, stateValues(registries, key, target).flatMap(value => resolvedLocalValues(value, target)))
      }
    }
    let invalidOptionsExport = false
    const process = (statements, target, scoped = false) => {
      const scopedNames = new Set()
      const previous = new Map()
      for (const raw of statements || []) {
        const declaration = raw?.type === 'ExportNamedDeclaration' ? raw.declaration : raw
        if (declaration?.type === 'FunctionDeclaration' && declaration.id) scopedNames.add(declaration.id.name)
        if (scoped && declaration?.type === 'VariableDeclaration' && declaration.kind !== 'var') for (const item of declaration.declarations) for (const name of factoryPatternNames(item.id)) scopedNames.add(name)
      }
      for (const name of scopedNames) {
        previous.set(name, target.has(name) ? target.get(name) : undefined)
        const declaration = (statements || []).map(raw => raw?.type === 'ExportNamedDeclaration' ? raw.declaration : raw).find(statement => statement?.type === 'FunctionDeclaration' && statement.id?.name === name)
        if (declaration) target.set(name, [declaration])
      }
      for (const raw of statements || []) {
        const node = raw?.type === 'ExportNamedDeclaration' ? raw.declaration : raw
        if (!node) continue
        if (node.type === 'FunctionDeclaration' && node.id) target.set(node.id.name, [node])
        else if (node.type === 'VariableDeclaration') for (const declaration of node.declarations) bindPattern(declaration.id, declaration.init, target)
        else if (node.type === 'ExportDefaultDeclaration') {
          const effect = expressionEffect(node.declaration, target)
          if (effect === 'cannotThrow') exposeOptions(node.declaration, target)
          else invalidOptionsExport = true
        }
        else if (node.type === 'ExpressionStatement') {
          if (expressionEffect(node.expression, target) === 'mustThrow') { invalidOptionsExport = true; break }
          applyExpression(node.expression, target)
        }
        else if (node.type === 'BlockStatement') process(node.body, target, true)
        else if (node.type === 'IfStatement') {
          const condition = staticValue(node.test)
          if (condition !== unknownStaticValue) {
            const branch = condition ? node.consequent : node.alternate
            process(branch?.type === 'BlockStatement' ? branch.body : [branch], target, branch?.type === 'BlockStatement')
          }
          else {
            const left = new Map(target); const right = new Map(target)
            process(node.consequent?.type === 'BlockStatement' ? node.consequent.body : [node.consequent], left, node.consequent?.type === 'BlockStatement')
            process(node.alternate?.type === 'BlockStatement' ? node.alternate.body : [node.alternate], right, node.alternate?.type === 'BlockStatement')
            target.clear(); for (const [name, values] of merge(left, right)) target.set(name, values)
          }
        } else if (node.type === 'TryStatement') {
          const sentinel = { type: 'Identifier', name: '__options_flow_complete__' }
          const paths = setupReturns({ type: 'BlockStatement', body: [node, { type: 'ReturnStatement', argument: sentinel }] }, target)
          if (paths.length) {
            const merged = paths.map(path => path.environment).reduce((left, right) => merge(left, right))
            target.clear(); for (const [name, values] of merged) target.set(name, values)
          }
        } else if (node.type === 'SwitchStatement') {
          const discriminant = staticValue(node.discriminant)
          const caseValues = node.cases.map(branch => branch.test ? staticValue(branch.test) : undefined)
          const defaultIndex = node.cases.findIndex(branch => !branch.test)
          let entries
          if (discriminant !== unknownStaticValue && caseValues.every((value, index) => index === defaultIndex || value !== unknownStaticValue)) {
            const matched = caseValues.findIndex((value, index) => index !== defaultIndex && Object.is(value, discriminant))
            entries = [matched >= 0 ? matched : defaultIndex].filter(index => index >= 0)
          } else entries = node.cases.map((_, index) => index).concat(defaultIndex < 0 ? [-1] : [])
          const states = entries.map(entry => {
            const state = new Map(target)
            if (entry < 0) return state
            for (let index = entry; index < node.cases.length; index += 1) {
              const statements = node.cases[index].consequent
              const stop = statements.findIndex(statement => statement.type === 'BreakStatement')
              process(stop < 0 ? statements : statements.slice(0, stop), state)
              if (stop >= 0) break
            }
            return state
          })
          if (states.length) {
            const merged = states.reduce((left, right) => merge(left, right))
            target.clear(); for (const [name, values] of merged) target.set(name, values)
          }
        }
      }
      if (scoped) for (const name of scopedNames) {
        if (previous.get(name) === undefined) target.delete(name)
        else target.set(name, previous.get(name))
      }
    }
    process(ast.program.body, bindings)
    if (invalidOptionsExport) throw new Error('pricing Options export must be statically non-throwing before template bindings are exposed')
  }
  Object.defineProperty(bindings, 'publicPriceStateAuthority', { value: publicPriceStateAuthority })
  return bindings
}
const unwrapExpression = node => {
  while (node && ['ParenthesizedExpression', 'TSAsExpression', 'TSTypeAssertion', 'TSNonNullExpression', 'TypeCastExpression'].includes(node.type)) node = node.expression
  return node
}
const returnedExpressions = node => {
  const replace = (value, replacements, parent, key) => {
    value = unwrapExpression(value)
    if (!value || typeof value !== 'object') return value
    if (value.type === 'Identifier' && replacements.has(value.name)) {
      const staticKey = (parent?.type === 'ObjectProperty' || parent?.type === 'ObjectMethod') && key === 'key' && !parent.computed || parent?.type === 'MemberExpression' && key === 'property' && !parent.computed
      if (!staticKey) return replacements.get(value.name)
    }
    if (['ArrowFunctionExpression', 'FunctionExpression', 'FunctionDeclaration', 'ObjectMethod'].includes(value.type) && value.params?.some(parameter => parameter.type === 'Identifier' && replacements.has(parameter.name))) return value
    let changed = false
    const copy = {}
    for (const [childKey, child] of Object.entries(value)) {
      copy[childKey] = ['loc', 'start', 'end', 'extra'].includes(childKey) ? child : Array.isArray(child) ? child.map(item => replace(item, replacements, value, childKey)) : replace(child, replacements, value, childKey)
      if (copy[childKey] !== child && (!Array.isArray(child) || copy[childKey].some((item, index) => item !== child[index]))) changed = true
    }
    return changed ? copy : value
  }
  const mayThrow = value => {
    let found = false
    const visit = current => {
      if (!current || typeof current !== 'object' || found) return
      if (['ArrowFunctionExpression', 'FunctionExpression', 'FunctionDeclaration', 'ObjectMethod'].includes(current.type)) return
      if (['CallExpression', 'OptionalCallExpression', 'NewExpression', 'AwaitExpression', 'TaggedTemplateExpression', 'MemberExpression', 'OptionalMemberExpression'].includes(current.type)) { found = true; return }
      for (const [name, child] of Object.entries(current)) if (!['loc', 'start', 'end', 'extra'].includes(name)) Array.isArray(child) ? child.forEach(visit) : visit(child)
    }
    visit(value)
    return found
  }
  const flowStatements = (statements, replacements, catchesUnknown) => {
    let paths = [{ kind: 'normal', replacements }]
    for (const statement of statements || []) paths = paths.flatMap(path => path.kind === 'normal' ? flow(statement, path.replacements, catchesUnknown) : [path])
    return paths
  }
  const flow = (value, replacements = new Map(), catchesUnknown = false) => {
    value = unwrapExpression(value)
    if (!value) return [{ kind: 'normal', replacements }]
    if (!/(?:Statement|Declaration)$/.test(value.type)) return [{ kind: 'return', expression: replace(value, replacements), replacements }]
    if (value.type === 'BlockStatement') return flowStatements(value.body, replacements, catchesUnknown)
    if (value.type === 'ReturnStatement') {
      const returned = { kind: 'return', expression: value.argument ? replace(value.argument, replacements) : undefined, replacements }
      return catchesUnknown && mayThrow(value.argument) ? [returned, { kind: 'throw', replacements }] : [returned]
    }
    if (value.type === 'ThrowStatement') return [{ kind: 'throw', expression: replace(value.argument, replacements), replacements }]
    if (value.type === 'IfStatement') {
      const condition = staticValue(replace(value.test, replacements))
      return condition !== unknownStaticValue ? flow(condition ? value.consequent : value.alternate, replacements, catchesUnknown) : [...flow(value.consequent, replacements, catchesUnknown), ...flow(value.alternate, replacements, catchesUnknown)]
    }
    if (value.type === 'SwitchStatement') return value.cases.flatMap(branch => flowStatements(branch.consequent, replacements, catchesUnknown))
    if (value.type === 'TryStatement') {
      let paths = flow(value.block, replacements, true).flatMap(path => {
        if (path.kind !== 'throw' || !value.handler) return [path]
        const caught = new Map(replacements)
        if (value.handler.param?.type === 'Identifier' && path.expression && staticValue(path.expression) !== unknownStaticValue) caught.set(value.handler.param.name, path.expression)
        return flow(value.handler.body, caught, false)
      })
      if (value.finalizer) paths = paths.flatMap(path => flow(value.finalizer, replacements, true).flatMap(finalPath => finalPath.kind === 'normal' ? [path] : [finalPath]))
      return paths
    }
    const normal = { kind: 'normal', replacements }
    return catchesUnknown && mayThrow(value) ? [normal, { kind: 'throw', replacements }] : [normal]
  }
  return flow(node).filter(path => path.kind === 'return' && path.expression).map(path => path.expression)
}
const staticPropertyKey = node => {
  node = unwrapExpression(node)
  if (node?.type === 'Identifier') return node.name
  if (node?.type === 'StringLiteral' || node?.type === 'NumericLiteral') return String(node.value)
  return undefined
}
const propertyExpression = property => property.type === 'ObjectMethod' ? property : property.value
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
const cartesian = values => values.reduce((sets, choices) => sets.flatMap(set => choices.map(choice => set.concat([choice]))), [[]])
const staticPureBindingValues = (name, path, bindings, resolving) => {
  const resolution = `pure:${name}.${path.join('.')}`
  if (resolving.has(resolution)) return []
  const next = new Set(resolving).add(resolution)
  return (bindings.get(name) || []).flatMap(initializer => staticPureValuesAtPath(initializer, path, bindings, next))
}
const staticPureValuesAtPath = (node, path, bindings, resolving) => {
  node = unwrapExpression(node)
  if (!node) return []
  if (node.type === 'Identifier') return staticPureBindingValues(node.name, path, bindings, resolving)
  if (node.type === 'ConditionalExpression' || node.type === 'LogicalExpression') return [node.consequent || node.left, node.alternate || node.right].flatMap(branch => staticPureValuesAtPath(branch, path, bindings, resolving))
  if (node.type === 'SequenceExpression') return staticPureValuesAtPath(node.expressions.at(-1), path, bindings, resolving)
  if (!path.length) return staticPureValues(node, bindings, resolving)
  if (node.type === 'ObjectExpression') {
    const [head, ...tail] = path
    return node.properties.flatMap(property => property.type === 'SpreadElement'
      ? staticPureValuesAtPath(property.argument, path, bindings, resolving)
      : staticPropertyKey(property.key) === head ? staticPureValuesAtPath(propertyExpression(property), tail, bindings, resolving) : [])
  }
  if (node.type === 'ArrayExpression') {
    const [head, ...tail] = path
    return /^\d+$/.test(head) && node.elements[Number(head)] ? staticPureValuesAtPath(node.elements[Number(head)], tail, bindings, resolving) : []
  }
  const reference = memberReference(node)
  return reference ? staticPureBindingValues(reference.name, reference.path.concat(path), bindings, resolving) : []
}
const staticPureMemberCallValues = (node, bindings, resolving) => {
  if (!['CallExpression', 'OptionalCallExpression'].includes(node?.type) || !['MemberExpression', 'OptionalMemberExpression'].includes(node.callee?.type)) return []
  const method = node.callee.computed ? staticPropertyKey(node.callee.property) : node.callee.property?.name
  if (!['join', 'concat', 'toString'].includes(method)) return []
  const receivers = staticPureValues(node.callee.object, bindings, resolving)
  const argumentSets = node.arguments.map(argument => staticPureValues(argument, bindings, resolving))
  if (argumentSets.some(values => values.length === 0)) return []
  const argumentLists = cartesian(argumentSets)
  return receivers.flatMap(receiver => argumentLists.flatMap(args => {
    if (method === 'join' && Array.isArray(receiver) && args.length <= 1 && (args.length === 0 || typeof args[0] === 'string')) return [receiver.map(String).join(args[0] ?? ',')]
    if (method === 'concat' && typeof receiver === 'string' && args.every(value => typeof value === 'string')) return [receiver.concat(...args)]
    if (method === 'concat' && Array.isArray(receiver)) return [receiver.concat(...args)]
    if (method === 'toString' && args.length === 0 && (typeof receiver === 'string' || Array.isArray(receiver))) return [String(receiver)]
    return []
  }))
}
const staticPureValues = (node, bindings, resolving = new Set()) => {
  node = unwrapExpression(node)
  if (!node) return []
  if (['StringLiteral', 'NumericLiteral', 'BooleanLiteral'].includes(node.type)) return [node.value]
  if (node.type === 'NullLiteral') return [null]
  if (node.type === 'Identifier') return staticPureBindingValues(node.name, [], bindings, resolving)
  if (node.type === 'ArrayExpression') {
    const items = node.elements.map(element => element ? staticPureValues(element, bindings, resolving) : [undefined])
    return items.some(values => values.length === 0) ? [] : cartesian(items)
  }
  if (node.type === 'MemberExpression' || node.type === 'OptionalMemberExpression') {
    const reference = memberReference(node)
    return reference ? staticPureBindingValues(reference.name, reference.path, bindings, resolving) : []
  }
  if (node.type === 'BinaryExpression' && node.operator === '+') {
    const left = staticPureValues(node.left, bindings, resolving)
    const right = staticPureValues(node.right, bindings, resolving)
    return left.flatMap(leftValue => right.map(rightValue => leftValue + rightValue))
  }
  if (node.type === 'ConditionalExpression' || node.type === 'LogicalExpression') return [node.consequent || node.left, node.alternate || node.right].flatMap(branch => staticPureValues(branch, bindings, resolving))
  if (node.type === 'SequenceExpression') return staticPureValues(node.expressions.at(-1), bindings, resolving)
  if (node.type === 'CallExpression' || node.type === 'OptionalCallExpression') return staticPureMemberCallValues(node, bindings, resolving)
  return []
}
const staticExpressionPossibilities = (node, bindings, resolving = new Set()) => {
  node = unwrapExpression(node)
  if (node?.type === 'StringLiteral' || node?.type === 'NumericLiteral' || node?.type === 'BooleanLiteral') return [node.value]
  if (node?.type === 'NullLiteral') return [null]
  if (node?.type === 'Identifier') return bindingPossibilities(node.name, [], bindings, resolving)
  if (node?.type === 'ArrayExpression') return node.elements.filter(Boolean).flatMap(element => staticExpressionPossibilities(element, bindings, resolving))
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
  if (['ArrowFunctionExpression', 'FunctionExpression', 'FunctionDeclaration', 'ObjectMethod'].includes(node?.type)) return returnedExpressions(node.body).flatMap(expression => staticExpressionPossibilities(expression, bindings, resolving))
  if (node?.type === 'CallExpression' || node?.type === 'OptionalCallExpression' || node?.type === 'NewExpression') {
    const pure = staticPureMemberCallValues(node, bindings, resolving)
    const reference = memberReference(node.callee)
    const returned = node.callee?.type === 'Identifier' && bindings.has(node.callee.name)
      ? bindingPossibilities(node.callee.name, [], bindings, resolving)
      : reference ? bindingPossibilities(reference.name, reference.path, bindings, resolving) : []
    const receiver = ['MemberExpression', 'OptionalMemberExpression'].includes(node.callee?.type)
      ? staticExpressionPossibilities(node.callee.object, bindings, resolving)
      : []
    return pure.concat(returned, receiver, node.arguments.flatMap(argument => staticExpressionPossibilities(argument, bindings, resolving)))
  }
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
  if (['ArrowFunctionExpression', 'FunctionExpression', 'FunctionDeclaration', 'ObjectMethod'].includes(node.type)) return returnedExpressions(node.body).flatMap(expression => possibilitiesAtPath(expression, path, bindings, resolving))
  if (!path.length) return staticExpressionPossibilities(node, bindings, resolving)
  if (node.type === 'ObjectExpression') {
    const [head, ...tail] = path
    return node.properties.flatMap(property => {
      if (property.type === 'SpreadElement') return possibilitiesAtPath(property.argument, path, bindings, resolving)
      const key = property.computed ? staticPropertyKey(property.key) : staticPropertyKey(property.key)
      return key === head ? possibilitiesAtPath(propertyExpression(property), tail, bindings, resolving) : []
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
  if (['ArrowFunctionExpression', 'FunctionExpression', 'FunctionDeclaration', 'ObjectMethod'].includes(node.type)) return returnedExpressions(node.body).flatMap(expression => leavesAtPath(expression, path, bindings, resolving))
  if (!path.length) return staticLiteralLeaves(node, bindings, resolving)
  if (node.type === 'ObjectExpression') {
    const [head, ...tail] = path
    return node.properties.flatMap(property => {
      if (property.type === 'SpreadElement') return leavesAtPath(property.argument, path, bindings, resolving)
      const key = staticPropertyKey(property.key)
      return key === head ? leavesAtPath(propertyExpression(property), tail, bindings, resolving) : []
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
  if (['ArrowFunctionExpression', 'FunctionExpression', 'FunctionDeclaration', 'ObjectMethod'].includes(node.type)) return combined.concat(returnedExpressions(node.body).flatMap(expression => staticLiteralLeaves(expression, bindings, resolving)))
  if (node.type === 'CallExpression' || node.type === 'OptionalCallExpression' || node.type === 'NewExpression') {
    const reference = memberReference(node.callee)
    const returned = node.callee?.type === 'Identifier' && bindings.has(node.callee.name)
      ? referencedBindingLeaves(node.callee.name, [], bindings, resolving)
      : reference ? referencedBindingLeaves(reference.name, reference.path, bindings, resolving) : []
    const receiver = ['MemberExpression', 'OptionalMemberExpression'].includes(node.callee?.type)
      ? staticExpressionPossibilities(node.callee.object, bindings, resolving).filter(value => typeof value === 'string' && value)
      : []
    return combined.concat(returned, receiver, node.arguments.flatMap(argument => staticLiteralLeaves(argument, bindings, resolving)))
  }
  if (node.type === 'ObjectExpression') return combined.concat(node.properties.flatMap(property => property.type === 'SpreadElement' ? staticLiteralLeaves(property.argument, bindings, resolving) : staticLiteralLeaves(propertyExpression(property), bindings, resolving)))
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
const staticIterationBindingValues = (name, path, bindings, resolving) => {
  const resolution = `${name}.${path.join('.')}`
  if (resolving.has(resolution)) return []
  const next = new Set(resolving).add(resolution)
  return (bindings.get(name) || []).flatMap(initializer => staticIterationValues(initializer, bindings, next, path))
}
const staticIterationValues = (node, bindings, resolving = new Set(), path = []) => {
  node = unwrapExpression(node)
  if (!node) return []
  if (node.type === 'Identifier') return staticIterationBindingValues(node.name, path, bindings, resolving)
  if (node.type === 'MemberExpression' || node.type === 'OptionalMemberExpression') {
    const reference = memberReference(node)
    return reference ? staticIterationBindingValues(reference.name, reference.path.concat(path), bindings, resolving) : []
  }
  if (['ArrowFunctionExpression', 'FunctionExpression', 'FunctionDeclaration', 'ObjectMethod'].includes(node.type)) return returnedExpressions(node.body).flatMap(expression => staticIterationValues(expression, bindings, resolving, path))
  if (node.type === 'ConditionalExpression') return staticIterationValues(node.consequent, bindings, resolving, path).concat(staticIterationValues(node.alternate, bindings, resolving, path))
  if (node.type === 'LogicalExpression') return staticIterationValues(node.left, bindings, resolving, path).concat(staticIterationValues(node.right, bindings, resolving, path))
  if (node.type === 'CallExpression' || node.type === 'OptionalCallExpression') {
    const remaining = path[0] === 'value' ? path.slice(1) : path
    const reference = memberReference(node.callee)
    const returned = node.callee?.type === 'Identifier' && bindings.has(node.callee.name)
      ? staticIterationBindingValues(node.callee.name, remaining, bindings, resolving)
      : reference ? staticIterationBindingValues(reference.name, reference.path.concat(remaining), bindings, resolving) : []
    return returned.concat(node.arguments.flatMap(argument => staticIterationValues(argument, bindings, resolving, remaining)))
  }
  if (path.length) {
    const [head, ...tail] = path
    if (node.type === 'ArrayExpression') return /^\d+$/.test(head) && node.elements[Number(head)] ? staticIterationValues(node.elements[Number(head)], bindings, resolving, tail) : []
    if (node.type === 'ObjectExpression') return node.properties.flatMap(property => {
      if (property.type === 'SpreadElement') return staticIterationValues(property.argument, bindings, resolving, path)
      return staticPropertyKey(property.key) === head ? staticIterationValues(propertyExpression(property), bindings, resolving, tail) : []
    })
    return []
  }
  if (node.type === 'ArrayExpression') return node.elements.filter(Boolean)
  if (node.type === 'ObjectExpression') return node.properties.flatMap(property => property.type === 'SpreadElement' ? staticIterationValues(property.argument, bindings, resolving) : [propertyExpression(property)])
  return []
}
const bindTemplatePattern = (pattern, values, target) => {
  pattern = unwrapExpression(pattern)
  const selected = (value, key) => {
    value = unwrapExpression(value)
    if (value?.type === 'ArrayExpression' && /^\d+$/.test(String(key))) return value.elements[Number(key)]
    if (value?.type === 'ObjectExpression') {
      const property = [...value.properties].reverse().find(candidate => candidate.type !== 'SpreadElement' && staticPropertyKey(candidate.key) === String(key))
      if (property) return propertyExpression(property)
      if (!value.properties.some(candidate => candidate.type === 'SpreadElement')) return undefined
    }
    return { type: 'MemberExpression', object: value, property: { type: 'StringLiteral', value: String(key) }, computed: true }
  }
  if (pattern?.type === 'Identifier') { target.set(pattern.name, values.filter(Boolean)); return }
  if (pattern?.type === 'AssignmentPattern') {
    bindTemplatePattern(pattern.left, [...values.filter(value => value !== undefined), ...(values.length === 0 || values.includes(undefined) ? [pattern.right] : [])], target)
    return
  }
  if (pattern?.type === 'RestElement') { bindTemplatePattern(pattern.argument, values, target); return }
  if (pattern?.type === 'ObjectPattern') {
    const excluded = new Set(pattern.properties.filter(property => property.type !== 'RestElement').map(property => staticPropertyKey(property.key)))
    for (const property of pattern.properties) {
      if (property.type === 'RestElement') bindTemplatePattern(property.argument, values.map(value => {
        value = unwrapExpression(value)
        return value?.type === 'ObjectExpression'
          ? { type: 'ObjectExpression', properties: value.properties.filter(candidate => candidate.type === 'SpreadElement' || !excluded.has(staticPropertyKey(candidate.key))) }
          : value
      }), target)
      else bindTemplatePattern(property.value, values.map(value => selected(value, staticPropertyKey(property.key))), target)
    }
  }
  if (pattern?.type === 'ArrayPattern') for (let index = 0; index < pattern.elements.length; index += 1) if (pattern.elements[index]) {
    const element = pattern.elements[index]
    bindTemplatePattern(element, element.type === 'RestElement' ? values.map(value => {
      value = unwrapExpression(value)
      return value?.type === 'ArrayExpression' ? { type: 'ArrayExpression', elements: value.elements.slice(index) } : value
    }) : values.map(value => selected(value, index)), target)
  }
}
const bindingsForElement = (node, bindings) => {
  const scoped = new Map(bindings)
  const loop = vForParts(node)
  if (loop) {
    let sourceAst
    try { sourceAst = vueCompiler.babelParse(`(${loop.source})`, { sourceType: 'module', plugins: ['typescript'] }).program.body[0]?.expression }
    catch (error) { throw new Error(`v-for source must parse cleanly: ${error.message}`, { cause: error }) }
    const values = staticIterationValues(sourceAst, bindings)
    const patterns = templateBindingPatterns(loop.bindings, 'pricing v-for aliases')
    for (let index = 0; index < patterns.length; index += 1) bindTemplatePattern(patterns[index], index === 0 ? values : [], scoped)
  }
  for (const slot of node.props?.filter(prop => prop.type === 7 && prop.name === 'slot' && prop.exp?.content) || []) {
    for (const pattern of templateBindingPatterns(slot.exp.content, 'pricing slot props')) bindTemplatePattern(pattern, [], scoped)
  }
  return scoped
}
const visibleStrings = source => {
  const values = []
  const bindings = staticBindingInitializers(source)
  const visibleAttributes = new Set(['alt', 'aria-label', 'placeholder', 'title'])
  const visit = (node, inheritedBindings = bindings) => {
    const scopedBindings = node.type === 1 ? bindingsForElement(node, inheritedBindings) : inheritedBindings
    if (node.type === 2 && node.content.trim()) values.push(node.content.trim())
    if (node.type === 5) values.push(...literalExpressionStrings(node.content.content, scopedBindings))
    if (node.type === 1) for (const prop of node.props) {
      if (prop.type === 6 && visibleAttributes.has(prop.name) && prop.value?.content) values.push(prop.value.content)
      const visibleBinding = prop.type === 7 && prop.name === 'bind' && prop.arg?.type === 4 && prop.arg.isStatic && visibleAttributes.has(prop.arg.content)
      const visibleDirective = prop.type === 7 && ['text', 'html'].includes(prop.name)
      if ((visibleBinding || visibleDirective) && prop.exp?.content) values.push(...literalExpressionStrings(prop.exp.content, scopedBindings))
    }
    for (const child of new Set(reachableChildPaths(node).flat())) visit(child, scopedBindings)
    for (const branch of reachableVueBranches(node)) visit(branch, scopedBindings)
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
const normalizeSelector = selector => selector.trim().replace(/\s*([>+~])\s*/g, '$1').replace(/\s+/g, ' ')
const exactRules = (root, selector, context = 'base') => {
  const matches = []
  for (const rule of root) {
    if (!rule.selectors?.some(value => normalizeSelector(value) === normalizeSelector(selector))) continue
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
const mediaQueryIsScreen = query => {
  if (/(?:^|\s|\()print(?:\s|$|\))/i.test(query) && !/not\s+print/i.test(query)) return false
  if (/not\s+screen/i.test(query)) return false
  if (/(?:^|\s|\()speech(?:\s|$|\))/i.test(query) && !/not\s+speech/i.test(query)) return false
  return true
}
const widthComparison = (width, operator, threshold) => ({ '>': width > threshold, '>=': width >= threshold, '<': width < threshold, '<=': width <= threshold }[operator])
const mediaQueryMatchesScreen = (query, width) => {
  if (!mediaQueryIsScreen(query)) return false
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
const mediaMatchesScreen = (conditions, width) => conditions.every(condition => splitCssTopLevel(condition, ',').some(query => mediaQueryMatchesScreen(query, width)))
const representativeScreenWidths = (...stylesheets) => {
  const thresholds = [...new Set(stylesheets.flat().flatMap(rule => rule.media.flatMap(condition => splitCssTopLevel(condition, ',')))
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
const selectorStructure = selector => {
  const compounds = []
  const combinators = []
  let buffer = ''
  let pending
  let leading
  let quote = ''
  let escaped = false
  let depth = 0
  const push = () => {
    const value = buffer.trim()
    if (!value) return
    if (compounds.length) combinators.push(pending || ' ')
    else if (pending) leading = pending
    compounds.push(value)
    buffer = ''
    pending = undefined
  }
  for (let index = 0; index < selector.length; index += 1) {
    const character = selector[index]
    if (escaped) { escaped = false; buffer += character; continue }
    if (quote) {
      if (character === '\\') escaped = true
      else if (character === quote) quote = ''
      buffer += character
      continue
    }
    if (character === '"' || character === "'") { quote = character; buffer += character }
    else if (character === '(' || character === '[') { depth += 1; buffer += character }
    else if (character === ')' || character === ']') { depth -= 1; buffer += character }
    else if (depth === 0 && /\s/.test(character)) { push(); if (compounds.length && pending !== '>') pending = pending || ' ' }
    else if (depth === 0 && /[>+~]/.test(character)) { push(); pending = character }
    else buffer += character
  }
  push()
  return { compounds, combinators, leading }
}
const selectorCompounds = selector => selectorStructure(selector).compounds
const compoundTokens = compound => [...compound.matchAll(/[.#:][\w-]+|\[[^\]]+\]|(?:^|(?<=[^\w.#:-]))[a-z][\w-]*/gi)].map(match => match[0])
const compoundSubjectAlternatives = compound => {
  const expand = subject => {
    const match = /:([\w-]+)\s*\(/.exec(subject)
    if (!match) return [subject]
    const open = subject.indexOf('(', match.index)
    let cursor = open + 1
    let depth = 1
    let quote = ''
    for (; cursor < subject.length && depth > 0; cursor += 1) {
      const character = subject[cursor]
      if (quote) { if (character === quote && subject[cursor - 1] !== '\\') quote = '' }
      else if (character === '"' || character === "'") quote = character
      else if (character === '(') depth += 1
      else if (character === ')') depth -= 1
    }
    if (depth !== 0) return [subject]
    const before = subject.slice(0, match.index)
    const after = subject.slice(cursor)
    if (!['is', 'where'].includes(match[1].toLowerCase())) return expand(before + after || '*')
    return splitCssTopLevel(subject.slice(open + 1, cursor - 1), ',').flatMap(branch => expand(`${before}${selectorCompounds(branch).at(-1) || ''}${after}`))
  }
  return expand(compound)
}
const functionalPseudoArguments = (compound, names) => {
  const matches = []
  for (let start = 0; start < compound.length;) {
    const match = /:([\w-]+)\s*\(/.exec(compound.slice(start))
    if (!match) break
    const index = start + match.index
    const open = compound.indexOf('(', index)
    let cursor = open + 1
    let depth = 1
    let quote = ''
    for (; cursor < compound.length && depth > 0; cursor += 1) {
      const character = compound[cursor]
      if (quote) { if (character === quote && compound[cursor - 1] !== '\\') quote = '' }
      else if (character === '"' || character === "'") quote = character
      else if (character === '(') depth += 1
      else if (character === ')') depth -= 1
    }
    if (depth !== 0) break
    if (names.has(match[1].toLowerCase())) matches.push(compound.slice(open + 1, cursor - 1))
    start = cursor
  }
  return matches
}
const compoundMayTarget = (candidate, target) => {
  const targetTokens = target instanceof Set ? new Set(target) : new Set(compoundTokens(target))
  const targetIdentities = [...targetTokens].filter(token => !token.startsWith(':'))
  const matches = subject => {
    const match = /:([\w-]+)\s*\(/.exec(subject)
    if (match) {
      const open = subject.indexOf('(', match.index)
      let cursor = open + 1; let depth = 1; let quote = ''
      for (; cursor < subject.length && depth > 0; cursor += 1) {
        const character = subject[cursor]
        if (quote) { if (character === quote && subject[cursor - 1] !== '\\') quote = '' }
        else if (character === '"' || character === "'") quote = character
        else if (character === '(') depth += 1
        else if (character === ')') depth -= 1
      }
      if (depth === 0) {
        const base = `${subject.slice(0, match.index)}${subject.slice(cursor)}` || '*'
        const branches = splitCssTopLevel(subject.slice(open + 1, cursor - 1), ',')
        const name = match[1].toLowerCase()
        if (['is', 'where'].includes(name)) return branches.some(branch => matches(`${subject.slice(0, match.index)}${selectorCompounds(branch).at(-1) || '*'}${subject.slice(cursor)}`))
        if (name === 'not') return matches(base) && branches.every(branch => !matches(selectorCompounds(branch).at(-1) || '*'))
        return matches(base)
      }
    }
    const identities = compoundTokens(subject).filter(token => token !== '*' && !token.startsWith(':'))
    const targetTags = targetIdentities.filter(token => !/^(?:[.#]|\[)/.test(token))
    const subjectTags = identities.filter(token => !/^(?:[.#]|\[)/.test(token))
    const subjectQualifiers = identities.filter(token => /^(?:[.#]|\[)/.test(token))
    return identities.length === 0 || (targetIdentities.length > 0
      && !(subjectTags.length && targetTags.length === 0 && subjectQualifiers.length === 0)
      && identities.every(token => /^(?:[.#]|\[)/.test(token) ? targetTokens.has(token) : targetTags.length === 0 || targetTags.includes(token)))
  }
  return matches(candidate)
}
const selectorGroup = (...identities) => new Set(identities)
const publicContentPath = [selectorGroup('html', ':root'), selectorGroup('body'), selectorGroup('#app'), selectorGroup('.public-layout', '.public-shell', '.shell'), selectorGroup('main', '#public-content')]
const publicPricingPath = [...publicContentPath, selectorGroup('.pricing-page')]
const resultsPath = [...publicPricingPath, selectorGroup('.pricing-layout'), selectorGroup('.pricing-results')]
const detailPath = [...publicContentPath, selectorGroup('.pricing-detail')]
const pricingRenderPaths = new Map([
  ['.pricing-page', [publicPricingPath.slice(0, -1)]],
  ['.pricing-layout', [[...publicPricingPath]]],
  ['.pricing-results', [[...publicPricingPath, selectorGroup('.pricing-layout')]]],
  ['.pricing-table-wrap', [[...resultsPath]]],
  ['.pricing-table', [[...resultsPath, selectorGroup('.pricing-table-wrap')]]],
  ['.pricing-cards', [[...resultsPath]]],
  ['.pricing-toolbar', [[...publicPricingPath]]],
  ['.pricing-filter-toggle', [[...publicPricingPath, selectorGroup('.pricing-toolbar')]]],
  ['.pricing-drawer-backdrop', [[...publicPricingPath]]],
  ['.pricing-drawer', [[...publicPricingPath, selectorGroup('.pricing-drawer-backdrop')]]],
  ['.pricing-pagination button', [[...resultsPath, selectorGroup('.pricing-pagination')]]],
  ['.pricing-pagination select', [[...resultsPath, selectorGroup('.pricing-pagination')]]],
  ['.pricing-detail-back', [[...detailPath]]],
  ['.pricing-console-cta', [[...detailPath]]],
  ['.pricing-drawer > header button', [[...publicPricingPath, selectorGroup('.pricing-drawer-backdrop'), selectorGroup('.pricing-drawer'), selectorGroup('header')]]],
])
const pricingTargetTags = new Map([
  ['.pricing-page', 'div'], ['.pricing-layout', 'div'], ['.pricing-results', 'section'], ['.pricing-table-wrap', 'div'],
  ['.pricing-table', 'table'], ['.pricing-cards', 'div'], ['.pricing-toolbar', 'div'], ['.pricing-filter-toggle', 'button'],
  ['.pricing-drawer-backdrop', 'div'], ['.pricing-drawer', 'section'], ['.pricing-detail-back', 'button'], ['.pricing-console-cta', 'a'],
])
const targetIdentityGroup = target => {
  const group = new Set(compoundTokens(selectorCompounds(target).at(-1) || target).filter(token => token === '*' || !token.startsWith(':')))
  const tag = pricingTargetTags.get(normalizeSelector(target))
  if (tag) group.add(tag)
  return group
}
const structureMatchesPricingPath = (structure, path, depth = 0) => {
  const { compounds, combinators, leading } = structure
  if (!compounds.length || !path.length || ['+', '~'].some(value => combinators.includes(value) || leading === value)) return false
  const matchFrom = (compoundIndex, pathIndex) => {
    if (pathIndex < 0 || !compoundMatchesPricingGroup(compounds[compoundIndex], path[pathIndex], depth)) return false
    if (compoundIndex === 0) return leading !== '>' || pathIndex === 0
    const relation = combinators[compoundIndex - 1] || ' '
    if (relation === '>') return matchFrom(compoundIndex - 1, pathIndex - 1)
    for (let candidate = pathIndex - 1; candidate >= 0; candidate -= 1) if (matchFrom(compoundIndex - 1, candidate)) return true
    return false
  }
  return matchFrom(compounds.length - 1, path.length - 1)
}
const pricingSiblingPaths = new Map([
  ['.pricing-cards', [{ group: targetIdentityGroup('.pricing-table-wrap'), ancestors: resultsPath, adjacent: true }]],
])
const pricingSiblingSelectorMatches = (structure, target) => {
  const siblingIndex = structure.combinators.findLastIndex(combinator => combinator === '+' || combinator === '~')
  if (siblingIndex < 0 || siblingIndex !== structure.combinators.length - 1 || !compoundMatchesPricingGroup(structure.compounds.at(-1), targetIdentityGroup(target))) return false
  const relation = structure.combinators[siblingIndex]
  const prefix = { compounds: structure.compounds.slice(0, -1), combinators: structure.combinators.slice(0, -1), leading: structure.leading }
  return (pricingSiblingPaths.get(normalizeSelector(target)) || []).some(sibling => (relation === '~' || sibling.adjacent)
    && structureMatchesPricingPath(prefix, [...sibling.ancestors, sibling.group]))
}
const pricingHasDescendants = (compound, subjectIdentity, depth = 0) => {
  const argumentsByPseudo = functionalPseudoArguments(compound, new Set(['has'])).map(value => splitCssTopLevel(value, ','))
  if (!argumentsByPseudo.length) return true
  if (depth > 12) return false
  return argumentsByPseudo.every(branches => branches.some(branch => [...pricingRenderPaths].some(([descendant, paths]) => paths.some(path => {
    const fullPath = [...path, targetIdentityGroup(descendant)]
    return fullPath.some((group, subjectIndex) => group.has(subjectIdentity)
      && structureMatchesPricingPath(selectorStructure(branch), fullPath.slice(subjectIndex + 1), depth + 1))
  }))))
}
const compoundMatchesPricingGroup = (compound, group, depth = 0) => compoundMayTarget(compound, group)
  && [...group].some(identity => pricingHasDescendants(compound, identity, depth))
const compoundsMatchPricingPath = (compounds, path, depth = 0) => {
  let cursor = 0
  for (const compound of compounds) {
    while (cursor < path.length && !compoundMatchesPricingGroup(compound, path[cursor], depth)) cursor += 1
    if (cursor >= path.length) return false
    cursor += 1
  }
  return true
}
const leadingCompoundsAreKnown = (compounds, target) => compounds.length === 0 || (pricingRenderPaths.get(normalizeSelector(target)) || []).some(path => compoundsMatchPricingPath(compounds, path))
const selectorTargetsContract = (selector, target) => {
  const candidateStructure = selectorStructure(selector)
  const candidateCompounds = candidateStructure.compounds
  const targetCompounds = selectorCompounds(target)
  if (candidateCompounds.length < targetCompounds.length) return false
  if (targetCompounds.length === 1) {
    const paths = pricingRenderPaths.get(normalizeSelector(target)) || []
    if (candidateStructure.combinators.some(combinator => combinator === '+' || combinator === '~')) return pricingSiblingSelectorMatches(candidateStructure, target)
    return paths.length
      ? paths.some(path => structureMatchesPricingPath(candidateStructure, [...path, targetIdentityGroup(target)]))
      : candidateCompounds.length === 1 && compoundMayTarget(candidateCompounds[0], targetCompounds[0])
  }
  const offset = candidateCompounds.length - targetCompounds.length
  return leadingCompoundsAreKnown(candidateCompounds.slice(0, offset), target)
    && targetCompounds.every((compound, index) => compoundMayTarget(candidateCompounds[offset + index], compound))
    && compoundMatchesPricingGroup(candidateCompounds.at(-1), targetIdentityGroup(target))
}
const relationalSelectorTargetsRoot = (selector, target) => {
  const structure = selectorStructure(selector)
  const subject = structure.compounds.at(-1) || ''
  const argumentsByPseudo = functionalPseudoArguments(subject, new Set(['has'])).map(value => splitCssTopLevel(value, ','))
  if (!argumentsByPseudo.length) return false
  return (pricingRenderPaths.get(normalizeSelector(target)) || []).some(path => {
    const fullPath = [...path, targetIdentityGroup(target)]
    return fullPath.slice(0, -1).some((group, subjectIndex) => compoundMatchesPricingGroup(subject, group)
      && structureMatchesPricingPath(structure, fullPath.slice(0, subjectIndex + 1)))
  })
}
const rootSelectorSpecificity = selector => {
  let score = 0
  let plain = ''
  for (let cursor = 0; cursor < selector.length;) {
    const match = /:([\w-]+)\s*\(/.exec(selector.slice(cursor))
    if (!match) { plain += selector.slice(cursor); break }
    const index = cursor + match.index
    plain += selector.slice(cursor, index)
    const open = selector.indexOf('(', index)
    let end = open + 1
    let depth = 1
    for (; end < selector.length && depth > 0; end += 1) { if (selector[end] === '(') depth += 1; else if (selector[end] === ')') depth -= 1 }
    if (depth !== 0) { plain += selector.slice(index); break }
    const name = match[1].toLowerCase()
    if (name !== 'where') score += ['is', 'not', 'has'].includes(name) ? Math.max(0, ...splitCssTopLevel(selector.slice(open + 1, end - 1), ',').map(rootSelectorSpecificity)) : 10
    cursor = end
  }
  return score + (plain.match(/#[\w-]+/g) || []).length * 100 + (plain.match(/\.[\w-]+|\[[^\]]+\]|:(?!:)[\w-]+/g) || []).length * 10 + (plain.match(/(?:^|[\s>+~])(?:[a-z][\w-]*|\*)/gi) || []).filter(token => !token.trim().endsWith('*')).length
}
const effectiveSelectorProperties = (rules, selector, width, exactOnly = false) => {
  const winners = new Map()
  for (const rule of rules) {
    if (!mediaMatchesScreen(rule.media, width)) continue
    const matching = rule.selectors.filter(candidate => exactOnly
      ? normalizeSelector(candidate) === normalizeSelector(selector)
      : selectorTargetsContract(candidate, selector))
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
const effectiveRootProperties = (rules, targetClass, width) => {
  const properties = effectiveSelectorProperties(rules, `.${targetClass}`, width)
  const ancestors = {
    'pricing-table': ['.pricing-table-wrap', '.pricing-results', '.pricing-layout', '.pricing-page'],
    'pricing-cards': ['.pricing-results', '.pricing-layout', '.pricing-page'],
    'pricing-filter-toggle': ['.pricing-toolbar', '.pricing-page'],
    'pricing-drawer': ['.pricing-drawer-backdrop', '.pricing-page'],
  }[targetClass] || []
  const hidden = value => value.get('display') === 'none' || ['hidden', 'collapse'].includes(value.get('visibility')) || /^(?:0(?:\.0+)?|\.0+)$/.test(value.get('opacity') || '')
  if (ancestors.some(ancestor => hidden(effectiveSelectorProperties(rules, ancestor, width)))) return new Map(properties).set('display', 'none')
  const relationalAncestors = new Set(rules.flatMap(rule => rule.selectors.filter(selector => relationalSelectorTargetsRoot(selector, `.${targetClass}`))))
  if ([...relationalAncestors].some(selector => hidden(effectiveSelectorProperties(rules, selector, width, true)))) return new Map(properties).set('display', 'none')
  return properties
}
const rootIsHidden = properties => properties.get('display') === 'none' || ['hidden', 'collapse'].includes(properties.get('visibility')) || /^(?:0(?:\.0+)?|\.0+)$/.test(properties.get('opacity') || '')
const assertProperty = (root, selector, property, expected, message, context = 'base') => {
  const actual = propertyMap(exactRules(root, selector, context)).get(property) || []
  assert.ok(actual.includes(expected), `${message}; found ${JSON.stringify(actual)}`)
}
const assertControlSize = (root, selector, properties, widths) => {
  for (const width of widths) for (const property of properties) for (const exactOnly of [true, false]) {
    const axis = property.endsWith('height') ? 'height' : 'width'
    const values = effectiveSelectorProperties(root, selector, width, exactOnly)
    const pixels = value => value === 'var(--control-min-size)' ? 44 : /^\d+(?:\.\d+)?px$/.test(value || '') ? Number.parseFloat(value) : Number.NaN
    const minimum = pixels(values.get(`min-${axis}`))
    const preferred = pixels(values.get(axis))
    const maximum = values.get(`max-${axis}`) === 'none' ? Number.POSITIVE_INFINITY : pixels(values.get(`max-${axis}`))
    const effective = Number.isFinite(minimum)
      ? (Number.isFinite(preferred) ? Math.max(minimum, Number.isFinite(maximum) ? Math.min(preferred, maximum) : preferred) : minimum)
      : (Number.isFinite(preferred) ? (Number.isFinite(maximum) ? Math.min(preferred, maximum) : preferred) : Number.NaN)
    const scope = exactOnly ? 'stable selector' : 'effective cascade'
    assert.ok(Number.isFinite(effective) && effective >= 44, `${selector} ${axis} must stay at least 44px at ${width}px in its ${scope}; found min=${JSON.stringify(values.get(`min-${axis}`))}, ${axis}=${JSON.stringify(values.get(axis))}, max=${JSON.stringify(values.get(`max-${axis}`))}`)
  }
}
const numericPerRequestOffer = /(?:(?:每(?:次)?请求|每请求|单次(?:请求|调用)|per[-\s]?request)[^.!。；;\n]{0,40}(?:[$¥￥]\s*\d|\d+(?:\.\d+)?\s*(?:USD|CNY|元|美元))|(?:[$¥￥]\s*\d|\d+(?:\.\d+)?\s*(?:USD|CNY|元|美元))[^.!。；;\n]{0,24}(?:每(?:次)?请求|每请求|单次(?:请求|调用)|per[-\s]?request)|(?:[$¥￥]\s*\d+(?:\.\d+)?|\d+(?:\.\d+)?\s*(?:USD|CNY))\s*\/\s*request)/i
const perRequestPriceClaim = /(?:单次调用价|每次请求(?:价格|价)|每请求(?:价格|价)|per[- ]request\s+(?:prices?|pricing))/gi
const locallyNegatedPerRequestClaim = (value, match) => {
  const before = value.slice(Math.max(0, match.index - 48), match.index)
  const after = value.slice(match.index + match[0].length, match.index + match[0].length + 48)
  const negativeBefore = /(?:\bno(?:\s+(?:public|published?|displayed?|separate|individual|standalone|listed|available))*\s+|\b(?:do|does|did|will|would|can|could|should)\s+not\s+(?:offer|show|display|provide|publish)(?:\s+(?:public|separate|individual|standalone|listed|available))*\s+|\b(?:don['’]t|doesn['’]t|didn['’]t|won['’]t|wouldn['’]t|can['’]t|couldn['’]t|shouldn['’]t)\s+(?:offer|show|display|provide|publish)(?:\s+(?:public|separate|individual|standalone|listed|available))*\s+|\bnever\s+(?:offer|show|display|provide|publish)(?:\s+(?:public|separate|individual|standalone|listed|available))*\s+|(?:不|未)\s*(?:单独\s*)?(?:提供|展示|显示|公布|采用|支持)(?:\s*(?:公开(?:的)?|单独(?:的)?|独立(?:的)?|另外(?:的)?))*\s*)$/iu.test(before)
  const negativeAfter = /^(?:\s*(?:(?:is|are|was|were)\s+)?(?:not|never)\s+(?:offered|provided|available|displayed|shown)\b|\s*(?:is|are|was|were)\s+unavailable\b|\s*(?:isn['’]t|aren['’]t|wasn['’]t|weren['’]t)\s+(?:offered|provided|available|displayed|shown)\b|\s*(?:won['’]t|wouldn['’]t)\s+be\s+(?:offered|provided|available|displayed|shown)\b|\s*(?:不|未)\s*(?:单独\s*)?(?:计价|定价|收费|提供|展示|显示|公布|可用)|\s*不可用)/iu.test(after)
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
  const pageTemplate = templateAst(page)
  const sidebar = renderedElements(pageTemplate, 'aside').find(node => hasClass(node, 'pricing-sidebar'))
  const drawer = renderedElements(pageTemplate, 'section').find(node => hasClass(node, 'pricing-drawer'))
  const results = renderedElements(pageTemplate, 'section').find(node => hasClass(node, 'pricing-results'))
  assert.ok(sidebar && renderedElements(sidebar, 'PricingFilters').length === 1, 'desktop pricing sidebar must render PricingFilters')
  assert.ok(drawer && renderedElements(drawer, 'PricingFilters').length === 1, 'mobile pricing drawer must render PricingFilters')
  assert.ok(results && renderedElements(results, 'PricingTable').length === 1, 'desktop pricing results must render PricingTable')
  assert.ok(results && renderedElements(results, 'PricingCards').length === 1, 'mobile pricing results must render PricingCards')
  const pricingCss = styleRoot(styles)
  const filterCss = styleRoot(filters, true)
  const responsiveCss = parseCssRules(`${parseVue(table).styles.map(style => style.content).join('\n')}\n${parseVue(cards).styles.map(style => style.content).join('\n')}\n${styles}`)
  const widths = representativeScreenWidths(responsiveCss, filterCss)
  const mobileWidths = widths.filter(width => width <= 767)
  const desktopWidths = widths.filter(width => width >= 768)
  assert.match(page, /@\/styles\/public-pricing\.scss/)
  assertProperty(pricingCss, '.pricing-page', 'max-width', '1600px', 'pricing page keeps its desktop width')
  assertProperty(pricingCss, '.pricing-layout', 'grid-template-columns', '260px minmax(0, 1fr)', 'pricing layout keeps the approved sidebar grid')
  for (const className of ['pricing-layout', 'pricing-sidebar', 'pricing-toolbar', 'pricing-results-count']) assert.match(page, new RegExp(`class\\s*=\\s*(["'])[^"']*\\b${className}\\b[^"']*\\1`))
  assert.match(page, /role\s*=\s*(["'])dialog\1/); assert.match(page, /aria-modal\s*=\s*(["'])true\1/)
  assert.match(page, /aria-controls\s*=\s*(["'])pricing-filter-drawer\1/); assert.match(page, /:aria-expanded\s*=\s*(["'])drawerOpen\1/)
  for (const field of ['search', 'provider', 'capability', 'endpoint', 'group', 'sort']) assert.match(filters, new RegExp(`name\\s*=\\s*(["'])${field}\\1`))
  const tableRoot = renderedElements(templateAst(table), 'table').find(node => hasClass(node, 'pricing-table'))
  const cardsRoot = renderedElements(templateAst(cards), 'div').find(node => hasClass(node, 'pricing-cards'))
  assert.ok(tableRoot, 'PricingTable must render the pricing-table root')
  assert.ok(cardsRoot, 'PricingCards must render the pricing-cards root')
  const tableModelName = vForAlias(renderedElements(renderedElements(tableRoot, 'tbody')[0], 'tr')[0])
  const cardModelName = vForAlias(renderedElements(cardsRoot, 'article')[0])
  assert.ok(tableModelName, 'pricing table rows must render from a model iteration')
  assert.ok(cardModelName, 'pricing cards must render from a model iteration')
  const tableBindings = staticBindingInitializers(table, '../../components/public/PricingTable.vue')
  const cardBindings = staticBindingInitializers(cards, '../../components/public/PricingCards.vue')
  for (const component of ['input', 'output']) {
    const key = `pricingCatalog.${component}Price`
    const tableHeaders = renderedElements(renderedElements(tableRoot, 'thead')[0], 'th')
    const headerIndex = tableHeaders.findIndex(node => templateExpressionAsts(node).some(expression => callsFunction(expression, 't', key)))
    const tableCells = renderedElements(renderedElements(tableRoot, 'tbody')[0], 'td')
    const tableHeader = tableHeaders[headerIndex]
    const tableCell = tableCells[headerIndex - 1]
    assert.ok(tableHeader && tableCell, `table must render ${key} beside the ${component} price cell`)
    assert.ok(templateExpressionAsts(tableCell).some(expression => renderedPriceStateFor(expression, component, tableModelName, tableBindings)), `table ${key} column must render publicPriceState for ${component}`)
    assert.ok(templateExpressionAsts(tableCell).some(expression => renderedPriceLabelFor(expression, component, tableModelName, tableBindings)), `table ${component} price cell must render a state-aware publicPriceState label`)
    const cardGroup = renderedElements(cardsRoot, 'dl').flatMap(node => renderedElements(node, 'div')).find(node => {
      const expressions = templateExpressionAsts(node)
      return expressions.some(expression => callsFunction(expression, 't', key)) && expressions.some(expression => renderedPriceStateFor(expression, component, cardModelName, cardBindings))
    })
    assert.ok(cardGroup, `card must render ${key} with the ${component} price value`)
    assert.ok(templateExpressionAsts(cardGroup).some(expression => renderedPriceLabelFor(expression, component, cardModelName, cardBindings)), `card ${component} price cell must render a state-aware publicPriceState label`)
  }
  for (const width of desktopWidths) assert.equal(rootIsHidden(effectiveRootProperties(responsiveCss, 'pricing-table', width)), false, `desktop .pricing-table root must remain visible at ${width}px`)
  for (const width of mobileWidths) {
    for (const target of ['pricing-cards', 'pricing-filter-toggle', 'pricing-drawer']) assert.equal(rootIsHidden(effectiveRootProperties(responsiveCss, target, width)), false, `mobile .${target} root must remain visible at ${width}px`)
    assert.equal(rootIsHidden(effectiveRootProperties(responsiveCss, 'pricing-table', width)), true, `mobile must hide the exact .pricing-table root at ${width}px`)
  }
  assertControlSize(filterCss, '.pricing-filters input', ['min-height'], widths)
  assertControlSize(filterCss, '.pricing-filters select', ['min-height'], widths)
  assertControlSize(pricingCss, '.pricing-pagination button', ['min-height'], widths)
  assertControlSize(pricingCss, '.pricing-pagination select', ['min-height'], widths)
  assertControlSize(pricingCss, '.pricing-filter-toggle', ['min-height'], mobileWidths)
  assertControlSize(pricingCss, '.pricing-drawer > header button', ['min-width', 'min-height'], mobileWidths)
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
