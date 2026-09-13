import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import vuePlugin from '@vitejs/plugin-vue'

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
    const walk = (node, visit) => {
      if (!node || typeof node !== 'object') return
      visit(node)
      for (const [key, value] of Object.entries(node)) {
        if (['loc', 'start', 'end', 'extra'].includes(key)) continue
        if (Array.isArray(value)) for (const child of value) walk(child, visit)
        else if (value && typeof value === 'object' && typeof value.type === 'string') walk(value, visit)
      }
    }
    const bindings = new Map()
    const helpers = new Map()
    walk(ast.program, node => {
      if (node.type === 'FunctionDeclaration' && node.id) helpers.set(node.id.name, node)
      if (node.type !== 'VariableDeclarator' || node.id?.type !== 'Identifier' || !node.init) return
      bindings.set(node.id.name, node.init)
      if (['ArrowFunctionExpression', 'FunctionExpression'].includes(unwrapJavaScript(node.init)?.type)) helpers.set(node.id.name, unwrapJavaScript(node.init))
    })
    const dereference = (expression, environment, resolving = new Set()) => {
      expression = unwrapJavaScript(expression)
      if (expression?.type !== 'Identifier' || resolving.has(expression.name)) return expression
      const value = environment.get(expression.name) ?? bindings.get(expression.name)
      return value ? dereference(value, environment, new Set(resolving).add(expression.name)) : expression
    }
    const objectProperties = (expression, environment, resolving = new Set()) => {
      expression = unwrapJavaScript(expression)
      if (expression?.type === 'Identifier') {
        if (resolving.has(expression.name)) return { known: false, values: new Map() }
        const value = environment.get(expression.name) ?? bindings.get(expression.name)
        return value ? objectProperties(value, environment, new Set(resolving).add(expression.name)) : { known: false, values: new Map() }
      }
      if (expression?.type !== 'ObjectExpression') return { known: false, values: new Map() }
      const values = new Map()
      let known = true
      for (const property of expression.properties) {
        if (property.type === 'SpreadElement') {
          const spread = objectProperties(property.argument, environment, resolving)
          if (!spread.known) { known = false; values.delete('class'); values.delete('id') }
          else for (const [name, value] of spread.values) values.set(name, value)
          continue
        }
        if (property.type !== 'ObjectProperty') continue
        const name = propertyName(property)
        if (name !== undefined) values.set(String(name), property.value)
        else { known = false; values.delete('class'); values.delete('id') }
      }
      return { known, values }
    }
    const propsFrom = (expression, environment) => {
      const props = objectProperties(expression, environment)
      const classes = staticStrings(props.values.get('class'), environment, bindings).flatMap(value => value.split(/\s+/).filter(Boolean))
      const id = staticStrings(props.values.get('id'), environment, bindings)[0]
      return { known: props.known, classes: [...new Set(classes)], id }
    }
    const returnExpressions = body => {
      body = unwrapJavaScript(body)
      if (!body) return []
      if (body.type !== 'BlockStatement') return [body]
      const values = []
      walk(body, node => { if (node.type === 'ReturnStatement' && node.argument) values.push(node.argument) })
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
        const name = calleeName(expression.callee)
        const helper = helpers.get(name)
        if (!helper) return false
        if (activeStack.has(name) || activeDepth >= 24) { node.typography = true; return true }
        const nestedEnvironment = new Map(activeEnvironment)
        for (let index = 0; index < helper.params.length; index += 1) {
          const parameter = unwrapJavaScript(helper.params[index])
          const target = parameter?.type === 'AssignmentPattern' ? parameter.left : parameter
          const argument = expression.arguments[index] ?? (parameter?.type === 'AssignmentPattern' ? parameter.right : undefined)
          if (target?.type === 'Identifier' && argument) nestedEnvironment.set(target.name, dereference(argument, activeEnvironment))
        }
        const nestedStack = new Set(activeStack).add(name)
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
        if (expression.type === 'ConditionalExpression') { markVisibleChild(expression.consequent, activeEnvironment, activeStack, activeDepth, activeInstantiation); markVisibleChild(expression.alternate, activeEnvironment, activeStack, activeDepth, activeInstantiation); return }
        if (expression.type === 'LogicalExpression' || expression.type === 'BinaryExpression') { markVisibleChild(expression.left, activeEnvironment, activeStack, activeDepth, activeInstantiation); markVisibleChild(expression.right, activeEnvironment, activeStack, activeDepth, activeInstantiation); return }
        if (expression.type === 'SequenceExpression') { markVisibleChild(expression.expressions.at(-1), activeEnvironment, activeStack, activeDepth, activeInstantiation); return }
        if (expression.type === 'SpreadElement' || expression.type === 'AwaitExpression') { markVisibleChild(expression.argument, activeEnvironment, activeStack, activeDepth, activeInstantiation) }
      }
      const children = call.arguments.length > 2 ? call.arguments.slice(2) : propsIndex === -1 ? call.arguments.slice(1) : []
      for (const child of children) markVisibleChild(child)
      return node
    }
    // Only syntax is inspected: render helpers, slots, and component bodies are never invoked.
    walk(ast.program, node => {
      if (isCall(node) && renderCalls.has(calleeName(node.callee)) && !seen.has(node)) parseRenderCall(node, undefined)
    })
  }
  return nodes
}
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
