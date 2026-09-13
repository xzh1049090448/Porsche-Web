import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'
import vuePlugin from '@vitejs/plugin-vue'
import { createMemoryHistory } from 'vue-router'

const vueCompiler = (() => {
  const plugin = vuePlugin()
  plugin.buildStart()
  return plugin.api.options.compiler
})()

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8')
const readRequired = (path, label) => {
  const url = new URL(path, import.meta.url)
  assert.equal(existsSync(url), true, `${label} must exist at ${url.pathname}`)
  return readFileSync(url, 'utf8')
}
const templateAst = source => {
  const parsed = vueCompiler.parse(source, { filename: 'route-transition-contract.vue' })
  assert.deepEqual(parsed.errors, [], `component SFC must parse cleanly: ${parsed.errors.map(String).join('; ')}`)
  const template = parsed.descriptor.template
  assert.ok(template?.ast, 'component must contain a Vue template')
  return template.ast
}
const elements = (source, name) => {
  const matches = []
  const visit = node => {
    if (node.type === 1 && node.tag === name) matches.push(node)
    for (const child of node.children || []) visit(child)
    for (const branch of node.branches || []) visit(branch)
  }
  visit(templateAst(source))
  return matches
}
const staticAttribute = (node, name) => node.props.find(prop => prop.type === 6 && prop.name === name)?.value?.content
const boundAttribute = (node, name) => node.props.find(prop => prop.type === 7 && prop.name === 'bind' && prop.arg?.type === 4 && prop.arg.content === name)?.exp?.content
const unwrapKeyExpression = node => {
  while (node && ['ParenthesizedExpression', 'TSAsExpression', 'TSTypeAssertion', 'TSNonNullExpression', 'TypeCastExpression'].includes(node.type)) node = node.expression
  return node
}
const parseKeyExpression = value => {
  try { return vueCompiler.babelParse(`(${value})`, { sourceType: 'module', plugins: ['typescript'] }).program.body[0]?.expression }
  catch (error) { throw new Error(`route leaf key expression must parse cleanly: ${error.message}`, { cause: error }) }
}
const keyAstContains = (node, predicate) => {
  if (!node || typeof node !== 'object') return false
  if (predicate(node)) return true
  return Object.entries(node).some(([name, value]) => !['loc', 'start', 'end', 'extra'].includes(name) && (Array.isArray(value) ? value.some(item => keyAstContains(item, predicate)) : keyAstContains(value, predicate)))
}
const isRouteFullPath = node => {
  node = unwrapKeyExpression(node)
  return ['MemberExpression', 'OptionalMemberExpression'].includes(node?.type)
    && unwrapKeyExpression(node.object)?.type === 'Identifier'
    && unwrapKeyExpression(node.object).name === 'route'
    && (node.computed ? node.property?.type === 'StringLiteral' && node.property.value === 'fullPath' : node.property?.name === 'fullPath')
}
const keyHelperDefinitions = source => {
  const parsed = vueCompiler.parse(source, { filename: 'route-transition-contract.vue' })
  assert.deepEqual(parsed.errors, [], `component SFC must parse cleanly: ${parsed.errors.map(String).join('; ')}`)
  const helpers = new Map()
  for (const block of [parsed.descriptor.script, parsed.descriptor.scriptSetup].filter(Boolean)) {
    let ast
    try { ast = vueCompiler.babelParse(block.content, { sourceType: 'module', plugins: ['typescript'] }) }
    catch (error) { throw new Error(`route transition script must parse cleanly: ${error.message}`, { cause: error }) }
    for (const statement of ast.program.body) {
      const declaration = statement.type === 'ExportNamedDeclaration' ? statement.declaration : statement
      if (declaration?.type === 'FunctionDeclaration' && declaration.id) helpers.set(declaration.id.name, declaration)
      if (declaration?.type === 'VariableDeclaration') for (const item of declaration.declarations) {
        if (item.id?.type === 'Identifier' && ['ArrowFunctionExpression', 'FunctionExpression'].includes(item.init?.type)) helpers.set(item.id.name, item.init)
      }
    }
  }
  return helpers
}
const returnedKeyExpressions = node => {
  node = unwrapKeyExpression(node)
  if (!node) return []
  if (node.type === 'ReturnStatement') return node.argument ? [node.argument] : []
  if (node.type === 'BlockStatement') return node.body.flatMap(returnedKeyExpressions)
  if (node.type === 'IfStatement') return returnedKeyExpressions(node.consequent).concat(returnedKeyExpressions(node.alternate))
  if (node.type === 'SwitchStatement') return node.cases.flatMap(branch => branch.consequent.flatMap(returnedKeyExpressions))
  return /(?:Statement|Declaration)$/.test(node.type) ? [] : [node]
}
const mergeContributorAlternatives = parts => {
  if (parts.some(part => part === null)) return null
  return parts.reduce((merged, alternatives) => merged.flatMap(current => alternatives.map(alternative => new Set([...current, ...alternative]))), [new Set()])
}
const keyPartContributorAlternatives = (node, identityName, helpers, parameters = new Map(), resolving = new Set()) => {
  node = unwrapKeyExpression(node)
  if (!node) return [new Set()]
  if (isRouteFullPath(node)) return [new Set(['route'])]
  if (node.type === 'Identifier' && node.name === identityName) return [new Set(['identity'])]
  if (node.type === 'Identifier' && parameters.has(node.name)) return parameters.get(node.name).map(contributors => new Set(contributors))
  if (['StringLiteral', 'NumericLiteral', 'BooleanLiteral', 'NullLiteral'].includes(node.type)) return [new Set()]
  if (node.type === 'TemplateLiteral' || (node.type === 'BinaryExpression' && node.operator === '+') || node.type === 'CallExpression' || node.type === 'OptionalCallExpression') {
    return composedKeyContributorAlternatives(node, identityName, helpers, parameters, resolving)
  }
  return null
}
const composedKeyContributorAlternatives = (node, identityName, helpers, parameters = new Map(), resolving = new Set()) => {
  node = unwrapKeyExpression(node)
  if (node?.type === 'TemplateLiteral') return mergeContributorAlternatives(node.expressions.map(expression => keyPartContributorAlternatives(expression, identityName, helpers, parameters, resolving)))
  if (node?.type === 'BinaryExpression' && node.operator === '+') return mergeContributorAlternatives([keyPartContributorAlternatives(node.left, identityName, helpers, parameters, resolving), keyPartContributorAlternatives(node.right, identityName, helpers, parameters, resolving)])
  if (['CallExpression', 'OptionalCallExpression'].includes(node?.type) && node.callee?.type === 'Identifier' && helpers.has(node.callee.name) && !resolving.has(node.callee.name)) {
    const helper = helpers.get(node.callee.name)
    const mapped = new Map()
    for (let index = 0; index < helper.params.length; index += 1) {
      if (helper.params[index]?.type !== 'Identifier') return null
      const alternatives = keyPartContributorAlternatives(node.arguments[index], identityName, helpers, parameters, resolving)
      if (alternatives === null) return null
      mapped.set(helper.params[index].name, alternatives)
    }
    const returns = returnedKeyExpressions(helper.body)
    if (returns.length === 0) return null
    const next = new Set(resolving).add(node.callee.name)
    const results = returns.map(expression => composedKeyContributorAlternatives(expression, identityName, helpers, mapped, next))
    if (results.some(result => result === null)) return null
    const alternatives = results.flat()
    return alternatives.every(contributors => contributors.has('route') && contributors.has('identity')) ? alternatives : null
  }
  return null
}
const keyComposesRouteIdentity = (expression, identityName, source) => {
  const alternatives = composedKeyContributorAlternatives(expression, identityName, keyHelperDefinitions(source))
  return Boolean(alternatives?.length && alternatives.every(contributors => contributors.has('route') && contributors.has('identity')))
}
const balancedSlice = (source, start, open, close) => {
  if (source[start] !== open) return undefined
  let depth = 1
  let end = start + 1
  while (end < source.length && depth > 0) {
    if (source[end] === open) depth += 1
    else if (source[end] === close) depth -= 1
    end += 1
  }
  return depth === 0 ? { content: source.slice(start + 1, end - 1), end } : undefined
}
const unwrapScriptExpression = node => {
  while (node && ['ParenthesizedExpression', 'TSAsExpression', 'TSTypeAssertion', 'TSNonNullExpression', 'TypeCastExpression'].includes(node.type)) node = node.expression
  return node
}
const scriptPropertyName = node => {
  const key = unwrapScriptExpression(node?.key)
  return !key || (node.computed && !['StringLiteral', 'NumericLiteral'].includes(key.type)) ? undefined : key.name ?? key.value
}
const walkScriptAst = (node, visit, parent) => {
  if (!node || typeof node !== 'object') return
  visit(node, parent)
  for (const [key, value] of Object.entries(node)) {
    if (['loc', 'start', 'end', 'extra'].includes(key)) continue
    if (Array.isArray(value)) for (const child of value) walkScriptAst(child, visit, node)
    else if (value && typeof value === 'object' && typeof value.type === 'string') walkScriptAst(value, visit, node)
  }
}
const componentScriptAsts = (source, label = 'route transition') => {
  const parsed = vueCompiler.parse(source, { filename: `${label}.vue` })
  assert.deepEqual(parsed.errors, [], `${label} SFC must parse cleanly: ${parsed.errors.map(String).join('; ')}`)
  return [parsed.descriptor.script, parsed.descriptor.scriptSetup].filter(Boolean).map(block => {
    try { return vueCompiler.babelParse(block.content, { sourceType: 'module', plugins: block.lang === 'ts' || block.lang === 'tsx' ? ['typescript'] : [] }) }
    catch (error) { throw new Error(`${label} script must parse cleanly: ${error.message}`, { cause: error }) }
  })
}
const objectDeclaresProp = (node, name) => {
  node = unwrapScriptExpression(node)
  if (node?.type === 'ArrayExpression') return node.elements.some(element => unwrapScriptExpression(element)?.type === 'StringLiteral' && element.value === name)
  return node?.type === 'ObjectExpression' && node.properties.some(property => scriptPropertyName(property) === name)
}
const declaresComponentProp = (source, name) => componentScriptAsts(source).some(ast => {
  let declared = false
  for (const statement of ast.program.body) {
    walkScriptAst(statement, node => {
      if (declared) return
      if (['CallExpression', 'OptionalCallExpression'].includes(node.type) && unwrapScriptExpression(node.callee)?.type === 'Identifier' && node.callee.name === 'defineProps') {
        if (objectDeclaresProp(node.arguments[0], name)) declared = true
        for (const typeRoot of [node.typeParameters, node.typeArguments].filter(Boolean)) walkScriptAst(typeRoot, typeNode => { if (['TSPropertySignature', 'ObjectProperty'].includes(typeNode.type) && scriptPropertyName(typeNode) === name) declared = true })
      }
    })
    if (statement.type !== 'ExportDefaultDeclaration') continue
    let options = unwrapScriptExpression(statement.declaration)
    if (['CallExpression', 'OptionalCallExpression'].includes(options?.type) && unwrapScriptExpression(options.callee)?.type === 'Identifier' && options.callee.name === 'defineComponent') options = unwrapScriptExpression(options.arguments[0])
    const props = options?.type === 'ObjectExpression' ? options.properties.find(property => scriptPropertyName(property) === 'props') : undefined
    if (props && objectDeclaresProp(props.value, name)) declared = true
  }
  return declared
})
const shadowsComponentProp = (source, name) => componentScriptAsts(source).some(ast => {
  let shadowed = false
  walkScriptAst(ast.program, node => {
    if (node.type !== 'VariableDeclarator') return
    if (node.id?.type === 'Identifier' && node.id.name === name) shadowed = true
    if (node.id?.type !== 'ObjectPattern') return
    const declaresName = node.id.properties.some(property => scriptPropertyName(property) === name || unwrapScriptExpression(property.value)?.name === name)
    const initializer = unwrapScriptExpression(node.init)
    const fromProps = ['CallExpression', 'OptionalCallExpression'].includes(initializer?.type) && unwrapScriptExpression(initializer.callee)?.type === 'Identifier' && initializer.callee.name === 'defineProps'
    if (declaresName && !fromProps) shadowed = true
  })
  return shadowed
})
const importsComponent = (source, specifier) => componentScriptAsts(source, 'shell').some(ast => ast.program.body.some(statement => statement.type === 'ImportDeclaration' && statement.source.value === specifier))
const renderFunctionUsesComponent = (source, specifier) => componentScriptAsts(source, 'render shell').some(ast => {
  const renderNames = new Set(['h', 'createVNode'])
  let componentName
  const bindings = new Map()
  const helpers = new Map()
  const parents = new WeakMap()
  walkScriptAst(ast.program, (node, parent) => { if (parent) parents.set(node, parent) })
  const componentScopes = new Set()
  for (const statement of ast.program.body) {
    if (statement.type === 'ImportDeclaration') for (const imported of statement.specifiers) {
      const name = imported.imported?.name ?? imported.imported?.value
      if (statement.source.value === 'vue' && ['h', 'createVNode'].includes(name)) renderNames.add(imported.local.name)
      if (statement.source.value === specifier) componentName = imported.local.name
    }
    if (statement.type === 'ExportDefaultDeclaration') {
      let options = unwrapScriptExpression(statement.declaration)
      if (['CallExpression', 'OptionalCallExpression'].includes(options?.type) && unwrapScriptExpression(options.callee)?.type === 'Identifier' && options.callee.name === 'defineComponent') options = unwrapScriptExpression(options.arguments[0])
      if (options?.type === 'ObjectExpression') for (const property of options.properties.filter(candidate => ['setup', 'render'].includes(String(scriptPropertyName(candidate))))) {
        componentScopes.add(property.type === 'ObjectMethod' ? property : unwrapScriptExpression(property.value))
      }
    }
  }
  const functionBindings = new Map()
  walkScriptAst(ast.program, node => {
    if (node.type === 'FunctionDeclaration' && node.id) functionBindings.set(node.id.name, node)
    if (node.type === 'VariableDeclarator' && node.id?.type === 'Identifier' && ['ArrowFunctionExpression', 'FunctionExpression'].includes(unwrapScriptExpression(node.init)?.type)) functionBindings.set(node.id.name, unwrapScriptExpression(node.init))
  })
  const nearestFunction = node => {
    for (let current = parents.get(node); current; current = parents.get(current)) if (['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression', 'ObjectMethod'].includes(current.type)) return current
    return undefined
  }
  for (const scope of [...componentScopes]) walkScriptAst(scope?.body, node => {
    if (node.type !== 'ReturnStatement' || nearestFunction(node) !== scope || !node.argument) return
    walkScriptAst(node.argument, candidate => {
      const value = unwrapScriptExpression(candidate)
      if (['ArrowFunctionExpression', 'FunctionExpression'].includes(value?.type)) componentScopes.add(value)
      if (value?.type === 'Identifier' && functionBindings.has(value.name)) componentScopes.add(functionBindings.get(value.name))
    })
  })
  if (!componentName) return false
  const staticValue = node => {
    node = unwrapScriptExpression(node)
    if (['BooleanLiteral', 'NumericLiteral', 'StringLiteral'].includes(node?.type)) return { known: true, value: node.value }
    if (node?.type === 'NullLiteral' || (node?.type === 'Identifier' && node.name === 'undefined')) return { known: true, value: undefined }
    if (node?.type === 'UnaryExpression' && node.operator === '!') { const value = staticValue(node.argument); return value.known ? { known: true, value: !value.value } : value }
    return { known: false }
  }
  const reachability = node => {
    let uncertain = false
    for (let current = node, parent = parents.get(current); parent; current = parent, parent = parents.get(parent)) {
      if (['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression', 'ObjectMethod'].includes(parent.type) && !componentScopes.has(parent)) return false
      if (parent.type === 'IfStatement' && (current === parent.consequent || current === parent.alternate)) {
        const condition = staticValue(parent.test)
        if (condition.known && Boolean(condition.value) !== (current === parent.consequent)) return false
        if (!condition.known) uncertain = true
      }
      if (parent.type === 'ConditionalExpression' && (current === parent.consequent || current === parent.alternate)) {
        const condition = staticValue(parent.test)
        if (condition.known && Boolean(condition.value) !== (current === parent.consequent)) return false
        if (!condition.known) uncertain = true
      }
      if (parent.type === 'LogicalExpression' && current === parent.right) {
        const left = staticValue(parent.left)
        if (left.known && ((parent.operator === '&&' && !left.value) || (parent.operator === '||' && left.value))) return false
        if (!left.known) uncertain = true
      }
    }
    return uncertain ? 'maybe' : true
  }
  const memberReference = (object, name, sourceNode) => ({
    type: 'MemberExpression', object, property: { type: 'StringLiteral', value: String(name) }, computed: true,
    start: sourceNode?.start, end: sourceNode?.end,
  })
  const bindPattern = (pattern, value, certainty = true) => {
    pattern = unwrapScriptExpression(pattern)
    if (!pattern || certainty === false) return
    if (pattern.type === 'Identifier') {
      const previous = bindings.get(pattern.name)
      bindings.set(pattern.name, certainty === 'maybe' && previous
        ? { type: 'ConditionalExpression', test: { type: 'Identifier', name: '__dynamic_branch__' }, consequent: value, alternate: previous }
        : value)
      return
    }
    if (pattern.type === 'AssignmentPattern') { bindPattern(pattern.left, value, certainty); return }
    if (pattern.type === 'ObjectPattern') for (const property of pattern.properties) {
      if (property.type !== 'RestElement') bindPattern(property.value, memberReference(value, scriptPropertyName(property), property), certainty)
    }
    if (pattern.type === 'ArrayPattern') for (let index = 0; index < pattern.elements.length; index += 1) {
      if (pattern.elements[index]?.type !== 'RestElement') bindPattern(pattern.elements[index], memberReference(value, index, pattern.elements[index]), certainty)
    }
  }
  walkScriptAst(ast.program, node => {
    if (node.type === 'FunctionDeclaration' && node.id) helpers.set(node.id.name, node)
    if (node.type === 'VariableDeclarator' && node.init) {
      const certainty = reachability(node)
      bindPattern(node.id, node.init, certainty)
      if (certainty !== false && node.id?.type === 'Identifier' && ['ArrowFunctionExpression', 'FunctionExpression'].includes(unwrapScriptExpression(node.init)?.type)) helpers.set(node.id.name, unwrapScriptExpression(node.init))
    }
    if (node.type === 'AssignmentExpression' && node.operator === '=' && ['Identifier', 'ObjectPattern', 'ArrayPattern'].includes(node.left?.type)) bindPattern(node.left, node.right, reachability(node))
  })
  const memberName = node => {
    const property = unwrapScriptExpression(node?.property)
    if (!node?.computed && property?.type === 'Identifier') return property.name
    return node?.computed && ['StringLiteral', 'NumericLiteral'].includes(property?.type) ? String(property.value) : undefined
  }
  const memberValue = (object, name, resolving = new Set()) => {
    object = unwrapScriptExpression(object)
    if (!object || resolving.size > 32) return undefined
    if (object.type === 'Identifier' && bindings.has(object.name) && !resolving.has(object.name)) return memberValue(bindings.get(object.name), name, new Set(resolving).add(object.name))
    if (object.type === 'ArrayExpression') return object.elements[Number(name)]
    if (object.type !== 'ObjectExpression') return undefined
    let found
    for (const property of object.properties) {
      if (property.type === 'SpreadElement') {
        const spread = memberValue(property.argument, name, resolving)
        if (spread) found = spread
      } else if (scriptPropertyName(property) === name) found = property.value
    }
    return found
  }
  const isComponentReference = (node, resolving = new Set()) => {
    node = unwrapScriptExpression(node)
    if (!node || resolving.size > 32) return false
    if (node.type === 'Identifier') {
      if (node.name === componentName) return true
      if (!bindings.has(node.name) || resolving.has(node.name)) return false
      return isComponentReference(bindings.get(node.name), new Set(resolving).add(node.name))
    }
    if (['MemberExpression', 'OptionalMemberExpression'].includes(node.type)) {
      const value = memberValue(node.object, memberName(node), resolving)
      return value ? isComponentReference(value, resolving) : false
    }
    if (node.type === 'ConditionalExpression') {
      const condition = staticValue(node.test)
      return condition.known ? isComponentReference(condition.value ? node.consequent : node.alternate, resolving) : isComponentReference(node.consequent, resolving) || isComponentReference(node.alternate, resolving)
    }
    if (node.type === 'LogicalExpression') {
      const left = staticValue(node.left)
      if (left.known) return isComponentReference(node.left, resolving) || ((node.operator === '&&' ? Boolean(left.value) : node.operator === '||' ? !left.value : left.value == null) && isComponentReference(node.right, resolving))
      return isComponentReference(node.left, resolving) || isComponentReference(node.right, resolving)
    }
    if (node.type === 'SequenceExpression') return isComponentReference(node.expressions.at(-1), resolving)
    return false
  }
  const resolvedVNodeType = (node, resolving = new Set()) => {
    node = unwrapScriptExpression(node)
    if (!node || resolving.size > 32) return undefined
    if (node.type === 'StringLiteral') return node
    if (node.type === 'Identifier' && bindings.has(node.name) && !resolving.has(node.name)) return resolvedVNodeType(bindings.get(node.name), new Set(resolving).add(node.name))
    if (['MemberExpression', 'OptionalMemberExpression'].includes(node.type)) {
      const value = memberValue(node.object, memberName(node), resolving)
      return value ? resolvedVNodeType(value, resolving) : undefined
    }
    if (node.type === 'ConditionalExpression') {
      const condition = staticValue(node.test)
      return condition.known ? resolvedVNodeType(condition.value ? node.consequent : node.alternate, resolving) : undefined
    }
    if (node.type === 'SequenceExpression') return resolvedVNodeType(node.expressions.at(-1), resolving)
    return undefined
  }
  const returns = body => {
    body = unwrapScriptExpression(body)
    if (!body) return []
    if (body.type !== 'BlockStatement') return [body]
    const values = []
    const visit = node => {
      if (!node) return
      if (node.type === 'ReturnStatement') { if (node.argument) values.push(node.argument); return }
      if (node !== body && ['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression', 'ObjectMethod'].includes(node.type)) return
      if (node.type === 'IfStatement') { const condition = staticValue(node.test); if (condition.known) visit(condition.value ? node.consequent : node.alternate); else { visit(node.consequent); visit(node.alternate) }; return }
      for (const [key, value] of Object.entries(node)) if (!['loc', 'start', 'end', 'extra'].includes(key)) {
        if (Array.isArray(value)) for (const child of value) visit(child)
        else if (value?.type) visit(value)
      }
    }
    visit(body)
    return values
  }
  const inspect = (node, resolving = new Set()) => {
    node = unwrapScriptExpression(node)
    if (!node) return false
    if (node.type === 'Identifier') {
      if (resolving.has(node.name)) return false
      const next = new Set(resolving).add(node.name)
      return bindings.has(node.name) ? inspect(bindings.get(node.name), next) : helpers.has(node.name) ? returns(helpers.get(node.name).body).some(value => inspect(value, next)) : false
    }
    if (['ArrowFunctionExpression', 'FunctionExpression', 'FunctionDeclaration'].includes(node.type)) return returns(node.body).some(value => inspect(value, resolving))
    if (node.type === 'ConditionalExpression') { const value = staticValue(node.test); return value.known ? inspect(value.value ? node.consequent : node.alternate, resolving) : inspect(node.consequent, resolving) || inspect(node.alternate, resolving) }
    if (node.type === 'LogicalExpression') { const left = staticValue(node.left); if (left.known) return inspect(node.left, resolving) || ((node.operator === '&&' ? Boolean(left.value) : node.operator === '||' ? !left.value : left.value == null) && inspect(node.right, resolving)); return inspect(node.left, resolving) || inspect(node.right, resolving) }
    if (node.type === 'SequenceExpression') return inspect(node.expressions.at(-1), resolving)
    if (node.type === 'ArrayExpression') return node.elements.some(value => inspect(value, resolving))
    if (!['CallExpression', 'OptionalCallExpression'].includes(node.type)) return false
    if (unwrapScriptExpression(node.callee)?.type === 'Identifier' && renderNames.has(node.callee.name)) {
      if (isComponentReference(node.arguments[0])) return true
      const vnodeType = resolvedVNodeType(node.arguments[0])
      const componentVNode = vnodeType?.type !== 'StringLiteral'
      const children = node.arguments.length >= 3 ? node.arguments.slice(2) : node.arguments.slice(1)
      const inspectRenderedChild = child => {
        child = unwrapScriptExpression(child)
        if (!child) return false
        if (child.type === 'ArrayExpression') return child.elements.some(inspectRenderedChild)
        if (['ArrowFunctionExpression', 'FunctionExpression'].includes(child.type)) return componentVNode && returns(child.body).some(value => inspect(value, resolving))
        if (child.type === 'ObjectExpression') {
          if (!componentVNode) return false
          return child.properties.some(property => property.type === 'SpreadElement'
            ? inspect(property.argument, resolving)
            : inspect(property.type === 'ObjectMethod' ? property : property.value, resolving))
        }
        return inspect(child, resolving)
      }
      return children.some(inspectRenderedChild)
    }
    if (unwrapScriptExpression(node.callee)?.type === 'Identifier' && helpers.has(node.callee.name) && !resolving.has(node.callee.name)) return returns(helpers.get(node.callee.name).body).some(value => inspect(value, new Set(resolving).add(node.callee.name)))
    return false
  }
  for (const statement of ast.program.body) {
    if (statement.type !== 'ExportDefaultDeclaration') continue
    let options = unwrapScriptExpression(statement.declaration)
    if (['CallExpression', 'OptionalCallExpression'].includes(options?.type) && unwrapScriptExpression(options.callee)?.type === 'Identifier' && options.callee.name === 'defineComponent') options = unwrapScriptExpression(options.arguments[0])
    if (options?.type !== 'ObjectExpression') continue
    for (const property of options.properties.filter(candidate => ['setup', 'render'].includes(String(scriptPropertyName(candidate))))) {
      const fn = property.type === 'ObjectMethod' ? property : unwrapScriptExpression(property.value)
      if (returns(fn?.body).some(value => inspect(value))) return true
    }
  }
  return false
})
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
const styleRoot = source => {
  const parsed = vueCompiler.parse(source, { filename: 'route-transition-contract.vue' })
  assert.deepEqual(parsed.errors, [], `component SFC must parse cleanly: ${parsed.errors.map(String).join('; ')}`)
  const styles = parsed.descriptor.styles.map(style => style.content).join('\n')
  assert.ok(styles, 'shared route transition must contain CSS')
  return parseCssRules(styles)
}
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
const representativeScreenWidths = rules => {
  const thresholds = [...new Set(rules.flatMap(rule => rule.media.flatMap(condition => splitTopLevel(condition, ',')))
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
const selectorSpecificity = selector => {
  let score = 0
  let plain = ''
  for (let cursor = 0; cursor < selector.length;) {
    const match = /:([\w-]+)\s*\(/.exec(selector.slice(cursor))
    if (!match) { plain += selector.slice(cursor); break }
    const index = cursor + match.index
    plain += selector.slice(cursor, index)
    const open = selector.indexOf('(', index)
    const body = balancedSlice(selector, open, '(', ')')
    if (!body) { plain += selector.slice(index); break }
    const name = match[1].toLowerCase()
    if (name !== 'where') score += ['is', 'not', 'has'].includes(name) ? Math.max(0, ...splitTopLevel(body.content, ',').map(selectorSpecificity)) : 10
    cursor = body.end
  }
  score += (plain.match(/#[\w-]+/g) || []).length * 100
  score += (plain.match(/\.[\w-]+|\[[^\]]+\]|:(?!:)[\w-]+/g) || []).length * 10
  score += (plain.match(/(?:^|[\s>+~])(?:[a-z][\w-]*|\*)/gi) || []).filter(token => !token.trim().endsWith('*')).length
  return score
}
const selectorTargetsClassExactly = (selector, target) => selector.trim() === target
const applicableRules = (rules, selector, width, reduced) => rules.filter(rule => rule.selectors.some(candidate => selectorMayTarget(candidate, selector)) && mediaMatchesScreen(rule.media, width, reduced))
const reducedRuleExists = (rules, selector, width) => rules.some(rule => rule.selectors.some(candidate => selectorTargetsClassExactly(candidate, selector)) && mediaMatchesScreen(rule.media, width, true) && rule.media.some(condition => /prefers-reduced-motion\s*:\s*reduce/i.test(condition)))
const transitionTime = /^-?(?:\d+(?:\.\d+)?|\.\d+)(?:ms|s)$/i
const transitionTiming = /^(?:ease|ease-in|ease-out|ease-in-out|linear|step-start|step-end|allow-discrete|normal|cubic-bezier\(.+\)|steps\(.+\)|linear\(.+\))$/i
const parseTransitionShorthand = value => {
  if (/^none$/i.test(value)) return { 'transition-property': 'none', 'transition-duration': '0s', 'transition-delay': '0s' }
  const clauses = splitTopLevel(value, ',')
  const properties = []
  const durations = []
  const delays = []
  for (const clause of clauses) {
    const tokens = splitTopLevel(clause.replace(/\s+/g, ' ').trim(), ' ')
    const times = tokens.filter(token => transitionTime.test(token))
    const property = tokens.find(token => !transitionTime.test(token) && !transitionTiming.test(token)) || 'all'
    properties.push(property)
    durations.push(times[0] || '0s')
    delays.push(times[1] || '0s')
  }
  return { 'transition-property': properties.join(', '), 'transition-duration': durations.join(', '), 'transition-delay': delays.join(', ') }
}
const effectiveProperties = (rules, selector, width, reduced) => {
  const winners = new Map()
  const apply = (declaration, specificity) => {
    const previous = winners.get(declaration.property)
    const candidate = { ...declaration, specificity }
    if (!previous || Number(candidate.important) > Number(previous.important) || (candidate.important === previous.important && (candidate.specificity > previous.specificity || (candidate.specificity === previous.specificity && candidate.order > previous.order)))) winners.set(candidate.property, candidate)
  }
  for (const rule of applicableRules(rules, selector, width, reduced)) {
    const specificity = Math.max(...rule.selectors.filter(candidate => selectorMayTarget(candidate, selector)).map(selectorSpecificity))
    for (const declaration of rule.declarations) {
      if (declaration.property === 'transition') {
        for (const [property, value] of Object.entries(parseTransitionShorthand(declaration.value))) apply({ ...declaration, property, value }, specificity)
      } else apply(declaration, specificity)
    }
  }
  return new Map([...winners].map(([property, declaration]) => [property, declaration.value.trim()]))
}
const milliseconds = value => {
  const match = value.trim().match(/^(-?(?:\d+(?:\.\d+)?|\.\d+))(ms|s)$/i)
  return match ? Number(match[1]) * (match[2].toLowerCase() === 's' ? 1000 : 1) : Number.NaN
}
const transitionValues = (properties, name, fallback) => splitTopLevel(properties.get(name) || fallback, ',').map(value => value.trim().toLowerCase())
const ruleProperties = rule => {
  const winners = new Map()
  const apply = declaration => {
    const previous = winners.get(declaration.property)
    if (!previous || Number(declaration.important) > Number(previous.important) || (declaration.important === previous.important && declaration.order > previous.order)) winners.set(declaration.property, declaration)
  }
  for (const declaration of rule.declarations) {
    if (declaration.property === 'transition') {
      for (const [property, value] of Object.entries(parseTransitionShorthand(declaration.value))) apply({ ...declaration, property, value })
    } else apply(declaration)
  }
  return new Map([...winners].map(([property, declaration]) => [property, declaration.value.trim()]))
}
const selectorSubject = selector => {
  let start = 0
  let quote = ''
  let escaped = false
  let depth = 0
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
    else if (depth === 0 && (/\s/.test(character) || /[>+~]/.test(character))) start = index + 1
  }
  return selector.slice(start).trim()
}
const selectorSubjectAlternatives = selector => {
  const expand = subject => {
    const match = /:([\w-]+)\s*\(/g.exec(subject)
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
    return splitTopLevel(subject.slice(open + 1, cursor - 1), ',').flatMap(branch => expand(`${before}${selectorSubject(branch)}${after}`))
  }
  return expand(selectorSubject(selector))
}
const functionalPseudoArguments = (subject, name) => {
  const values = []
  for (let cursor = 0; cursor < subject.length;) {
    const match = /:([\w-]+)\s*\(/.exec(subject.slice(cursor))
    if (!match) break
    const index = cursor + match.index
    const open = subject.indexOf('(', index)
    const body = balancedSlice(subject, open, '(', ')')
    if (!body) break
    if (match[1].toLowerCase() === name) values.push(body.content)
    cursor = body.end
  }
  return values
}
const selectorMayTarget = (selector, target) => {
  const targetClass = target.startsWith('.') ? target : `.${target}`
  const matches = subject => {
    const match = /:([\w-]+)\s*\(/.exec(subject)
    if (match) {
      const open = subject.indexOf('(', match.index)
      const body = balancedSlice(subject, open, '(', ')')
      if (body) {
        const before = subject.slice(0, match.index)
        const after = subject.slice(body.end)
        const base = `${before}${after}` || '*'
        const branches = splitTopLevel(body.content, ',')
        const name = match[1].toLowerCase()
        if (['is', 'where'].includes(name)) return branches.some(branch => matches(`${before}${selectorSubject(branch)}${after}`))
        if (name === 'not') return matches(base) && branches.every(branch => !matches(selectorSubject(branch)))
        return matches(base)
      }
    }
    const classes = [...subject.matchAll(/\.[\w-]+/g)].map(value => value[0])
    const tags = [...subject.matchAll(/(?:^|[^\w.#:-])([a-z][\w-]*)/gi)].map(value => value[1])
    return (classes.length === 0 && tags.length === 0) || (classes.length > 0 && classes.every(value => value === targetClass) && tags.length === 0)
  }
  return matches(selectorSubject(selector))
}
const assertEveryPhaseOpacityOnly = (rules, name, widths) => {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const phaseClass = new RegExp(`\\.${escapedName}-(enter|leave)-(?:active|from|to)(?![\\w-])`, 'g')
  for (const rule of rules) {
    if (!widths.some(width => mediaMatchesScreen(rule.media, width, false) || mediaMatchesScreen(rule.media, width, true))) continue
    const targets = rule.selectors.flatMap(selector => selectorSubjectAlternatives(selector).flatMap(subject => [...subject.matchAll(phaseClass)].filter(match => selectorMayTarget(selector, match[0])).map(match => ({ selector, direction: match[1], phase: match[0] }))))
    if (targets.length === 0) continue
    const label = targets.map(target => target.selector).join(', ')
    const properties = ruleProperties(rule)
    for (const { selector, phase } of targets) if (properties.size > 0) assert.equal(selector.trim(), phase, `${selector} conflicts with the exact ${phase} presentation contract`)
    for (const [property, value] of properties) {
      const allowed = property === 'opacity' || property.startsWith('transition-') || (property === 'will-change' && value.trim().toLowerCase() === 'opacity')
      assert.equal(allowed, true, `${label} must not declare ${property}; route phases may declare opacity and its transition only`)
    }
    const transitionProperties = transitionValues(properties, 'transition-property', '')
    if (transitionProperties.length > 0) assert.ok(transitionProperties.every(property => property === 'opacity' || property === 'none'), `${label} transition-property must be opacity or none; found ${transitionProperties.join(', ')}`)
    const durations = transitionValues(properties, 'transition-duration', '').map(milliseconds)
    const delays = transitionValues(properties, 'transition-delay', '').map(milliseconds)
    const disabled = transitionProperties.length > 0 && transitionProperties.every(property => property === 'none')
    const reduced = rule.media.some(condition => /prefers-reduced-motion\s*:\s*reduce/i.test(condition))
    if (durations.length > 0) {
      assert.ok(durations.every(Number.isFinite), `${label} transition duration must use ms or s units`)
      if (disabled || reduced) assert.ok(durations.every(duration => Math.abs(duration) <= 1), `${label} disabled or reduced-motion transition duration must be zero or near-zero`)
      else for (const { direction } of targets) assert.deepEqual(durations, [direction === 'enter' ? 350 : 200], `${label} ${direction} transition duration must use the approved timing`)
    }
    if (delays.length > 0) assert.ok(delays.every(delay => delay === 0), `${label} transition delay must be zero or omitted`)
  }
}
const assertOpacityTransition = (rules, selector, durationMs, widths) => {
  for (const width of widths) {
    const properties = effectiveProperties(rules, selector, width, false)
    for (const [property, value] of properties) {
      const allowed = property === 'opacity' || property.startsWith('transition-') || (property === 'will-change' && value.trim().toLowerCase() === 'opacity')
      assert.equal(allowed, true, `${selector} effective rule must not declare ${property} at ${width}px`)
    }
    assert.deepEqual(transitionValues(properties, 'transition-property', 'all'), ['opacity'], `${selector} must effectively animate opacity only at ${width}px`)
    const durations = transitionValues(properties, 'transition-duration', '0s').map(milliseconds)
    assert.deepEqual(durations, [durationMs], `${selector} effective duration must be ${durationMs}ms at ${width}px`)
    const delays = transitionValues(properties, 'transition-delay', '0s').map(milliseconds)
    assert.deepEqual(delays, [0], `${selector} effective delay must be zero or omitted at ${width}px`)
    for (const [property, value] of properties) if (/^animation(?:-|$)/i.test(property)) assert.ok(/^none$|^0m?s$/i.test(value), `${selector} must not use CSS animation at ${width}px`)
  }
}
const assertImmediateReducedMotion = (rules, selector, widths) => {
  for (const width of widths) {
    assert.equal(reducedRuleExists(rules, selector, width), true, `reduced motion must target ${selector} at ${width}px`)
    const properties = effectiveProperties(rules, selector, width, true)
    const transitionProperties = transitionValues(properties, 'transition-property', 'all')
    const durations = transitionValues(properties, 'transition-duration', '0s').map(milliseconds)
    const delays = transitionValues(properties, 'transition-delay', '0s').map(milliseconds)
    assert.ok(transitionProperties.every(property => property === 'none') || durations.every(duration => Number.isFinite(duration) && Math.abs(duration) <= 1), `${selector} reduced-motion transition must remain effectively none or near-zero at ${width}px`)
    assert.ok(delays.every(delay => delay === 0), `${selector} reduced-motion delay must be zero or omitted at ${width}px`)
  }
}
const effectiveProperty = (rules, selector, property, width, reduced = false) => effectiveProperties(rules, selector, width, reduced).get(property)

test('shared route transition keys leaf views by fullPath and identity epoch', () => {
  const transition = readRequired('../components/shell/RouteTransition.vue', 'shared route transition component')
  const mainLayout = read('../layouts/MainLayout.vue')
  assert.ok(elements(transition, 'RouterView').some(node => node.props.some(prop => prop.type === 7 && prop.name === 'slot')), 'RouterView must expose its slot')
  const leaf = elements(transition, 'component').find(node => boundAttribute(node, 'is')?.trim() === 'Component')
  assert.ok(leaf, 'RouterView must render its resolved leaf component')
  const key = boundAttribute(leaf, 'key')
  assert.ok(key, 'rendered leaf component must bind :key')
  const keyExpression = parseKeyExpression(key)
  assert.equal(keyAstContains(keyExpression, isRouteFullPath), true, 'rendered leaf :key must directly include route.fullPath')
  const identityName = ['identityEpoch', 'identityKey'].find(name => keyAstContains(keyExpression, node => unwrapKeyExpression(node)?.type === 'Identifier' && unwrapKeyExpression(node).name === name))
  assert.ok(identityName, 'rendered leaf :key must directly include identityEpoch or identityKey')
  assert.equal(keyComposesRouteIdentity(keyExpression, identityName, transition), true, 'rendered leaf :key must compose route.fullPath and identity epoch through a template, array, + chain, or verified helper')
  assert.equal(declaresComponentProp(transition, identityName), true, `${identityName} must be declared as a component prop`)
  assert.equal(shadowsComponentProp(transition, identityName), false, `${identityName} must come from the declared prop rather than an unrelated binding`)
  const mainTransition = elements(mainLayout, 'RouteTransition')[0]
  assert.ok(mainTransition, 'console layout must render the shared route transition')
  const identityAttribute = identityName === 'identityKey' ? 'identity-key' : 'identity-epoch'
  assert.equal(boundAttribute(mainTransition, identityAttribute)?.replace(/\s+/g, ''), 'userStore.identityEpoch', `console layout must pass userStore.identityEpoch into ${identityName}`)
})

test('route transition is opacity-only with approved timings and immediate reduced motion', () => {
  const transition = readRequired('../components/shell/RouteTransition.vue', 'shared route transition component')
  const transitionNode = elements(transition, 'Transition')[0]
  assert.ok(transitionNode, 'shared route component must render Vue Transition')
  assert.equal(staticAttribute(transitionNode, 'mode'), 'out-in')
  const name = staticAttribute(transitionNode, 'name')
  assert.ok(name, 'Vue Transition must have a static CSS name')
  const root = styleRoot(transition)
  const widths = representativeScreenWidths(root)
  assertEveryPhaseOpacityOnly(root, name, widths)
  assertOpacityTransition(root, `.${name}-enter-active`, 350, widths)
  assertOpacityTransition(root, `.${name}-leave-active`, 200, widths)
  for (const selector of [`.${name}-enter-from`, `.${name}-leave-to`]) for (const width of widths) {
    assert.equal(effectiveProperty(root, selector, 'opacity', width), '0', `${selector} must start or end transparent at ${width}px`)
  }
  assertImmediateReducedMotion(root, `.${name}-enter-active`, widths)
  assertImmediateReducedMotion(root, `.${name}-leave-active`, widths)
})

test('public and authenticated shells reuse the shared transition component', () => {
  const publicLayout = read('../layouts/PublicLayout.vue')
  const authEntry = read('../bootstrap/AuthApp.vue')
  const mainLayout = read('../layouts/MainLayout.vue')
  for (const [source, label] of [[publicLayout, 'public child outlet'], [authEntry, 'authenticated top-level outlet'], [mainLayout, 'console content outlet']]) assert.equal(importsComponent(source, '@/components/shell/RouteTransition.vue'), true, `${label} imports the shared transition`)
  assert.equal(renderFunctionUsesComponent(publicLayout, '@/components/shell/RouteTransition.vue'), true, 'public child outlet uses the shared transition in its reachable render function')
  assert.ok(elements(authEntry, 'RouteTransition').length > 0, 'authenticated entry renders the shared transition')
  assert.ok(elements(mainLayout, 'RouteTransition').length > 0, 'console content renders the shared transition')
})

test('router preserves guarded cross-bootstrap handoff and explicit scroll behavior', async () => {
  const { createAppRouter, installBootstrapHandoff } = await import('./index.js')
  for (const [configuration, label] of [
    [{ handoff() {} }, 'missing mode'],
    [{ mode: 'public' }, 'missing handoff'],
    [{ mode: 'public', handoff: 'reload' }, 'non-function handoff'],
  ]) {
    let registrations = 0
    const guardedRouter = { beforeEach() { registrations += 1 } }
    assert.equal(installBootstrapHandoff(guardedRouter, configuration), guardedRouter, `${label} returns the router`)
    assert.equal(registrations, 0, `${label} must not install a bootstrap guard`)
  }
  let guard
  const fakeRouter = { beforeEach(value) { guard = value } }
  const handoffs = []
  assert.equal(installBootstrapHandoff(fakeRouter, { mode: 'public', handoff: path => handoffs.push(path) }), fakeRouter)
  assert.equal(guard({ meta: { public: true }, fullPath: '/pricing' }), true)
  assert.equal(guard({ meta: { public: false }, fullPath: '/chat?from=pricing' }), false)
  assert.deepEqual(handoffs, ['/chat?from=pricing'])

  const router = createAppRouter(createMemoryHistory(), {
    bootstrapMode: 'public', handoff() {},
    loadUserStore: async () => ({ ensureSession: async () => {}, isLoggedIn: false }),
  })
  const scroll = router.options.scrollBehavior
  assert.equal(typeof scroll, 'function', 'router installs scroll behavior')
  const saved = { left: 12, top: 34 }
  assert.deepEqual(await scroll({ path: '/pricing', fullPath: '/pricing', hash: '' }, { path: '/', fullPath: '/', hash: '' }, saved), saved, 'pop navigation restores saved position')
  const hash = await scroll({ path: '/', fullPath: '/#faq', hash: '#faq' }, { path: '/pricing', fullPath: '/pricing', hash: '' }, null)
  assert.equal(hash?.el, '#faq', 'hash navigation targets its anchor')
  const next = await scroll({ path: '/pricing', fullPath: '/pricing', hash: '' }, { path: '/', fullPath: '/', hash: '' }, null)
  assert.equal(next?.top, 0, 'new-route navigation starts at the top')
})
