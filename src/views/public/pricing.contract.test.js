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
const renderedElements = (root, name) => {
  const matches = []
  const visit = node => {
    if (staticallyHidden(node)) return
    if (node.type === 1 && node.tag === name) matches.push(node)
    for (const child of node.children || []) visit(child)
    for (const branch of node.branches || []) visit(branch)
  }
  visit(root)
  return matches
}
const templateExpressionAsts = root => {
  const expressions = []
  const add = content => {
    if (!content) return
    try { expressions.push(vueCompiler.babelParse(`(${content})`, { sourceType: 'module', plugins: ['typescript'] }).program.body[0]?.expression) }
    catch (error) { throw new Error(`pricing rendered expression must parse cleanly: ${error.message}`, { cause: error }) }
  }
  const visit = node => {
    if (staticallyHidden(node)) return
    if (node.type === 5) add(node.content.content)
    if (node.type === 1) for (const prop of node.props || []) if (prop.type === 7 && prop.exp?.content) add(prop.exp.content)
    for (const child of node.children || []) visit(child)
    for (const branch of node.branches || []) visit(branch)
  }
  visit(root)
  return expressions.filter(Boolean)
}
const astContains = (node, predicate) => {
  if (!node || typeof node !== 'object') return false
  if (predicate(node)) return true
  return Object.entries(node).some(([key, value]) => !['loc', 'start', 'end', 'extra'].includes(key) && (Array.isArray(value) ? value.some(item => astContains(item, predicate)) : astContains(value, predicate)))
}
const callsFunction = (node, name, argument) => astContains(node, candidate => {
  if (!['CallExpression', 'OptionalCallExpression'].includes(candidate.type) || candidate.callee?.type !== 'Identifier' || candidate.callee.name !== name) return false
  if (argument === undefined) return true
  return candidate.arguments.some(value => value?.type === 'StringLiteral' && value.value === argument)
})
const memberUsesState = node => astContains(node, candidate => ['MemberExpression', 'OptionalMemberExpression'].includes(candidate.type) && !candidate.computed && candidate.property?.name === 'state')
const functionParameters = node => ['ArrowFunctionExpression', 'FunctionExpression', 'FunctionDeclaration', 'ObjectMethod'].includes(node?.type) ? node.params || [] : []
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
      if (property.type === 'SpreadElement') return expressionDerivedFrom(property.argument, origins, definitions, path, resolving)
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
const legitimateFallback = (node, origins, definitions, mode) => {
  node = unwrapExpression(node)
  if (mode !== 'nonpublished' || !node) return false
  if (node.type === 'StringLiteral') return /^(?:—|-|N\/A)$/i.test(node.value.trim())
  if (!['CallExpression', 'OptionalCallExpression'].includes(node.type) || node.callee?.type !== 'Identifier' || node.callee.name !== 't') return false
  const members = directlyReadStateMembers(node.arguments, origins, definitions)
  const knownFallbackKey = node.arguments.some(argument => argument?.type === 'StringLiteral' && /(?:unpublished|login.?required|missing|unavailable)/i.test(argument.value))
  return members.has('state') || knownFallbackKey
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
const returnedLabelExpressions = (node, definitions, resolving = new Set()) => {
  node = unwrapExpression(node)
  if (!node) return []
  if (node.type === 'Identifier' && definitions.has(node.name)) {
    if (resolving.has(node.name)) return []
    return returnedLabelExpressions(definitions.get(node.name), definitions, new Set([...resolving, node.name]))
  }
  if (node.type === 'SequenceExpression') return returnedLabelExpressions(node.expressions.at(-1), definitions, resolving)
  if (node.type === 'ConditionalExpression' || node.type === 'LogicalExpression') return [node.consequent || node.left, node.alternate || node.right].flatMap(branch => returnedLabelExpressions(branch, definitions, resolving))
  if (node.type !== 'ObjectExpression') return []
  for (let index = node.properties.length - 1; index >= 0; index -= 1) {
    const property = node.properties[index]
    if (property.type === 'SpreadElement') continue
    const key = property.computed ? staticPropertyKey(property.key) : property.key?.name || property.key?.value
    if (String(key) === 'label') return [property.value]
  }
  return []
}
const forwardedArgument = (argument, binding, renderedCall) => {
  argument = unwrapExpression(argument)
  if (argument?.type !== 'Identifier') return undefined
  const parameterIndex = functionParameters(binding).findIndex(parameter => parameter.type === 'Identifier' && parameter.name === argument.name)
  return parameterIndex >= 0 ? unwrapExpression(renderedCall.arguments[parameterIndex]) : undefined
}
const correctPublicStateCall = (stateCall, component, modelName, binding, renderedCall) => {
  if (stateCall.callee?.type !== 'Identifier' || stateCall.callee.name !== 'publicPriceState') return false
  const stateModel = binding ? forwardedArgument(stateCall.arguments[0], binding, renderedCall) : unwrapExpression(stateCall.arguments[0])
  const stateComponent = unwrapExpression(stateCall.arguments[1])
  const renderedComponent = binding ? forwardedArgument(stateComponent, binding, renderedCall) : stateComponent
  const rendersAComponentArgument = binding && renderedCall.arguments.some(argument => argument?.type === 'StringLiteral' && ['input', 'output'].includes(argument.value))
  const componentMatches = stateComponent?.type === 'StringLiteral'
    ? stateComponent.value === component && !rendersAComponentArgument
    : renderedComponent?.type === 'StringLiteral' && renderedComponent.value === component
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
const helperReturnsCorrectState = (binding, component, modelName, renderedCall, renderedPaths) => {
  const origins = node => ['CallExpression', 'OptionalCallExpression'].includes(node?.type) && correctPublicStateCall(node, component, modelName, binding, renderedCall)
  const returnIsValid = (node, definitions, mode, resolving = new Set()) => {
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
    const labels = returnedLabelExpressions(node, definitions)
    return transparentlyCarriesState(node, origins, definitions)
      && renderedPaths.every(path => path[0] === 'label'
        ? labels.length > 0 && labels.every(label => validLabelExpression(label, origins, definitions, mode))
        : expressionDerivedFrom(node, origins, definitions, path))
  }
  if (binding.body?.type !== 'BlockStatement') return returnIsValid(binding.body, new Map(), 'unknown')
  const returns = []
  const alwaysReturns = statement => statement?.type === 'ReturnStatement'
    || (statement?.type === 'BlockStatement' && alwaysReturns(statement.body.at(-1)))
    || (statement?.type === 'IfStatement' && statement.alternate && alwaysReturns(statement.consequent) && alwaysReturns(statement.alternate))
  const visitStatements = (statements, inherited = new Map(), inheritedMode = 'unknown') => {
    const definitions = new Map(inherited)
    let mode = inheritedMode
    for (const statement of statements || []) {
      if (statement.type === 'VariableDeclaration') {
        for (const declaration of statement.declarations) if (declaration.id?.type === 'Identifier' && declaration.init) definitions.set(declaration.id.name, declaration.init)
      } else if (statement.type === 'ReturnStatement') { returns.push(returnIsValid(statement.argument, definitions, mode)); return true }
      else if (statement.type === 'BlockStatement') { if (visitStatements(statement.body, definitions, mode)) return true }
      else if (statement.type === 'IfStatement') {
        const [consequentMode, alternateMode] = labelConditionModes(statement.test, origins, definitions, mode)
        visitStatements(statement.consequent?.type === 'BlockStatement' ? statement.consequent.body : [statement.consequent], definitions, consequentMode)
        if (statement.alternate) visitStatements(statement.alternate.type === 'BlockStatement' ? statement.alternate.body : [statement.alternate], definitions, alternateMode)
        if (statement.alternate && alwaysReturns(statement.consequent) && alwaysReturns(statement.alternate)) return true
        if (!statement.alternate && alwaysReturns(statement.consequent)) mode = alternateMode
      } else if (statement.type === 'SwitchStatement') for (const branch of statement.cases) visitStatements(branch.consequent, definitions, mode)
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
  const directOrigins = candidate => ['CallExpression', 'OptionalCallExpression'].includes(candidate?.type)
    && correctPublicStateCall(candidate, component, modelName)
  if (path.length === 0 && ['ConditionalExpression', 'LogicalExpression'].includes(node.type)
    && directlyReadStateMembers(node, directOrigins, new Map()).size > 0) {
    return validLabelExpression(node, directOrigins, new Map())
  }
  if (['MemberExpression', 'OptionalMemberExpression'].includes(node.type)) {
    const property = node.computed ? staticPropertyKey(node.property) : node.property?.name
    return property !== undefined && renderedPriceStateFor(node.object, component, modelName, bindings, [property, ...path])
  }
  if (['CallExpression', 'OptionalCallExpression'].includes(node.type)) {
    if (node.callee?.type === 'Identifier' && node.callee.name === 'publicPriceState') {
      return correctPublicStateCall(node, component, modelName) && (path.length === 0 || ['state', 'value'].includes(String(path[0])))
    }
    if (node.callee?.type === 'Identifier' && bindings.has(node.callee.name)) {
      return (bindings.get(node.callee.name) || []).some(binding => helperReturnsCorrectState(binding, component, modelName, node, [path]))
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
const vForAlias = node => node?.props?.find(prop => prop.type === 7 && prop.name === 'for')?.exp?.content.match(/^\s*(?:\(\s*)?([A-Za-z_$][\w$]*)/)?.[1]
const staticBindingInitializers = value => {
  const bindings = new Map()
  const descriptor = parseVue(value)
  for (const block of [descriptor.script, descriptor.scriptSetup].filter(Boolean)) {
    let ast
    try { ast = vueCompiler.babelParse(block.content, { sourceType: 'module', plugins: ['typescript'] }) }
    catch (error) { throw new Error(`pricing Vue script must parse cleanly: ${error.message}`, { cause: error }) }
    for (const statement of ast.program.body) {
      const node = statement.type === 'ExportNamedDeclaration' ? statement.declaration : statement
      if (node?.type === 'FunctionDeclaration' && node.id) bindings.set(node.id.name, [node])
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
const returnedExpressions = node => {
  node = unwrapExpression(node)
  if (!node) return []
  if (node.type === 'ReturnStatement') return node.argument ? [node.argument] : []
  if (node.type === 'IfStatement') return returnedExpressions(node.consequent).concat(returnedExpressions(node.alternate))
  if (node.type === 'SwitchStatement') return node.cases.flatMap(branch => branch.consequent.flatMap(returnedExpressions))
  if (node.type === 'BlockStatement') return node.body.flatMap(returnedExpressions)
  return [node]
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
const bindingsForElement = (node, bindings) => {
  const directive = node.props?.find(prop => prop.type === 7 && prop.name === 'for')
  if (!directive?.exp?.content) return bindings
  const match = directive.exp.content.match(/^\s*(?:\(\s*)?([A-Za-z_$][\w$]*)(?:\s*,[^)]*)?\)?\s+(?:in|of)\s+([\s\S]+)$/)
  if (!match) return bindings
  let sourceAst
  try { sourceAst = vueCompiler.babelParse(`(${match[2]})`, { sourceType: 'module', plugins: ['typescript'] }).program.body[0]?.expression }
  catch (error) { throw new Error(`v-for source must parse cleanly: ${error.message}`, { cause: error }) }
  const scoped = new Map(bindings)
  scoped.set(match[1], staticIterationValues(sourceAst, bindings))
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
    for (const child of node.children || []) visit(child, scopedBindings)
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
const assertNoContextualOverrides = (rules, selector, properties, widths) => {
  for (const width of widths) for (const rule of rules) {
    if (!mediaMatchesScreen(rule.media, width)) continue
    const conflicting = rule.selectors.filter(candidate => normalizeSelector(candidate) !== normalizeSelector(selector) && selectorTargetsContract(candidate, selector))
    const guarded = rule.declarations.filter(declaration => properties.includes(declaration.property))
    assert.ok(conflicting.length === 0 || guarded.length === 0, `${selector} presentation conflicts with ${conflicting.join(', ')} at ${width}px through ${guarded.map(declaration => declaration.property).join(', ')}`)
  }
}
const rootSelectorSpecificity = selector => (selector.match(/#[\w-]+/g) || []).length * 100 + (selector.match(/\.[\w-]+|\[[^\]]+\]|:(?!:)[\w-]+/g) || []).length * 10 + (selector.match(/(?:^|[\s>+~])(?:[a-z][\w-]*|\*)/gi) || []).filter(token => !token.trim().endsWith('*')).length
const effectiveSelectorProperties = (rules, selector, width, guarded) => {
  assertNoContextualOverrides(rules, selector, guarded, [width])
  const winners = new Map()
  for (const rule of rules) {
    if (!mediaMatchesScreen(rule.media, width)) continue
    const matching = rule.selectors.filter(candidate => normalizeSelector(candidate) === normalizeSelector(selector))
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
  const guarded = ['display', 'visibility', 'opacity', 'min-height', 'min-width']
  if (targetClass === 'pricing-filter-toggle') guarded.push('height')
  return effectiveSelectorProperties(rules, `.${targetClass}`, width, guarded)
}
const rootIsHidden = properties => properties.get('display') === 'none' || ['hidden', 'collapse'].includes(properties.get('visibility')) || /^(?:0(?:\.0+)?|\.0+)$/.test(properties.get('opacity') || '')
const assertProperty = (root, selector, property, expected, message, context = 'base') => {
  const actual = propertyMap(exactRules(root, selector, context)).get(property) || []
  assert.ok(actual.includes(expected), `${message}; found ${JSON.stringify(actual)}`)
}
const controlValueIsAtLeast44 = value => value === 'var(--control-min-size)' || (/^\d+(?:\.\d+)?px$/.test(value) && Number.parseFloat(value) >= 44)
const assertControlSize = (root, selector, properties, widths) => {
  const guarded = new Set(properties)
  if (properties.includes('min-height')) guarded.add('height')
  if (properties.includes('min-width')) guarded.add('width')
  for (const width of widths) for (const property of properties) {
    const value = effectiveSelectorProperties(root, selector, width, [...guarded]).get(property)
    assert.ok(value, `${selector} must effectively declare ${property} at ${width}px`)
    assert.equal(controlValueIsAtLeast44(value), true, `${selector} ${property} must stay at least 44px at ${width}px; found ${JSON.stringify(value)}`)
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
  const tableBindings = staticBindingInitializers(table)
  const cardBindings = staticBindingInitializers(cards)
  for (const component of ['input', 'output']) {
    const key = `pricingCatalog.${component}Price`
    const tableHeaders = renderedElements(renderedElements(tableRoot, 'thead')[0], 'th')
    const headerIndex = tableHeaders.findIndex(node => templateExpressionAsts(node).some(expression => callsFunction(expression, 't', key)))
    const tableCells = renderedElements(renderedElements(tableRoot, 'tbody')[0], 'td')
    const tableHeader = tableHeaders[headerIndex]
    const tableCell = tableCells[headerIndex - 1]
    assert.ok(tableHeader && tableCell, `table must render ${key} beside the ${component} price cell`)
    assert.ok(templateExpressionAsts(tableCell).some(expression => renderedPriceStateFor(expression, component, tableModelName, tableBindings)), `table ${key} column must render publicPriceState for ${component}`)
    assert.ok(templateExpressionAsts(tableCell).some(expression => renderedPriceStateFor(expression, component, tableModelName, tableBindings) && memberUsesState(expression)), `table ${component} price cell must branch on publicPriceState output`)
    const cardGroup = renderedElements(cardsRoot, 'dl').flatMap(node => renderedElements(node, 'div')).find(node => {
      const expressions = templateExpressionAsts(node)
      return expressions.some(expression => callsFunction(expression, 't', key)) && expressions.some(expression => renderedPriceStateFor(expression, component, cardModelName, cardBindings))
    })
    assert.ok(cardGroup, `card must render ${key} with the ${component} price value`)
    assert.ok(templateExpressionAsts(cardGroup).some(expression => renderedPriceStateFor(expression, component, cardModelName, cardBindings) && memberUsesState(expression)), `card ${component} price cell must branch on publicPriceState output`)
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
