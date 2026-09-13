import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { basename, dirname, extname, join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import vuePlugin from '@vitejs/plugin-vue'
import { compileString } from 'sass'

const vueCompiler = (() => {
  const plugin = vuePlugin()
  plugin.buildStart()
  return plugin.api.options.compiler
})()

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
const unwrapJavaScript = node => {
  while (node && ['ParenthesizedExpression', 'TSAsExpression', 'TSTypeAssertion', 'TSNonNullExpression', 'TypeCastExpression'].includes(node.type)) node = node.expression
  return node
}
const propertyName = node => {
  const key = unwrapJavaScript(node?.key)
  if (!key || (node.computed && !['StringLiteral', 'NumericLiteral'].includes(key.type))) return undefined
  return key.name ?? key.value
}
const staticStrings = (node, environment = new Map(), bindings = new Map(), resolving = new Set()) => {
  node = unwrapJavaScript(node)
  if (!node) return []
  if (node.type === 'Identifier') {
    const value = environment.get(node.name) ?? bindings.get(node.name)
    if (!value || resolving.has(node.name)) return []
    return staticStrings(value, environment, bindings, new Set(resolving).add(node.name))
  }
  if (node.type === 'StringLiteral') return [node.value]
  if (node.type === 'TemplateLiteral' && node.expressions.length === 0) return [node.quasis.map(part => part.value.cooked ?? part.value.raw).join('')]
  if (node.type === 'ArrayExpression') return node.elements.flatMap(value => staticStrings(value, environment, bindings, resolving))
  if (node.type === 'ConditionalExpression') return staticStrings(node.consequent, environment, bindings, resolving).concat(staticStrings(node.alternate, environment, bindings, resolving))
  if (node.type === 'LogicalExpression') return staticStrings(node.left, environment, bindings, resolving).concat(staticStrings(node.right, environment, bindings, resolving))
  if (node.type === 'ObjectExpression') return node.properties.flatMap(property => property.type === 'ObjectProperty' && !property.computed && property.value?.type === 'BooleanLiteral' && property.value.value ? [String(propertyName(property))] : [])
  return []
}
const renderNodesFromScripts = (descriptor, file) => {
  const nodes = []
  for (const block of [descriptor.script, descriptor.scriptSetup].filter(Boolean)) {
    let ast
    try { ast = vueCompiler.babelParse(block.content, { sourceType: 'module', plugins: block.lang === 'ts' || block.lang === 'tsx' ? ['typescript'] : [] }) }
    catch (error) { throw new Error(`${file} render script must parse cleanly: ${error.message}`, { cause: error }) }
    const renderCalls = new Set(['h', 'createVNode'])
    const routerViews = new Set(['RouterView'])
    const dynamicResolvers = new Set(['resolveDynamicComponent'])
    const renderSlots = new Set(['renderSlot'])
    for (const statement of ast.program.body) {
      if (statement.type !== 'ImportDeclaration') continue
      for (const specifier of statement.specifiers) {
        const imported = specifier.imported?.name ?? specifier.imported?.value
        if (statement.source.value === 'vue' && ['h', 'createVNode'].includes(imported)) renderCalls.add(specifier.local.name)
        if (statement.source.value === 'vue' && imported === 'resolveDynamicComponent') dynamicResolvers.add(specifier.local.name)
        if (statement.source.value === 'vue' && imported === 'renderSlot') renderSlots.add(specifier.local.name)
        if (statement.source.value === 'vue-router' && imported === 'RouterView') routerViews.add(specifier.local.name)
      }
    }
    const seen = new WeakSet()
    const isCall = node => ['CallExpression', 'OptionalCallExpression'].includes(unwrapJavaScript(node)?.type)
    const calleeName = node => unwrapJavaScript(node)?.type === 'Identifier' ? unwrapJavaScript(node).name : undefined
    const walk = (node, visit, parent) => {
      if (!node || typeof node !== 'object') return
      visit(node, parent)
      for (const [key, value] of Object.entries(node)) {
        if (['loc', 'start', 'end', 'extra'].includes(key)) continue
        if (Array.isArray(value)) for (const child of value) walk(child, visit, node)
        else if (value && typeof value === 'object' && typeof value.type === 'string') walk(value, visit, node)
      }
    }
    const bindings = new Map()
    const helpers = new Map()
    const reassigned = new Set()
    const patternAssignments = new Set()
    const assignmentRoot = expression => {
      expression = unwrapJavaScript(expression)
      while (['MemberExpression', 'OptionalMemberExpression'].includes(expression?.type)) expression = unwrapJavaScript(expression.object)
      return expression?.type === 'Identifier' ? expression.name : undefined
    }
    const dynamicBinding = node => ({ type: 'StaticDynamicReference', start: node?.start, end: node?.end })
    const memberBinding = (object, name, node) => ({
      type: 'MemberExpression', object, property: { type: 'StringLiteral', value: String(name), start: node?.start, end: node?.end },
      computed: true, optional: false, start: node?.start, end: node?.end,
    })
    const bindDynamicPattern = pattern => {
      pattern = unwrapJavaScript(pattern)
      if (pattern?.type === 'Identifier') bindings.set(pattern.name, dynamicBinding(pattern))
      else if (pattern?.type === 'AssignmentPattern') bindDynamicPattern(pattern.left)
      else for (const child of pattern?.properties || pattern?.elements || []) bindDynamicPattern(child?.argument || child?.value || child)
    }
    const bindPattern = (pattern, value, assignment = false, replace = false) => {
      pattern = unwrapJavaScript(pattern)
      if (!pattern) return
      if (pattern.type === 'Identifier') {
        if (assignment && !replace) reassigned.add(pattern.name)
        else {
          if (assignment) patternAssignments.add(pattern.name)
          bindings.set(pattern.name, value)
          if (replace) reassigned.delete(pattern.name)
        }
        return
      }
      if (pattern.type === 'AssignmentPattern') {
        bindPattern(pattern.left, { type: 'StaticDefaultReference', value, fallback: pattern.right, start: pattern.start, end: pattern.end }, assignment, replace)
        return
      }
      if (pattern.type === 'ObjectPattern') {
        for (const property of pattern.properties) {
          if (property.type === 'RestElement') { bindDynamicPattern(property.argument); continue }
          const name = propertyName(property)
          if (name === undefined) bindDynamicPattern(property.value)
          else bindPattern(property.value, memberBinding(value, name, property), assignment, replace)
        }
        return
      }
      if (pattern.type === 'ArrayPattern') {
        for (let index = 0; index < pattern.elements.length; index += 1) {
          const element = pattern.elements[index]
          if (!element) continue
          if (element.type === 'RestElement') bindDynamicPattern(element.argument)
          else bindPattern(element, memberBinding(value, index, element), assignment, replace)
        }
      }
    }
    const parents = new WeakMap()
    walk(ast.program, (node, parent) => { if (parent) parents.set(node, parent) })
    const assignmentIsUnconditional = node => {
      for (let current = parents.get(node); current; current = parents.get(current)) {
        if (['IfStatement', 'ConditionalExpression', 'LogicalExpression', 'SwitchStatement', 'SwitchCase', 'ForStatement', 'ForInStatement', 'ForOfStatement', 'WhileStatement', 'DoWhileStatement', 'TryStatement', 'CatchClause'].includes(current.type)) return false
        if (['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression', 'Program'].includes(current.type)) return true
      }
      return false
    }
    walk(ast.program, node => {
      if (node.type === 'FunctionDeclaration' && node.id) helpers.set(node.id.name, node)
      if (node.type === 'AssignmentExpression' && ['ObjectPattern', 'ArrayPattern'].includes(node.left?.type)) bindPattern(node.left, node.right, true, assignmentIsUnconditional(node))
      else if (node.type === 'AssignmentExpression' && node.operator === '=' && node.left?.type === 'Identifier' && assignmentIsUnconditional(node)) {
        const assigned = unwrapJavaScript(node.right)
        const staticallyKnown = ['ArrowFunctionExpression', 'FunctionExpression', 'ObjectExpression', 'ArrayExpression'].includes(assigned?.type)
          || (assigned?.type === 'Identifier' && (helpers.has(assigned.name) || (bindings.has(assigned.name) && !reassigned.has(assigned.name))))
        if (staticallyKnown) {
          bindings.set(node.left.name, node.right)
          reassigned.delete(node.left.name)
          if (['ArrowFunctionExpression', 'FunctionExpression'].includes(assigned?.type)) helpers.set(node.left.name, assigned)
          else helpers.delete(node.left.name)
        } else reassigned.add(node.left.name)
      } else if (node.type === 'AssignmentExpression' && assignmentRoot(node.left)) reassigned.add(assignmentRoot(node.left))
      if (node.type === 'UpdateExpression' && assignmentRoot(node.argument)) reassigned.add(assignmentRoot(node.argument))
      if (node.type !== 'VariableDeclarator' || !node.init) return
      bindPattern(node.id, node.init)
      if (node.id?.type === 'Identifier' && ['ArrowFunctionExpression', 'FunctionExpression'].includes(unwrapJavaScript(node.init)?.type)) helpers.set(node.id.name, unwrapJavaScript(node.init))
    })
    const resolveHelper = (name, resolving = new Set()) => {
      if (!name) return { status: 'missing' }
      if (reassigned.has(name) || resolving.has(name)) return { status: 'dynamic' }
      if (helpers.has(name)) return { status: 'resolved', name, helper: helpers.get(name) }
      const alias = unwrapJavaScript(bindings.get(name))
      if (alias?.type === 'Identifier') return resolveHelper(alias.name, new Set(resolving).add(name))
      return { status: bindings.has(name) ? 'dynamic' : 'missing' }
    }
    const dereference = (expression, environment, resolving = new Set()) => {
      expression = unwrapJavaScript(expression)
      if (expression?.type !== 'Identifier' || resolving.has(expression.name)) return expression
      const value = environment.get(expression.name) ?? bindings.get(expression.name)
      return value ? dereference(value, environment, new Set(resolving).add(expression.name)) : expression
    }
    const objectProperties = (expression, environment, resolving = new Set()) => {
      expression = unwrapJavaScript(expression)
      if (expression?.type === 'Identifier') {
        if (reassigned.has(expression.name) || resolving.has(expression.name)) return { known: false, values: new Map() }
        const value = environment.get(expression.name) ?? bindings.get(expression.name)
        return value ? objectProperties(value, environment, new Set(resolving).add(expression.name)) : { known: false, values: new Map() }
      }
      if (expression?.type !== 'ObjectExpression') return { known: false, values: new Map() }
      const values = new Map()
      let known = true
      for (const property of expression.properties) {
        if (property.type === 'SpreadElement') {
          const spread = objectProperties(property.argument, environment, resolving)
          if (!spread.known) { known = false; values.clear() }
          else for (const [name, value] of spread.values) values.set(name, value)
          continue
        }
        if (property.type !== 'ObjectProperty') continue
        const name = propertyName(property)
        if (name !== undefined) values.set(String(name), property.value)
        else { known = false; values.clear() }
      }
      return { known, values }
    }
    const propsFrom = (expression, environment) => {
      const props = objectProperties(expression, environment)
      const classes = staticStrings(props.values.get('class'), environment, bindings).flatMap(value => value.split(/\s+/).filter(Boolean))
      const id = staticStrings(props.values.get('id'), environment, bindings)[0]
      return { known: props.known, classes: [...new Set(classes)], id }
    }
    const memberName = member => {
      const property = unwrapJavaScript(member?.property)
      if (!member?.computed && property?.type === 'Identifier') return property.name
      if (member?.computed && ['StringLiteral', 'NumericLiteral'].includes(property?.type)) return String(property.value)
      return undefined
    }
    const staticReference = (expression, environment, resolving = new Set()) => {
      expression = unwrapJavaScript(expression)
      if (!expression || resolving.size > 32) return { status: 'dynamic' }
      if (expression.type === 'StaticDynamicReference') return { status: 'dynamic' }
      if (expression.type === 'StaticDefaultReference') {
        const value = staticReference(expression.value, environment, resolving)
        const absent = value.status === 'missing' || (value.status === 'known' && (
          (value.value?.type === 'Identifier' && value.value.name === 'undefined')
          || (value.value?.type === 'UnaryExpression' && value.value.operator === 'void')
        ))
        return absent ? staticReference(expression.fallback, environment, resolving) : value
      }
      if (expression.type === 'Identifier') {
        if (reassigned.has(expression.name) || resolving.has(expression.name)) return { status: 'dynamic' }
        const value = environment.get(expression.name) ?? bindings.get(expression.name)
        return value ? staticReference(value, environment, new Set(resolving).add(expression.name)) : { status: 'known', value: expression }
      }
      if (['MemberExpression', 'OptionalMemberExpression'].includes(expression.type)) {
        const token = `member:${expression.start}:${expression.end}`
        if (resolving.has(token)) return { status: 'dynamic' }
        const nestedResolving = new Set(resolving).add(token)
        const name = memberName(expression)
        if (name === undefined) return { status: 'dynamic' }
        const object = staticReference(expression.object, environment, nestedResolving)
        if (object.status !== 'known') return object
        if (object.value?.type === 'ArrayExpression') {
          const index = Number(name)
          const value = Number.isInteger(index) ? object.value.elements[index] : undefined
          return value ? staticReference(value, environment, nestedResolving) : { status: 'missing' }
        }
        const properties = objectProperties(object.value, environment, nestedResolving)
        if (!properties.values.has(name)) return { status: properties.known ? 'missing' : 'dynamic' }
        return staticReference(properties.values.get(name), environment, nestedResolving)
      }
      return { status: 'known', value: expression }
    }
    const resolveHelperCallee = (callee, environment) => {
      const reference = staticReference(callee, environment)
      if (reference.status !== 'known') return reference
      const value = unwrapJavaScript(reference.value)
      if (['ArrowFunctionExpression', 'FunctionExpression', 'FunctionDeclaration'].includes(value?.type)) return { status: 'resolved', name: `function:${value.start}`, helper: value }
      if (value?.type === 'Identifier') return resolveHelper(value.name)
      return { status: 'dynamic' }
    }
    const renderStaticValue = expression => {
      expression = unwrapJavaScript(expression)
      if (!expression) return { known: false }
      if (['BooleanLiteral', 'NumericLiteral', 'StringLiteral'].includes(expression.type)) return { known: true, value: expression.value }
      if (expression.type === 'NullLiteral') return { known: true, value: null }
      if (expression.type === 'Identifier' && expression.name === 'undefined') return { known: true, value: undefined }
      if (expression.type === 'UnaryExpression' && expression.operator === '!') {
        const value = renderStaticValue(expression.argument)
        return value.known ? { known: true, value: !value.value } : value
      }
      return { known: false }
    }
    const returnExpressions = body => {
      body = unwrapJavaScript(body)
      if (!body) return []
      if (body.type !== 'BlockStatement') return [body]
      const values = []
      const visit = node => {
        if (!node || typeof node !== 'object') return
        if (node.type === 'ReturnStatement') { if (node.argument) values.push(node.argument); return }
        if (node !== body && ['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression', 'ObjectMethod', 'ClassMethod'].includes(node.type)) return
        if (node.type === 'IfStatement') {
          const condition = renderStaticValue(node.test)
          if (condition.known) visit(condition.value ? node.consequent : node.alternate)
          else { visit(node.consequent); visit(node.alternate) }
          return
        }
        for (const [key, value] of Object.entries(node)) {
          if (['loc', 'start', 'end', 'extra'].includes(key)) continue
          if (Array.isArray(value)) for (const child of value) visit(child)
          else if (value && typeof value === 'object' && typeof value.type === 'string') visit(value)
        }
      }
      visit(body)
      return values
    }
    const parseRenderCall = (call, parent, environment = new Map(), helperStack = new Set(), depth = 0, instantiated = false) => {
      call = unwrapJavaScript(call)
      if (!isCall(call) || !renderCalls.has(calleeName(call.callee))) return undefined
      if (!instantiated && seen.has(call)) return undefined
      if (!instantiated) seen.add(call)
      if (depth > 24) { if (parent) parent.typography = true; return undefined }
      const type = dereference(call.arguments[0], environment)
      const name = type?.type === 'StringLiteral' ? type.value : type?.type === 'Identifier' ? type.name : 'component'
      const candidateProps = propsFrom(call.arguments[1], environment)
      const propsIndex = call.arguments.length > 2 || candidateProps.known || unwrapJavaScript(call.arguments[1])?.type === 'NullLiteral' ? 1 : -1
      const props = propsIndex === 1 ? candidateProps : { classes: [], id: undefined }
      const dynamicType = (type?.type === 'Identifier' && routerViews.has(type.name))
        || (type?.type === 'StringLiteral' && /^(?:router-view|slot|component)$/i.test(type.value))
        || (isCall(type) && dynamicResolvers.has(calleeName(type.callee)))
      const node = { name, ...props, parent, typography: dynamicType }
      nodes.push(node)
      const analyzeHelper = (expression, activeEnvironment, activeStack, activeDepth) => {
        const resolved = resolveHelperCallee(expression.callee, activeEnvironment)
        if (resolved.status === 'missing') return false
        if (resolved.status === 'dynamic' || activeStack.has(resolved.name) || activeDepth >= 24) { node.typography = true; return true }
        const { helper } = resolved
        const nestedEnvironment = new Map(activeEnvironment)
        for (let index = 0; index < helper.params.length; index += 1) {
          const parameter = unwrapJavaScript(helper.params[index])
          const target = parameter?.type === 'AssignmentPattern' ? parameter.left : parameter
          const argument = expression.arguments[index] ?? (parameter?.type === 'AssignmentPattern' ? parameter.right : undefined)
          if (target?.type === 'Identifier' && argument) nestedEnvironment.set(target.name, dereference(argument, activeEnvironment))
        }
        const nestedStack = new Set(activeStack).add(resolved.name)
        for (const returned of returnExpressions(helper.body)) markVisibleChild(returned, nestedEnvironment, nestedStack, activeDepth + 1, true)
        return true
      }
      const markVisibleChild = (expression, activeEnvironment = environment, activeStack = helperStack, activeDepth = depth, activeInstantiation = instantiated) => {
        expression = unwrapJavaScript(expression)
        if (!expression) return
        if (isCall(expression) && renderCalls.has(calleeName(expression.callee))) { parseRenderCall(expression, node, activeEnvironment, activeStack, activeDepth, activeInstantiation); return }
        if (['StringLiteral', 'NumericLiteral', 'BigIntLiteral'].includes(expression.type)) { if (String(expression.value ?? '').trim()) node.typography = true; return }
        if (expression.type === 'TemplateLiteral') {
          if (expression.quasis.some(part => (part.value.cooked ?? part.value.raw).trim()) || expression.expressions.length) node.typography = true
          return
        }
        if (expression.type === 'Identifier') {
          const resolved = dereference(expression, activeEnvironment)
          if (resolved !== expression) markVisibleChild(resolved, activeEnvironment, activeStack, activeDepth, activeInstantiation)
          else node.typography = true
          return
        }
        if (['MemberExpression', 'OptionalMemberExpression'].includes(expression.type)) { node.typography = true; return }
        if (['ArrowFunctionExpression', 'FunctionExpression'].includes(expression.type)) { for (const returned of returnExpressions(expression.body)) markVisibleChild(returned, activeEnvironment, activeStack, activeDepth, activeInstantiation); return }
        if (expression.type === 'BlockStatement') { for (const returned of returnExpressions(expression)) markVisibleChild(returned, activeEnvironment, activeStack, activeDepth, activeInstantiation); return }
        if (expression.type === 'ArrayExpression') { for (const child of expression.elements) markVisibleChild(child, activeEnvironment, activeStack, activeDepth, activeInstantiation); return }
        if (expression.type === 'ObjectExpression') { for (const property of expression.properties) if (property.type === 'ObjectProperty' || property.type === 'ObjectMethod') markVisibleChild(property.value ?? property.body, activeEnvironment, activeStack, activeDepth, activeInstantiation); return }
        if (isCall(expression)) {
          const called = calleeName(expression.callee)
          const member = unwrapJavaScript(expression.callee)
          if (called === 't' || renderSlots.has(called) || (member?.type === 'MemberExpression' && /^(?:slots?|\$slots)$/.test(member.object?.name || ''))) node.typography = true
          else if (!analyzeHelper(expression, activeEnvironment, activeStack, activeDepth)) for (const argument of expression.arguments) markVisibleChild(argument, activeEnvironment, activeStack, activeDepth, activeInstantiation)
          return
        }
        if (expression.type === 'ConditionalExpression') {
          const condition = renderStaticValue(expression.test)
          if (condition.known) markVisibleChild(condition.value ? expression.consequent : expression.alternate, activeEnvironment, activeStack, activeDepth, activeInstantiation)
          else { markVisibleChild(expression.consequent, activeEnvironment, activeStack, activeDepth, activeInstantiation); markVisibleChild(expression.alternate, activeEnvironment, activeStack, activeDepth, activeInstantiation) }
          return
        }
        if (expression.type === 'LogicalExpression') {
          const left = renderStaticValue(expression.left)
          markVisibleChild(expression.left, activeEnvironment, activeStack, activeDepth, activeInstantiation)
          if (!left.known || (expression.operator === '&&' ? Boolean(left.value) : expression.operator === '||' ? !left.value : left.value == null)) markVisibleChild(expression.right, activeEnvironment, activeStack, activeDepth, activeInstantiation)
          return
        }
        if (expression.type === 'BinaryExpression') { markVisibleChild(expression.left, activeEnvironment, activeStack, activeDepth, activeInstantiation); markVisibleChild(expression.right, activeEnvironment, activeStack, activeDepth, activeInstantiation); return }
        if (expression.type === 'SequenceExpression') { markVisibleChild(expression.expressions.at(-1), activeEnvironment, activeStack, activeDepth, activeInstantiation); return }
        if (expression.type === 'SpreadElement' || expression.type === 'AwaitExpression') { markVisibleChild(expression.argument, activeEnvironment, activeStack, activeDepth, activeInstantiation) }
      }
      const children = call.arguments.length > 2 ? call.arguments.slice(2) : propsIndex === -1 ? call.arguments.slice(1) : []
      for (const child of children) markVisibleChild(child)
      return node
    }
    const renderRootExpressions = []
    const optionsFrom = declaration => {
      declaration = unwrapJavaScript(declaration)
      if (isCall(declaration) && declaration.callee?.type === 'Identifier' && declaration.callee.name === 'defineComponent') declaration = unwrapJavaScript(declaration.arguments[0])
      return declaration?.type === 'ObjectExpression' ? declaration : undefined
    }
    const optionFunction = (options, name) => {
      const property = options?.properties.find(candidate => propertyName(candidate) === name)
      if (!property) return undefined
      return property.type === 'ObjectMethod' ? property : unwrapJavaScript(property.value)
    }
    for (const statement of ast.program.body) {
      if (statement.type !== 'ExportDefaultDeclaration') continue
      const options = optionsFrom(statement.declaration)
      const render = optionFunction(options, 'render')
      if (render) renderRootExpressions.push(...returnExpressions(render.body))
      const setup = optionFunction(options, 'setup')
      if (setup) for (const returned of returnExpressions(setup.body)) {
        const reference = staticReference(returned, new Map())
        const resolved = reference.status === 'known' ? unwrapJavaScript(reference.value) : dereference(returned, new Map())
        const namedHelper = resolved?.type === 'Identifier' ? resolveHelper(resolved.name) : { status: 'missing' }
        const renderFunction = namedHelper.status === 'resolved' ? namedHelper.helper : resolved
        if (['ArrowFunctionExpression', 'FunctionExpression', 'FunctionDeclaration'].includes(renderFunction?.type)) renderRootExpressions.push(...returnExpressions(renderFunction.body))
        else renderRootExpressions.push(renderFunction)
      }
    }
    const analyzeRoot = (expression, environment = new Map(), stack = new Set(), depth = 0) => {
      expression = dereference(expression, environment)
      if (!expression || depth > 24) return
      if (isCall(expression) && renderCalls.has(calleeName(expression.callee))) { parseRenderCall(expression, undefined, environment, stack, depth, true); return }
      if (['ArrowFunctionExpression', 'FunctionExpression', 'FunctionDeclaration'].includes(expression.type)) {
        for (const returned of returnExpressions(expression.body)) analyzeRoot(returned, environment, stack, depth + 1)
        return
      }
      if (expression.type === 'ConditionalExpression') {
        const condition = renderStaticValue(expression.test)
        if (condition.known) analyzeRoot(condition.value ? expression.consequent : expression.alternate, environment, stack, depth + 1)
        else { analyzeRoot(expression.consequent, environment, stack, depth + 1); analyzeRoot(expression.alternate, environment, stack, depth + 1) }
        return
      }
      if (expression.type === 'LogicalExpression') {
        const left = renderStaticValue(expression.left)
        analyzeRoot(expression.left, environment, stack, depth + 1)
        if (!left.known || (expression.operator === '&&' ? Boolean(left.value) : expression.operator === '||' ? !left.value : left.value == null)) analyzeRoot(expression.right, environment, stack, depth + 1)
        return
      }
      if (expression.type === 'SequenceExpression') { analyzeRoot(expression.expressions.at(-1), environment, stack, depth + 1); return }
      if (expression.type === 'ArrayExpression') { for (const child of expression.elements) analyzeRoot(child, environment, stack, depth + 1); return }
      if (!isCall(expression)) return
      const resolved = resolveHelperCallee(expression.callee, environment)
      if (resolved.status !== 'resolved' || stack.has(resolved.name)) return
      const nestedEnvironment = new Map(environment)
      for (let index = 0; index < resolved.helper.params.length; index += 1) {
        const parameter = unwrapJavaScript(resolved.helper.params[index])
        const target = parameter?.type === 'AssignmentPattern' ? parameter.left : parameter
        const argument = expression.arguments[index] ?? (parameter?.type === 'AssignmentPattern' ? parameter.right : undefined)
        if (target?.type === 'Identifier' && argument) nestedEnvironment.set(target.name, dereference(argument, environment))
      }
      for (const returned of returnExpressions(resolved.helper.body)) analyzeRoot(returned, nestedEnvironment, new Set(stack).add(resolved.name), depth + 1)
    }
    // Only the component's effective render/setup return is inspected; helpers are followed from that root without invoking code.
    for (const expression of renderRootExpressions) analyzeRoot(expression)
  }
  return nodes
}
const typographyEvidenceFromVue = (files = collectProductionSources()) => {
  const evidence = new Set(['html', ':root', 'body', '#app'])
  const ancestorPaths = new Map()
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
    const parsed = vueCompiler.parse(source, { filename: file })
    if (parsed.errors.length) throw new Error(`${file} Vue SFC must parse cleanly: ${parsed.errors.map(String).join('; ')}`)
    const imports = new Map()
    for (const match of source.matchAll(/\bimport\s+([A-Za-z_$][\w$]*)\s+from\s*(["'])([^"']+\.vue)\2/g)) {
      const target = match[3].startsWith('@/') && sourceRoot ? resolve(sourceRoot, match[3].slice(2)) : resolve(dirname(file), match[3])
      imports.set(componentKey(match[1]), target)
    }
    const nodes = renderNodesFromScripts(parsed.descriptor, file)
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
  const nodeIdentities = node => new Set([
    node.name && node.name !== 'template' ? node.name.toLowerCase() : undefined,
    ...node.classes.map(className => `.${className}`),
    node.id ? `#${node.id}` : undefined,
  ].filter(Boolean))
  const localAncestorPath = node => {
    const path = []
    for (let current = node?.parent; current; current = current.parent) path.unshift(nodeIdentities(current))
    return path
  }
  const documentPath = [new Set(['html', ':root']), new Set(['body']), new Set(['#app'])]
  const pathKey = path => path.map(group => [...group].sort().join('|')).join('\0')
  const componentContexts = new Map([...graphs.keys()].map(file => [file, [documentPath]]))
  let contextsChanged = true
  while (contextsChanged) {
    contextsChanged = false
    for (const [file, graph] of graphs) for (const node of graph.nodes) {
      const child = graph.imports.get(componentKey(node.name))
      if (!child || !graphs.has(child)) continue
      const local = [...localAncestorPath(node), nodeIdentities(node)]
      for (const parentContext of componentContexts.get(file) || []) {
        const context = [...parentContext, ...local]
        const key = pathKey(context)
        const childContexts = componentContexts.get(child)
        if (!childContexts.some(candidate => pathKey(candidate) === key) && childContexts.length < 128) {
          childContexts.push(context)
          contextsChanged = true
        }
      }
    }
  }
  const recordPath = (identity, ancestors) => {
    const paths = ancestorPaths.get(identity) || []
    const key = pathKey(ancestors)
    if (!paths.some(candidate => pathKey(candidate) === key)) paths.push(ancestors)
    ancestorPaths.set(identity, paths)
  }
  for (const [file, graph] of graphs) for (const node of graph.nodes) {
    const child = graph.imports.get(componentKey(node.name))
    if (!node.typography && !(child && componentRendersTypography(child))) continue
    for (let current = node; current; current = current.parent) {
      addNode(current)
      const local = localAncestorPath(current)
      for (const context of componentContexts.get(file) || []) for (const identity of nodeIdentities(current)) recordPath(identity, [...context, ...local])
    }
  }
  recordPath('html', [])
  recordPath(':root', [])
  recordPath('body', [documentPath[0]])
  recordPath('#app', documentPath.slice(0, 2))
  Object.defineProperty(evidence, 'ancestorPaths', { value: ancestorPaths })
  return evidence
}
const siteTypographyEvidence = typographyEvidenceFromVue()
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
      const include = statement.match(/^@include\s+([\s\S]+)$/)
      if (include) { declarations.push({ property: '@include', value: include[1].trim(), contexts }); return }
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
const sassMixinDefinitions = source => {
  const clean = source.replace(/\/\*[\s\S]*?\*\//g, '')
  const definitions = new Map()
  const pattern = /@mixin\s+([\w-]+)\s*(\([^{}]*\))?\s*\{/g
  for (const match of clean.matchAll(pattern)) {
    const open = match.index + match[0].lastIndexOf('{')
    let cursor = open + 1
    let braces = 1
    let quote = ''
    while (cursor < clean.length && braces > 0) {
      const character = clean[cursor]
      if (quote) { if (character === quote && clean[cursor - 1] !== '\\') quote = '' }
      else if (character === '"' || character === "'") quote = character
      else if (character === '{') braces += 1
      else if (character === '}') braces -= 1
      cursor += 1
    }
    if (braces !== 0) continue
    const params = splitTopLevel(match[2]?.slice(1, -1) || '', ',').map(parameter => {
      const [name, ...fallback] = splitTopLevel(parameter, ':')
      return { name: name?.trim(), fallback: fallback.length ? fallback.join(':').trim() : undefined }
    }).filter(parameter => /^\$[\w-]+$/.test(parameter.name || ''))
    definitions.set(match[1], { params, body: clean.slice(open + 1, cursor - 1) })
  }
  return definitions
}
const substituteMixinBindings = (value, bindings) => String(value).replace(/\$[A-Za-z_-][\w-]*/g, name => bindings.get(name) ?? name)
const parseMixinInclude = value => {
  const match = value.trim().match(/^([\w-]+)\s*(?:\(([\s\S]*)\))?$/)
  return match ? { name: match[1], args: splitTopLevel(match[2] || '', ',') } : undefined
}
const expandedMixinDeclarations = source => {
  const definitions = sassMixinDefinitions(source)
  const expanded = []
  const unresolved = (contexts, value) => expanded.push({ property: '@include-unknown', value, contexts })
  const expand = (rawInclude, contexts, inherited = new Map(), stack = new Set(), depth = 0) => {
    const include = parseMixinInclude(substituteMixinBindings(rawInclude, inherited))
    if (!include || !definitions.has(include.name) || stack.has(include.name) || depth > 24) { unresolved(contexts, rawInclude); return }
    const definition = definitions.get(include.name)
    const positional = []
    const named = new Map()
    for (const argument of include.args) {
      const [candidate, ...rest] = splitTopLevel(argument, ':')
      if (/^\$[\w-]+$/.test(candidate || '') && rest.length) named.set(candidate, rest.join(':').trim())
      else positional.push(argument)
    }
    const local = new Map(inherited)
    let position = 0
    for (const parameter of definition.params) {
      const value = named.get(parameter.name) ?? positional[position++] ?? parameter.fallback
      if (value !== undefined) local.set(parameter.name, substituteMixinBindings(value, inherited))
    }
    const nestedStack = new Set(stack).add(include.name)
    for (const declaration of nestedStyleDeclarations(definition.body)) {
      const nestedContexts = contexts.concat(declaration.contexts.filter(context => !/^@mixin\b/.test(context)).map(context => substituteMixinBindings(context, local)))
      if (declaration.property === '@include') expand(declaration.value, nestedContexts, local, nestedStack, depth + 1)
      else expanded.push({ ...declaration, value: substituteMixinBindings(declaration.value, local), contexts: nestedContexts })
    }
  }
  for (const declaration of nestedStyleDeclarations(source)) {
    if (declaration.property !== '@include' || declaration.contexts.some(context => /^@mixin\b/.test(context))) continue
    expand(declaration.value, declaration.contexts)
  }
  return expanded
}
const sassImportCandidates = path => {
  const extension = extname(path)
  const directory = dirname(path)
  const name = basename(path, extension)
  const candidates = extension ? [path] : [path, `${path}.scss`, `${path}.sass`, join(path, 'index.scss'), join(path, '_index.scss')]
  if (!name.startsWith('_')) candidates.push(join(directory, `_${name}${extension || '.scss'}`))
  return candidates
}
const compileSassStyleSources = styleSources => {
  const sources = new Map(styleSources.map(style => [resolve(style.file.replace(/#style-\d+$/, '')), style.source]))
  const sourceRoot = [...sources.keys()].map(file => file.match(/^(.*\/src)(?:\/|$)/)?.[1]).find(Boolean)
  const contractUrl = file => new URL(`contract:${encodeURIComponent(resolve(file))}`)
  const contractFile = url => resolve(decodeURIComponent(url.href.slice('contract:'.length)))
  const importer = {
    canonicalize(specifier, context) {
      if (/^(?:sass:|https?:|data:)/i.test(specifier)) return null
      let requested
      if (specifier.startsWith('@/') && sourceRoot) requested = resolve(sourceRoot, specifier.slice(2))
      else if (specifier.startsWith('file:')) requested = fileURLToPath(specifier)
      else if (context.containingUrl?.protocol === 'file:') requested = resolve(dirname(fileURLToPath(context.containingUrl)), specifier)
      else if (context.containingUrl?.protocol === 'contract:') requested = resolve(dirname(contractFile(context.containingUrl)), specifier)
      else return null
      const found = sassImportCandidates(requested).find(candidate => sources.has(resolve(candidate)))
      return found ? contractUrl(found) : null
    },
    load(url) {
      const contents = sources.get(url.protocol === 'contract:' ? contractFile(url) : resolve(fileURLToPath(url)))
      return contents === undefined ? null : { contents, syntax: 'scss' }
    },
  }
  return styleSources.map(style => {
    if (!/@(?:use|import|mixin|include)\b|\$[A-Za-z_-][\w-]*\s*:/.test(style.source)) return { ...style, compiled: false }
    try {
      const file = resolve(style.file.replace(/#style-\d+$/, ''))
      const result = compileString(style.source, { url: contractUrl(file), importers: [importer], logger: { warn() {}, debug() {} } })
      return { ...style, source: result.css, compiled: true }
    } catch {
      // Fall back to the focused static expander so unresolved includes on typography fail conservatively.
      return { ...style, compiled: false }
    }
  })
}
const normalizedStyleContext = contexts => contexts.filter(context => !context.startsWith('@')).map(context => context.replace(/\s+/g, ' ').trim()).join(' ')
const effectiveStyleSelectors = contexts => contexts.filter(context => !context.startsWith('@')).reduce((parents, context) => {
  const children = splitTopLevel(context, ',')
  return parents.flatMap(parent => children.map(child => child.includes('&') ? child.replaceAll('&', parent) : parent ? `${parent} ${child}` : child))
}, ['']).map(selector => normalizeSelector(selector))
const selectorTargetsTypography = (selector, evidence) => {
  const rightmost = selectorCompounds(selector).at(-1) || ''
  if (functionalPseudoArguments(rightmost, new Set(['has'])).length) return relationalTypographySelectorMatches(selector, evidence)
  return [...evidence].some(target => (evidence.ancestorPaths?.get(target) || []).some(path => structureMatchesKnownPath(selectorStructure(selector), [...path, new Set([target])])))
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
  const declarations = compileSassStyleSources(styleSources).flatMap(style => nestedStyleDeclarations(style.source)
    .filter(declaration => declaration.property !== '@include' && !declaration.contexts.some(context => /^@mixin\b/.test(context)))
    .concat(style.compiled ? [] : expandedMixinDeclarations(style.source))
    .map(declaration => ({ ...declaration, file: style.file })))
  for (const declaration of declarations) {
    const targetsTypography = effectiveStyleSelectors(declaration.contexts).some(selector => selectorTargetsTypography(selector, evidence))
    if (!targetsTypography) continue
    if (declaration.property === '@include-unknown') assert.fail(`Sass mixin must resolve on typography in ${declaration.file} (${normalizedStyleContext(declaration.contexts) || 'root'})`)
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
    return splitTopLevel(subject.slice(open + 1, cursor - 1), ',').flatMap(branch => expand(`${before}${selectorCompounds(branch).at(-1) || ''}${after}`))
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
  const targetTokens = new Set(compoundTokens(target))
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
        const branches = splitTopLevel(subject.slice(open + 1, cursor - 1), ',')
        const name = match[1].toLowerCase()
        if (['is', 'where'].includes(name)) return branches.some(branch => matches(`${subject.slice(0, match.index)}${selectorCompounds(branch).at(-1) || '*'}${subject.slice(cursor)}`))
        if (name === 'not') return matches(base) && branches.every(branch => !matches(selectorCompounds(branch).at(-1) || '*'))
        return matches(base)
      }
    }
    const identities = compoundTokens(subject).filter(token => token !== '*' && !token.startsWith(':'))
    return identities.length === 0 || (targetIdentities.length > 0 && identities.every(token => targetTokens.has(token)))
  }
  return matches(candidate)
}
const structureMatchesKnownPath = (structure, path) => {
  const { compounds, combinators, leading } = structure
  if (!compounds.length || !path.length || ['+', '~'].some(value => combinators.includes(value) || leading === value)) return false
  const matchesGroup = (compound, group) => [...group].some(identity => compoundMayTarget(compound, identity))
  const matchFrom = (compoundIndex, pathIndex) => {
    if (pathIndex < 0 || !matchesGroup(compounds[compoundIndex], path[pathIndex])) return false
    if (compoundIndex === 0) return leading !== '>' || pathIndex === 0
    const relation = combinators[compoundIndex - 1] || ' '
    if (relation === '>') return matchFrom(compoundIndex - 1, pathIndex - 1)
    for (let candidate = pathIndex - 1; candidate >= 0; candidate -= 1) if (matchFrom(compoundIndex - 1, candidate)) return true
    return false
  }
  return matchFrom(compounds.length - 1, path.length - 1)
}
const compoundsMatchKnownPath = (compounds, path) => structureMatchesKnownPath({ compounds, combinators: compounds.slice(1).map(() => ' ') }, path)
const selectorLeadingCompoundsAreKnown = (compounds, evidence, target) => {
  if (compounds.length === 0) return true
  const paths = target ? evidence.ancestorPaths?.get(target.toLowerCase()) : undefined
  const candidates = paths?.length ? paths : [[new Set(evidence)]]
  return candidates.some(path => compoundsMatchKnownPath(compounds, path))
}
const relationalTypographySelectorMatches = (selector, evidence) => {
  const structure = selectorStructure(selector)
  const subject = structure.compounds.at(-1) || ''
  const argumentsByPseudo = functionalPseudoArguments(subject, new Set(['has'])).map(value => splitTopLevel(value, ','))
  const subjectCandidates = [...evidence].filter(identity => compoundMayTarget(subject, identity))
  return subjectCandidates.some(identity => (evidence.ancestorPaths?.get(identity) || []).some(subjectPath => {
    if (!structureMatchesKnownPath(structure, [...subjectPath, new Set([identity])])) return false
    return argumentsByPseudo.every(branches => branches.some(branch => {
      const branchStructure = selectorStructure(branch)
      const branchTarget = branchStructure.compounds.at(-1) || ''
      return [...evidence].some(descendant => compoundMayTarget(branchTarget, descendant) && (evidence.ancestorPaths?.get(descendant) || []).some(descendantPath => {
        for (let subjectIndex = 0; subjectIndex < descendantPath.length; subjectIndex += 1) {
          if (!descendantPath[subjectIndex].has(identity)) continue
          const relativePath = [...descendantPath.slice(subjectIndex + 1), new Set([descendant])]
          if (structureMatchesKnownPath(branchStructure, relativePath)) return true
        }
        return false
      }))
    }))
  }))
}
const selectorTargetsContract = (selector, target, evidence = siteTypographyEvidence) => {
  const candidate = selectorStructure(selector)
  const required = selectorStructure(target)
  const rightmostTarget = required.compounds.at(-1) || target
  if (candidate.compounds.length === 1 && required.compounds.length === 1) return compoundMayTarget(candidate.compounds[0], rightmostTarget)
  return [...(evidence || [])].filter(identity => compoundMayTarget(rightmostTarget, identity)).some(identity =>
    (evidence.ancestorPaths?.get(identity) || []).some(path => {
      const fullPath = [...path, new Set([identity])]
      return structureMatchesKnownPath(required, fullPath) && structureMatchesKnownPath(candidate, fullPath)
    }))
}
const fontSizeFromShorthand = value => value.match(/(?:^|\s)(var\([^)]*\)|(?:\d*\.)?\d+(?:px|rem|em|%|vw|vh)|xx-small|x-small|small|medium|large|x-large|xx-large|smaller|larger)(?:\s*\/|\s|$)/i)?.[1] || value
const selectorSpecificity = selector => {
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
    if (name !== 'where') score += ['is', 'not', 'has'].includes(name) ? Math.max(0, ...splitTopLevel(selector.slice(open + 1, end - 1), ',').map(selectorSpecificity)) : 10
    cursor = end
  }
  return score + (plain.match(/#[\w-]+/g) || []).length * 100 + (plain.match(/\.[\w-]+|\[[^\]]+\]|:(?!:)[\w-]+/g) || []).length * 10 + (plain.match(/(?:^|[\s>+~])(?:[a-z][\w-]*|\*)/gi) || []).filter(token => !token.trim().endsWith('*')).length
}
const effectiveValue = (stylesheet, selector, property, width, reduced, exactOnly = false) => {
  let winner
  const apply = (declaration, specificity) => {
    const candidate = { ...declaration, specificity }
    if (!winner || Number(candidate.important) > Number(winner.important) || (candidate.important === winner.important && (candidate.specificity > winner.specificity || (candidate.specificity === winner.specificity && candidate.order > winner.order)))) winner = candidate
  }
  for (const rule of stylesheet) {
    const matching = rule.selectors.filter(candidate => exactOnly ? normalizeSelector(candidate) === normalizeSelector(selector) : selectorTargetsContract(candidate, selector, siteTypographyEvidence))
    if (!matching.length || !mediaMatchesScreen(rule.media, width, reduced)) continue
    const specificity = Math.max(...matching.map(selectorSpecificity))
    for (const declaration of rule.declarations) {
      if (declaration.property === property) apply(declaration, specificity)
      else if (property === 'font-size' && declaration.property === 'font') apply({ ...declaration, property, value: fontSizeFromShorthand(declaration.value) }, specificity)
    }
  }
  return winner?.value.trim()
}
const assertMapping = (stylesheet, selector, property, expected, message, widths = allScreenWidths) => {
  for (const width of widths) for (const reduced of [false, true]) {
    assert.equal(effectiveValue(stylesheet, selector, property, width, reduced, true), expected, `${message} must be owned by ${selector} at ${width}px with reduced motion ${reduced}`)
    assert.equal(effectiveValue(stylesheet, selector, property, width, reduced), expected, `${message} must remain effective at ${width}px with reduced motion ${reduced}`)
  }
}
const assertMinimumControl = (stylesheet, selector, property, message, widths = allScreenWidths) => {
  const axis = property.endsWith('height') ? 'height' : 'width'
  const pixels = value => value === 'var(--control-min-size)' ? 44 : Number(value?.match(/^(\d+(?:\.\d+)?)px$/)?.[1])
  for (const width of widths) {
    for (const reduced of [false, true]) {
      for (const exactOnly of [true, false]) {
        const minimumValue = effectiveValue(stylesheet, selector, `min-${axis}`, width, reduced, exactOnly)
        const preferredValue = effectiveValue(stylesheet, selector, axis, width, reduced, exactOnly)
        const maximumValue = effectiveValue(stylesheet, selector, `max-${axis}`, width, reduced, exactOnly)
        const minimum = pixels(minimumValue)
        const preferred = pixels(preferredValue)
        const maximum = maximumValue === 'none' ? Number.POSITIVE_INFINITY : pixels(maximumValue)
        let effective = Number.NaN
        if (Number.isFinite(minimum)) effective = Number.isFinite(preferred) ? Math.max(minimum, Number.isFinite(maximum) ? Math.min(preferred, maximum) : preferred) : minimum
        else if (Number.isFinite(preferred)) effective = Number.isFinite(maximum) ? Math.min(preferred, maximum) : preferred
        assert.ok(Number.isFinite(effective) && effective >= 44, `${message} ${exactOnly ? 'stable selector' : 'effective cascade'} at ${width}px with reduced motion ${reduced}; found min=${JSON.stringify(minimumValue)}, ${axis}=${JSON.stringify(preferredValue)}, max=${JSON.stringify(maximumValue)}`)
      }
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
  assertTypographyScalingPolicy(collectSiteStyleSources(), siteTypographyEvidence)

  assertMapping(tokens, 'html:root', '--control-min-size', '44px', 'shared controls retain a 44px minimum')
  for (const selector of ['.public-locale', '.public-theme', '.public-nav-toggle', '.public-button']) assert.equal(siteTypographyEvidence.has(selector), true, `${selector} must be rendered by a production public component before it can satisfy the control contract`)
  for (const selector of ['.public-locale', '.public-theme', '.public-nav-toggle', '.public-button']) {
    assertMinimumControl(publicShell, selector, 'min-width', `${selector} keeps the shared touch target width`)
    assertMinimumControl(publicShell, selector, 'min-height', `${selector} keeps the shared touch target height`)
  }
  assertMinimumControl(consoleShell, '.user-trigger', 'min-height', 'console user control keeps the shared touch target')
  for (const selector of ['.pricing-pagination button', '.pricing-pagination select', '.pricing-detail-back', '.pricing-console-cta']) assertMinimumControl(publicPricing, selector, 'min-height', `${selector} keeps a 44px target`)
  assertMinimumControl(publicPricing, '.pricing-filter-toggle', 'min-height', 'mobile pricing filter keeps a 44px target', mobileWidths)
  assertMinimumControl(publicPricing, '.pricing-drawer > header button', 'min-width', 'mobile drawer close control keeps a 44px width', mobileWidths)
  assertMinimumControl(publicPricing, '.pricing-drawer > header button', 'min-height', 'mobile drawer close control keeps a 44px height', mobileWidths)
})
