import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'
import vuePlugin from '@vitejs/plugin-vue'
import { createMemoryHistory } from 'vue-router'

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
  const vnodeKinds = new Map()
  const vueNamespaces = new Set()
  let componentName
  const bindings = new Map()
  const helpers = new Map()
  const parents = new WeakMap()
  walkScriptAst(ast.program, (node, parent) => { if (parent) parents.set(node, parent) })
  const componentScopes = new Set()
  const optionRootScopes = new Set()
  const optionUnknown = { type: 'Identifier', name: '__unknown_component_option__' }
  const optionStaticValue = node => {
    node = unwrapScriptExpression(node)
    if (['BooleanLiteral', 'NumericLiteral', 'StringLiteral'].includes(node?.type)) return { known: true, value: node.value }
    if (node?.type === 'NullLiteral' || (node?.type === 'Identifier' && node.name === 'undefined')) return { known: true, value: undefined }
    if (node?.type === 'UnaryExpression' && node.operator === '!') { const value = optionStaticValue(node.argument); return value.known ? { known: true, value: !value.value } : value }
    return { known: false }
  }
  const optionBindings = new Map()
  const defineComponentNames = new Set()
  for (const statement of ast.program.body) if (statement.type === 'ImportDeclaration' && statement.source.value === 'vue') {
    for (const imported of statement.specifiers) if ((imported.imported?.name ?? imported.imported?.value) === 'defineComponent') defineComponentNames.add(imported.local.name)
  }
  const optionMember = (object, name) => ({ type: 'MemberExpression', object, property: { type: 'StringLiteral', value: String(name) }, computed: true })
  const missingOptionValue = { type: 'Identifier', name: 'undefined' }
  const bindOptionPattern = (pattern, value, target) => {
    pattern = unwrapScriptExpression(pattern)
    if (pattern?.type === 'Identifier') { target.set(pattern.name, [value || missingOptionValue]); return }
    if (pattern?.type === 'AssignmentPattern') { bindOptionPattern(pattern.left, value || pattern.right, target); return }
    if (pattern?.type === 'ObjectPattern') for (const property of pattern.properties) if (property.type !== 'RestElement') bindOptionPattern(property.value, optionMember(value, scriptPropertyName(property)), target)
    if (pattern?.type === 'ArrayPattern') for (let index = 0; index < pattern.elements.length; index += 1) if (pattern.elements[index]?.type !== 'RestElement') bindOptionPattern(pattern.elements[index], optionMember(value, index), target)
  }
  const mergeOptionBindings = (left, right) => {
    const merged = new Map()
    for (const name of new Set([...left.keys(), ...right.keys()])) merged.set(name, [...new Set([...(left.get(name) || []), ...(right.get(name) || [])])])
    return merged
  }
  function optionGetterPaths(getter, parentLocal) {
    const statements = (items, seed = [{ kind: 'normal', local: new Map(parentLocal) }], catches = false) => {
      let paths = seed
      for (const statement of items || []) paths = paths.flatMap(path => path.kind === 'normal' ? one(statement, path, catches) : [path])
      return paths
    }
    const one = (statement, path, catches) => {
      if (!statement) return [path]
      if (statement.type === 'BlockStatement') return statements(statement.body, [path], catches)
      if (statement.type === 'ReturnStatement') {
        const value = materializeOption(statement.argument, path.local)
        const effect = optionExpressionEffect(value, path.local)
        const result = effect === 'mustThrow' ? [] : [{ ...path, kind: 'return', value }]
        if (catches && effect !== 'cannotThrow') result.push({ ...path, kind: 'throw' })
        return result
      }
      if (statement.type === 'ThrowStatement') return [{ ...path, kind: 'throw' }]
      if (statement.type === 'BreakStatement') return [{ ...path, kind: 'break' }]
      if (statement.type === 'VariableDeclaration') {
        let paths = [path]
        for (const declaration of statement.declarations) paths = paths.flatMap(current => {
          const value = materializeOption(declaration.init, current.local)
          const effect = optionExpressionEffect(value, current.local)
          const result = []
          if (effect !== 'mustThrow') {
            const local = new Map(current.local); bindOptionPattern(declaration.id, value, local)
            result.push({ ...current, local })
          }
          if (catches && effect !== 'cannotThrow') result.push({ ...current, kind: 'throw' })
          return result
        })
        return paths
      }
      if (statement.type === 'ExpressionStatement' && statement.expression?.type === 'AssignmentExpression' && statement.expression.operator === '=') {
        const value = materializeOption(statement.expression.right, path.local)
        const effect = optionExpressionEffect(value, path.local)
        const result = []
        if (effect !== 'mustThrow') {
          const local = new Map(path.local); bindOptionPattern(statement.expression.left, value, local)
          result.push({ ...path, local })
        }
        if (catches && effect !== 'cannotThrow') result.push({ ...path, kind: 'throw' })
        return result
      }
      if (statement.type === 'IfStatement') {
        const test = materializeOption(statement.test, path.local)
        const effect = optionExpressionEffect(test, path.local)
        if (effect === 'mustThrow') return catches ? [{ ...path, kind: 'throw' }] : []
        const condition = optionStaticValue(test)
        const result = condition.known
          ? one(condition.value ? statement.consequent : statement.alternate, { ...path, local: new Map(path.local) }, catches)
          : [...one(statement.consequent, { ...path, local: new Map(path.local) }, catches), ...one(statement.alternate, { ...path, local: new Map(path.local) }, catches)]
        if (catches && effect === 'mayThrow') result.push({ ...path, kind: 'throw' })
        return result
      }
      if (statement.type === 'SwitchStatement') {
        const discriminant = materializeOption(statement.discriminant, path.local)
        const effect = optionExpressionEffect(discriminant, path.local)
        if (effect === 'mustThrow') return catches ? [{ ...path, kind: 'throw' }] : []
        const known = optionStaticValue(discriminant)
        const cases = statement.cases || []
        const defaultIndex = cases.findIndex(item => !item.test)
        const caseExpressionPaths = (expression, local) => {
          expression = unwrapScriptExpression(expression)
          if (expression?.type === 'SequenceExpression') {
            let paths = [{ kind: 'normal', local: new Map(local), value: undefined }]
            for (const item of expression.expressions) paths = paths.flatMap(candidate => candidate.kind === 'normal' ? caseExpressionPaths(item, candidate.local) : [candidate])
            return paths
          }
          if (expression?.type === 'AssignmentExpression' && ['=', '&&=', '||=', '??='].includes(expression.operator)) {
            let references = [{ kind: 'normal', local: new Map(local), receiver: 'identifier', currentValue: materializeOption(expression.left, local) }]
            if (['MemberExpression', 'OptionalMemberExpression'].includes(expression.left?.type)) {
              references = caseExpressionPaths(expression.left.object, local).flatMap(candidate => {
                if (candidate.kind !== 'normal') return [candidate]
                const value = optionStaticValue(candidate.value)
                const receiverNode = unwrapScriptExpression(candidate.value)
                const definitelyObject = ['ObjectExpression', 'ArrayExpression', 'ArrowFunctionExpression', 'FunctionExpression', 'FunctionDeclaration'].includes(receiverNode?.type)
                const primitive = value.known && value.value != null || receiverNode?.type === 'BigIntLiteral'
                  || receiverNode?.type === 'CallExpression' && receiverNode.callee?.type === 'Identifier' && receiverNode.callee.name === 'Symbol'
                return value.known && value.value == null ? [{ kind: 'throw', local: candidate.local }] : [{ ...candidate, receiverValue: candidate.value, receiver: definitelyObject ? 'object' : primitive ? 'primitive' : 'unknown' }]
              })
              if (expression.left.computed) references = references.flatMap(candidate => candidate.kind === 'normal'
                ? caseExpressionPaths(expression.left.property, candidate.local).map(propertyPath => ({ ...candidate, ...propertyPath, receiverValue: candidate.receiverValue, propertyValue: propertyPath.value, value: undefined }))
                : [candidate])
              const inheritedKeys = new Set(['constructor', 'toString', 'toLocaleString', 'valueOf', 'hasOwnProperty', 'isPrototypeOf', 'propertyIsEnumerable', '__proto__'])
              const memberValue = candidate => {
                const property = expression.left.computed ? optionStaticValue(candidate.propertyValue) : { known: true, value: expression.left.property?.name }
                if (!property.known) return materializeOption(expression.left, candidate.local)
                const key = String(property.value)
                const select = (node, resolving = new Set()) => {
                  node = unwrapScriptExpression(node)
                  if (node?.type === 'Identifier' && candidate.local.has(node.name) && !resolving.has(node.name)) {
                    const values = candidate.local.get(node.name)
                    return values.length === 1 ? select(values[0], new Set(resolving).add(node.name)) : undefined
                  }
                  if (node?.type === 'ArrayExpression' && /^\d+$/.test(key)) return node.elements[Number(key)] ?? missingOptionValue
                  if (node?.type === 'ArrayExpression' && key === 'length') return { type: 'NumericLiteral', value: node.elements.length }
                  if (node?.type === 'ArrayExpression' && inheritedKeys.has(key)) return { type: 'BooleanLiteral', value: true }
                  if (node?.type === 'ObjectExpression') {
                    let selected = missingOptionValue
                    for (const item of node.properties) {
                      if (item.type === 'SpreadElement') {
                        const spread = select(item.argument, resolving)
                        if (spread === undefined) selected = undefined
                        else if (spread !== missingOptionValue) selected = spread
                      } else {
                        const itemKey = item.computed ? optionStaticValue(materializeOption(item.key, candidate.local)) : { known: true, value: scriptPropertyName(item) }
                        if (!itemKey.known) selected = undefined
                        else if (String(itemKey.value) === key) selected = item.type === 'ObjectMethod' ? item : item.value
                      }
                    }
                    return selected === missingOptionValue && inheritedKeys.has(key) ? { type: 'BooleanLiteral', value: true } : selected
                  }
                  const primitive = optionStaticValue(node)
                  if (primitive.known && primitive.value != null) {
                    if (typeof primitive.value === 'string' && key === 'length') return { type: 'NumericLiteral', value: primitive.value.length }
                    if (typeof primitive.value === 'string' && /^\d+$/.test(key)) return Number(key) < primitive.value.length ? { type: 'StringLiteral', value: primitive.value[Number(key)] } : missingOptionValue
                    return inheritedKeys.has(key) ? { type: 'BooleanLiteral', value: true } : missingOptionValue
                  }
                  return undefined
                }
                const selected = select(expression.left.object)
                if (selected !== undefined) return selected
                return candidate.receiver === 'primitive'
                  ? inheritedKeys.has(key) ? { type: 'BooleanLiteral', value: true } : missingOptionValue
                  : materializeOption(expression.left, candidate.local)
              }
              references = references.flatMap(candidate => {
                if (candidate.kind !== 'normal') return [candidate]
                const value = memberValue(candidate)
                if (value?.type !== 'ObjectMethod' || value.kind !== 'get') return [{ ...candidate, currentValue: value }]
                const localNames = new Set()
                const collectPattern = pattern => {
                  pattern = unwrapScriptExpression(pattern)
                  if (pattern?.type === 'Identifier') localNames.add(pattern.name)
                  else if (pattern?.type === 'AssignmentPattern') collectPattern(pattern.left)
                  else if (pattern?.type === 'RestElement') collectPattern(pattern.argument)
                  else if (pattern?.type === 'ObjectPattern') for (const property of pattern.properties) collectPattern(property.type === 'RestElement' ? property.argument : property.value)
                  else if (pattern?.type === 'ArrayPattern') for (const item of pattern.elements) collectPattern(item)
                }
                const collectLocals = node => {
                  if (!node || typeof node !== 'object') return
                  if (node !== value && ['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression', 'ObjectMethod'].includes(node.type)) { if (node.type === 'FunctionDeclaration') collectPattern(node.id); return }
                  if (node.type === 'VariableDeclarator') collectPattern(node.id)
                  if (node.type === 'ClassDeclaration') collectPattern(node.id)
                  if (node.type === 'CatchClause') collectPattern(node.param)
                  for (const [name, child] of Object.entries(node)) if (!['loc', 'start', 'end', 'extra'].includes(name)) {
                    if (Array.isArray(child)) for (const item of child) collectLocals(item)
                    else collectLocals(child)
                  }
                }
                collectLocals(value.body)
                const mergeOuter = getterLocal => {
                  const merged = new Map(candidate.local)
                  for (const name of candidate.local.keys()) if (!localNames.has(name) && getterLocal.has(name)) merged.set(name, getterLocal.get(name))
                  return merged
                }
                return optionGetterPaths(value, candidate.local).map(path => {
                  const local = mergeOuter(path.local)
                  if (path.kind === 'throw') return { kind: 'throw', local }
                  return { ...candidate, local, currentValue: path.kind === 'return' ? path.value : missingOptionValue }
                })
              })
            }
            const write = reference => caseExpressionPaths(expression.right, reference.local).flatMap(candidate => {
              if (candidate.kind !== 'normal') return [candidate]
              const next = new Map(candidate.local)
              bindOptionPattern(expression.left, candidate.value, next)
              const success = { ...candidate, local: next }
              if (['nullish', 'primitive'].includes(reference.receiver)) return [{ kind: 'throw', local: next }]
              return reference.receiver === 'unknown' && catches ? [success, { kind: 'throw', local: new Map(next) }] : [success]
            })
            return references.flatMap(reference => {
              if (reference.kind !== 'normal') return [reference]
              if (expression.operator === '=') return write(reference)
              let current = optionStaticValue(reference.currentValue)
              if (!current.known && ['ObjectExpression', 'ArrayExpression', 'ArrowFunctionExpression', 'FunctionExpression', 'FunctionDeclaration'].includes(unwrapScriptExpression(reference.currentValue)?.type)) current = { known: true, value: true }
              const writes = current.known && (expression.operator === '&&=' ? Boolean(current.value) : expression.operator === '||=' ? !current.value : current.value == null)
              if (current.known) return writes ? write(reference) : [{ ...reference, value: reference.currentValue }]
              return [{ ...reference, value: reference.currentValue }, ...write({ ...reference, local: new Map(reference.local) })]
            })
          }
          if (expression?.type === 'ConditionalExpression') return caseExpressionPaths(expression.test, local).flatMap(candidate => {
            if (candidate.kind !== 'normal') return [candidate]
            const condition = optionStaticValue(candidate.value)
            return condition.known
              ? caseExpressionPaths(condition.value ? expression.consequent : expression.alternate, candidate.local)
              : [...caseExpressionPaths(expression.consequent, candidate.local), ...caseExpressionPaths(expression.alternate, candidate.local)]
          })
          if (expression?.type === 'LogicalExpression') return caseExpressionPaths(expression.left, local).flatMap(candidate => {
            if (candidate.kind !== 'normal') return [candidate]
            const left = optionStaticValue(candidate.value)
            const shortCircuits = left.known && (expression.operator === '&&' ? !left.value : expression.operator === '||' ? Boolean(left.value) : left.value != null)
            if (left.known) return shortCircuits ? [candidate] : caseExpressionPaths(expression.right, candidate.local)
            return [candidate, ...caseExpressionPaths(expression.right, new Map(candidate.local))]
          })
          const value = materializeOption(expression, local)
          const testEffect = optionExpressionEffect(value, local)
          const outcomes = catches && testEffect !== 'cannotThrow' ? [{ kind: 'throw', local: new Map(local) }] : []
          if (testEffect !== 'mustThrow') outcomes.unshift({ kind: 'normal', value, local: new Map(local) })
          return outcomes
        }
        let searches = [{ kind: 'search', local: new Map(path.local) }]
        for (let index = 0; index < cases.length; index += 1) {
          if (!cases[index].test) continue
          searches = searches.flatMap(search => {
            if (search.kind !== 'search') return [search]
            return caseExpressionPaths(cases[index].test, search.local).flatMap(testPath => {
              if (testPath.kind === 'throw') return [{ kind: 'throw', local: testPath.local }]
              const candidate = optionStaticValue(testPath.value)
              if (known.known && candidate.known) return [{ kind: candidate.value === known.value ? 'entry' : 'search', index, local: testPath.local }]
              return [{ kind: 'entry', index, local: testPath.local }, { kind: 'search', local: new Map(testPath.local) }]
            })
          })
        }
        const entries = searches.map(search => search.kind === 'search' ? { ...search, kind: 'entry', index: defaultIndex } : search)
        const result = entries.flatMap(entry => {
          if (entry.kind === 'throw') return [{ ...path, kind: 'throw', local: entry.local }]
          const index = entry.index
          if (index < 0) return [{ ...path, local: entry.local }]
          let branches = [{ ...path, local: entry.local }]
          for (let caseIndex = index; caseIndex < cases.length; caseIndex += 1) branches = statements(cases[caseIndex].consequent, branches, catches)
          return branches.map(branch => branch.kind === 'break' ? { ...branch, kind: 'normal' } : branch)
        })
        if (catches && effect === 'mayThrow') result.push({ ...path, kind: 'throw' })
        return result
      }
      if (statement.type === 'TryStatement') {
        let result = one(statement.block, { ...path, local: new Map(path.local) }, true).flatMap(candidate => candidate.kind === 'throw' && statement.handler
          ? one(statement.handler.body, { ...candidate, kind: 'normal', local: new Map(candidate.local) }, false)
          : [candidate])
        if (statement.finalizer) result = result.flatMap(candidate => one(statement.finalizer, { ...candidate, kind: 'normal', local: new Map(candidate.local) }, true).map(finalPath => finalPath.kind === 'normal' ? { ...candidate, local: finalPath.local } : finalPath))
        return result
      }
      const effect = optionExpressionEffect(materializeOption(statement.expression, path.local), path.local)
      const result = effect === 'mustThrow' ? [] : [path]
      if (catches && effect !== 'cannotThrow') result.push({ ...path, kind: 'throw' })
      return result
    }
    return statements(getter.body?.body || [], undefined, true)
  }
  const optionAccessValues = (value, local) => {
    if (value?.type !== 'ObjectMethod' || value.kind !== 'get') return [value]
    const paths = optionGetterPaths(value, local)
    const values = paths.filter(path => path.kind === 'return').map(path => path.value)
    return paths.some(path => path.kind !== 'return') || !values.length ? values.concat(optionUnknown) : values
  }
  const optionCandidates = (expression, local, resolving = new Set()) => {
    expression = unwrapScriptExpression(expression)
    if (!expression || resolving.size > 32) return []
    if (expression.type === 'Identifier' && local.has(expression.name) && !resolving.has(expression.name)) return local.get(expression.name).flatMap(value => optionCandidates(value, local, new Set(resolving).add(expression.name)))
    if (['MemberExpression', 'OptionalMemberExpression'].includes(expression.type)) {
      const name = expression.computed ? unwrapScriptExpression(expression.property)?.value : expression.property?.name
      return effectiveOptionStates(expression.object, local, resolving).flatMap(state => state.map.has(String(name)) ? optionAccessValues(state.map.get(String(name)), local).flatMap(value => optionCandidates(value, local, resolving)) : [])
    }
    if (expression.type === 'ConditionalExpression') {
      const condition = optionStaticValue(expression.test)
      return condition.known ? optionCandidates(condition.value ? expression.consequent : expression.alternate, local, resolving) : [...optionCandidates(expression.consequent, local, resolving), ...optionCandidates(expression.alternate, local, resolving)]
    }
    return [expression]
  }
  const optionFunctions = (expression, local, resolving = new Set()) => optionCandidates(expression, local, resolving).filter(value => ['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'].includes(value?.type))
  const materializeOption = (node, local, resolving = new Set(), parent, key) => {
    node = unwrapScriptExpression(node)
    if (!node || typeof node !== 'object') return node
    if (node.type === 'Identifier' && local.has(node.name) && !resolving.has(node.name)) {
      const staticKey = parent?.type === 'MemberExpression' && key === 'property' && !parent.computed
        || ['ObjectProperty', 'ObjectMethod'].includes(parent?.type) && key === 'key' && !parent.computed
        || parent?.type === 'AssignmentExpression' && key === 'left'
      const values = local.get(node.name)
      if (!staticKey && values.length === 1) return materializeOption(values[0], local, new Set(resolving).add(node.name))
    }
    let scopedLocal = local
    if (['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression', 'ObjectMethod'].includes(node.type)) {
      scopedLocal = new Map(local)
      const remove = pattern => {
        pattern = unwrapScriptExpression(pattern)
        if (pattern?.type === 'Identifier') scopedLocal.delete(pattern.name)
        else if (pattern?.type === 'AssignmentPattern') remove(pattern.left)
        else if (pattern?.type === 'RestElement') remove(pattern.argument)
        else if (pattern?.type === 'ObjectPattern') for (const property of pattern.properties) remove(property.type === 'RestElement' ? property.argument : property.value)
        else if (pattern?.type === 'ArrayPattern') for (const item of pattern.elements) remove(item)
      }
      for (const parameter of node.params || []) remove(parameter)
      if (node.id) remove(node.id)
    }
    let changed = false
    const copy = {}
    for (const [childKey, child] of Object.entries(node)) {
      copy[childKey] = ['loc', 'start', 'end', 'extra'].includes(childKey) ? child : Array.isArray(child) ? child.map(item => materializeOption(item, scopedLocal, resolving, node, childKey)) : materializeOption(child, scopedLocal, resolving, node, childKey)
      if (copy[childKey] !== child) changed = true
    }
    return changed ? copy : node
  }
  const factoryOptionReturns = (fn, args, parentLocal) => {
    const local = new Map(parentLocal)
    for (let index = 0; index < (fn.params || []).length; index += 1) bindOptionPattern(fn.params[index], args[index], local)
    if (fn.body?.type !== 'BlockStatement') return [{ value: materializeOption(fn.body, local), local }]
    const results = []
    for (const statement of fn.body.body) {
      if (statement.type === 'VariableDeclaration') {
        for (const declaration of statement.declarations) {
          if (!declaration.init || ['CallExpression', 'OptionalCallExpression', 'NewExpression', 'AwaitExpression'].includes(unwrapScriptExpression(declaration.init)?.type)) return []
          bindOptionPattern(declaration.id, declaration.init, local)
        }
      } else if (statement.type === 'FunctionDeclaration' && statement.id) local.set(statement.id.name, [statement])
      else if (statement.type === 'ReturnStatement' && statement.argument) results.push({ value: materializeOption(statement.argument, local), local: new Map(local) })
      else if (statement.type !== 'EmptyStatement') return []
    }
    return results
  }
  const effectiveOptionStates = (expression, local, resolving = new Set()) => {
    expression = unwrapScriptExpression(expression)
    if (!expression || resolving.size > 32) return [{ map: new Map(), unknown: true }]
    if (expression.type === 'Identifier') {
      if (!local.has(expression.name) || resolving.has(expression.name)) return [{ map: new Map(), unknown: true }]
      return local.get(expression.name).flatMap(value => effectiveOptionStates(value, local, new Set(resolving).add(expression.name)))
    }
    if (['CallExpression', 'OptionalCallExpression'].includes(expression.type) && optionCandidates(expression.callee, local, resolving).some(candidate => candidate?.type === 'Identifier' && defineComponentNames.has(candidate.name))) return effectiveOptionStates(expression.arguments[0], local, resolving)
    if (['CallExpression', 'OptionalCallExpression'].includes(expression.type)) {
      const functions = optionFunctions(expression.callee, local, resolving)
      if (!functions.length) return [{ map: new Map(), unknown: true }]
      const states = functions.flatMap(fn => factoryOptionReturns(fn, expression.arguments, local).flatMap(result => effectiveOptionStates(result.value, result.local, new Set(resolving).add(fn.id?.name || '__options_factory__'))))
      return states.length ? states : [{ map: new Map(), unknown: true }]
    }
    if (expression.type === 'ConditionalExpression') {
      const condition = optionStaticValue(expression.test)
      return condition.known
        ? effectiveOptionStates(condition.value ? expression.consequent : expression.alternate, local, resolving)
        : [...effectiveOptionStates(expression.consequent, local, resolving), ...effectiveOptionStates(expression.alternate, local, resolving)]
    }
    if (expression.type === 'SequenceExpression') return effectiveOptionStates(expression.expressions.at(-1), local, resolving)
    if (['MemberExpression', 'OptionalMemberExpression'].includes(expression.type)) {
      const name = expression.computed ? unwrapScriptExpression(expression.property)?.value : expression.property?.name
      const objects = effectiveOptionStates(expression.object, local, resolving)
      const values = objects.flatMap(state => state.map.has(String(name)) ? optionAccessValues(state.map.get(String(name)), local) : [])
      return values.length ? values.flatMap(value => value === optionUnknown ? [{ map: new Map(), unknown: true }] : effectiveOptionStates(value, local, resolving)) : [{ map: new Map(), unknown: true }]
    }
    if (expression.type !== 'ObjectExpression') return [{ map: new Map(), unknown: true }]
    let states = [{ map: new Map(), unknown: false }]
    for (const property of expression.properties) {
      if (property.type !== 'SpreadElement') {
        for (const state of states) state.map.set(String(scriptPropertyName(property)), property.type === 'ObjectMethod' ? property : property.value)
        continue
      }
      const spreads = effectiveOptionStates(property.argument, local, resolving)
      states = states.flatMap(state => spreads.map(spread => {
        const map = new Map(state.map)
        if (spread.unknown) for (const key of map.keys()) map.set(key, optionUnknown)
        for (const [key, value] of spread.map) map.set(key, value)
        return { map, unknown: state.unknown || spread.unknown }
      }))
    }
    return states
  }
  const exportedOptionStates = []
  const optionNullish = (expression, local, resolving = new Set(), chain = false) => {
    expression = unwrapScriptExpression(expression)
    if (expression?.type === 'ChainExpression') return optionNullish(expression.expression, local, resolving, true)
    if (!expression) return 'unknown'
    if (expression.type === 'NullLiteral' || expression.type === 'Identifier' && expression.name === 'undefined' || expression.type === 'UnaryExpression' && expression.operator === 'void') return 'nullish'
    if (['StringLiteral', 'NumericLiteral', 'BooleanLiteral', 'BigIntLiteral', 'ObjectExpression', 'ArrayExpression', 'ArrowFunctionExpression', 'FunctionExpression', 'FunctionDeclaration', 'ObjectMethod'].includes(expression.type)) return 'nonnull'
    if (expression.type === 'Identifier') {
      if (!local.has(expression.name) || resolving.has(expression.name)) return 'unknown'
      const candidates = optionCandidates(expression, local, resolving)
      const values = candidates.map(value => optionNullish(value, local, new Set(resolving).add(expression.name), chain))
      return values.length && values.every(value => value === values[0]) ? values[0] : 'unknown'
    }
    if (['MemberExpression', 'OptionalMemberExpression'].includes(expression.type)) {
      const receiver = optionNullish(expression.object, local, resolving, chain || expression.type === 'OptionalMemberExpression')
      if (receiver === 'short-circuit') return chain || expression.type === 'OptionalMemberExpression' ? 'short-circuit' : 'unknown'
      if (receiver === 'nullish') return expression.optional ? 'short-circuit' : 'unknown'
      if (receiver !== 'nonnull') return 'unknown'
      const name = expression.computed ? unwrapScriptExpression(expression.property)?.value : expression.property?.name
      const objects = effectiveOptionStates(expression.object, local, resolving)
      const values = objects.flatMap(state => state.map.has(String(name)) ? [state.map.get(String(name))] : [])
      return values.length ? optionNullish(values[0], local, resolving) : 'nullish'
    }
    if (expression.type === 'OptionalCallExpression') {
      const callee = optionNullish(expression.callee, local, resolving, chain)
      if (callee === 'short-circuit' || expression.optional && callee === 'nullish') return 'short-circuit'
    }
    return 'unknown'
  }
  const sequenceOptionEffects = effects => effects.includes('mustThrow') ? 'mustThrow' : effects.includes('mayThrow') ? 'mayThrow' : 'cannotThrow'
  const alternativeOptionEffects = effects => effects.every(effect => effect === 'mustThrow') ? 'mustThrow' : effects.every(effect => effect === 'cannotThrow') ? 'cannotThrow' : 'mayThrow'
  const optionSpreadOperationKind = (expression, local, resolving, iterable) => {
    const classify = candidate => {
      candidate = unwrapScriptExpression(candidate)
      if (!candidate) return 'mayThrow'
      if (iterable) {
        if (candidate.type === 'ArrayExpression' || candidate.type === 'StringLiteral' || candidate.type === 'TemplateLiteral') return 'cannotThrow'
        if (['ObjectExpression', 'NullLiteral', 'NumericLiteral', 'BooleanLiteral', 'BigIntLiteral', 'ArrowFunctionExpression', 'FunctionExpression', 'FunctionDeclaration'].includes(candidate.type) || candidate.type === 'Identifier' && candidate.name === 'undefined') return 'mustThrow'
        return 'mayThrow'
      }
      if (candidate.type === 'NullLiteral' || candidate.type === 'Identifier' && candidate.name === 'undefined') return 'cannotThrow'
      if (candidate.type !== 'ObjectExpression') return ['StringLiteral', 'TemplateLiteral', 'NumericLiteral', 'BooleanLiteral', 'BigIntLiteral', 'ArrayExpression'].includes(candidate.type) ? 'cannotThrow' : 'mayThrow'
      return sequenceOptionEffects(candidate.properties.filter(property => property.type === 'ObjectMethod' && property.kind === 'get').map(property => callableBodyEffect(property.body, value => optionExpressionEffect(value, local, resolving), optionStaticValue)))
    }
    const candidates = optionCandidates(expression, local, resolving)
    return candidates.length ? alternativeOptionEffects(candidates.map(classify)) : 'mayThrow'
  }
  const optionSpreadEffect = (expression, local, resolving, iterable) => sequenceOptionEffects([optionExpressionEffect(expression, local, resolving), optionSpreadOperationKind(expression, local, resolving, iterable)])
  const optionExpressionEffect = (expression, local, resolving = new Set(), chain = false) => {
    expression = unwrapScriptExpression(expression)
    if (!expression) return 'cannotThrow'
    if (expression.type === 'ChainExpression') return optionExpressionEffect(expression.expression, local, resolving, true)
    if (['StringLiteral', 'NumericLiteral', 'BooleanLiteral', 'NullLiteral', 'BigIntLiteral', 'ArrowFunctionExpression', 'FunctionExpression', 'FunctionDeclaration', 'ObjectMethod'].includes(expression.type)) return 'cannotThrow'
    if (expression.type === 'Identifier') {
      if (!local.has(expression.name) || resolving.has(expression.name)) return 'cannotThrow'
      const effects = local.get(expression.name).map(value => optionExpressionEffect(value, local, new Set(resolving).add(expression.name)))
      return effects.length ? alternativeOptionEffects(effects) : 'cannotThrow'
    }
    if (expression.type === 'ObjectExpression') return sequenceOptionEffects(expression.properties.flatMap(property => property.type === 'SpreadElement'
      ? [optionSpreadEffect(property.argument, local, resolving, false)]
      : [property.computed ? optionExpressionEffect(property.key, local, resolving) : 'cannotThrow', property.type === 'ObjectMethod' ? 'cannotThrow' : optionExpressionEffect(property.value, local, resolving)]))
    if (expression.type === 'ArrayExpression') return sequenceOptionEffects(expression.elements.filter(Boolean).map(element => element.type === 'SpreadElement' ? optionSpreadEffect(element.argument, local, resolving, true) : optionExpressionEffect(element, local, resolving)))
    if (expression.type === 'ConditionalExpression') {
      const testEffect = optionExpressionEffect(expression.test, local, resolving)
      if (testEffect === 'mustThrow') return testEffect
      const condition = optionStaticValue(expression.test)
      const branchEffect = condition.known
        ? optionExpressionEffect(condition.value ? expression.consequent : expression.alternate, local, resolving)
        : alternativeOptionEffects([optionExpressionEffect(expression.consequent, local, resolving), optionExpressionEffect(expression.alternate, local, resolving)])
      return sequenceOptionEffects([testEffect, branchEffect])
    }
    if (expression.type === 'LogicalExpression') {
      const leftEffect = optionExpressionEffect(expression.left, local, resolving)
      if (leftEffect === 'mustThrow') return leftEffect
      const left = optionStaticValue(expression.left)
      if (left.known) {
        const usesRight = expression.operator === '&&' ? Boolean(left.value) : expression.operator === '||' ? !left.value : left.value == null
        return sequenceOptionEffects([leftEffect, usesRight ? optionExpressionEffect(expression.right, local, resolving) : 'cannotThrow'])
      }
      return sequenceOptionEffects([leftEffect, alternativeOptionEffects(['cannotThrow', optionExpressionEffect(expression.right, local, resolving)])])
    }
    if (['MemberExpression', 'OptionalMemberExpression'].includes(expression.type)) {
      const receiverEffect = sequenceOptionEffects([optionExpressionEffect(expression.object, local, resolving, chain || expression.type === 'OptionalMemberExpression'), expression.computed ? optionExpressionEffect(expression.property, local, resolving) : 'cannotThrow'])
      if (receiverEffect === 'mustThrow') return 'mustThrow'
      const receiver = optionNullish(expression.object, local, resolving, chain || expression.type === 'OptionalMemberExpression')
      if (receiver === 'short-circuit') return chain || expression.type === 'OptionalMemberExpression' ? receiverEffect : 'mustThrow'
      if (receiver === 'nullish') return expression.optional ? receiverEffect : receiverEffect === 'cannotThrow' ? 'mustThrow' : 'mayThrow'
      if (receiver === 'unknown') return 'mayThrow'
      const name = expression.computed ? unwrapScriptExpression(expression.property)?.value : expression.property?.name
      const accessEffects = effectiveOptionStates(expression.object, local, resolving).flatMap(state => state.map.has(String(name)) ? [state.map.get(String(name))] : []).map(value => value?.type === 'ObjectMethod' && value.kind === 'get'
        ? callableBodyEffect(value.body, item => optionExpressionEffect(item, local, resolving), optionStaticValue)
        : 'cannotThrow')
      return sequenceOptionEffects([receiverEffect, accessEffects.length ? alternativeOptionEffects(accessEffects) : 'cannotThrow'])
    }
    if (['CallExpression', 'OptionalCallExpression'].includes(expression.type)) {
      const calleeEffect = sequenceOptionEffects([optionExpressionEffect(expression.callee, local, resolving, chain || expression.type === 'OptionalCallExpression'), ...expression.arguments.map(argument => argument.type === 'SpreadElement' ? optionSpreadEffect(argument.argument, local, resolving, true) : optionExpressionEffect(argument, local, resolving))])
      if (calleeEffect === 'mustThrow') return 'mustThrow'
      const calleeNullish = optionNullish(expression.callee, local, resolving, chain || expression.type === 'OptionalCallExpression')
      if (((chain || expression.type === 'OptionalCallExpression') && calleeNullish === 'short-circuit') || (expression.optional && calleeNullish === 'nullish')) return calleeEffect
      const functions = optionFunctions(expression.callee, local, resolving)
      const invocation = optionCandidates(expression.callee, local, resolving).some(candidate => candidate?.type === 'Identifier' && defineComponentNames.has(candidate.name))
        ? 'cannotThrow'
        : functions.length
          ? alternativeOptionEffects(functions.map(fn => resolving.has(fn) ? 'mayThrow' : callableBodyEffect(fn.body, value => optionExpressionEffect(value, local, new Set(resolving).add(fn)), optionStaticValue)))
          : 'mayThrow'
      return sequenceOptionEffects([calleeEffect, invocation])
    }
    if (expression.type === 'SequenceExpression') {
      return sequenceOptionEffects(expression.expressions.map(item => optionExpressionEffect(item, local, resolving)))
    }
    if (expression.type === 'AssignmentExpression') return sequenceOptionEffects([
      ['MemberExpression', 'OptionalMemberExpression'].includes(unwrapScriptExpression(expression.left)?.type) ? optionExpressionEffect(expression.left, local, resolving) : 'cannotThrow',
      optionExpressionEffect(expression.right, local, resolving),
    ])
    if (expression.type === 'TemplateLiteral') return sequenceOptionEffects(expression.expressions.map(item => optionExpressionEffect(item, local, resolving)))
    if (expression.type === 'UnaryExpression' || expression.type === 'UpdateExpression' || expression.type === 'AwaitExpression') return optionExpressionEffect(expression.argument, local, resolving)
    if (expression.type === 'BinaryExpression') return sequenceOptionEffects([optionExpressionEffect(expression.left, local, resolving), optionExpressionEffect(expression.right, local, resolving)])
    return 'mayThrow'
  }
  const flowOptionStatements = (statements, initial, catches = false) => {
    let paths = [{ kind: 'normal', bindings: new Map(initial) }]
    const flowOne = (statement, bindings, catchesHere) => {
      if (!statement) return [{ kind: 'normal', bindings }]
      if (statement.type === 'BlockStatement') return flowOptionStatements(statement.body, bindings, catchesHere)
      if (statement.type === 'ThrowStatement') return [{ kind: 'throw', bindings }]
      if (statement.type === 'VariableDeclaration') {
        const next = new Map(bindings)
        let effect = 'cannotThrow'
        for (const declaration of statement.declarations) {
          const current = optionExpressionEffect(declaration.init, next)
          if (current === 'mustThrow') effect = 'mustThrow'
          else if (current === 'mayThrow' && effect === 'cannotThrow') effect = 'mayThrow'
          if (current !== 'mustThrow') bindOptionPattern(declaration.id, declaration.init, next)
        }
        const result = effect === 'mustThrow' ? [] : [{ kind: 'normal', bindings: next }]
        if (catchesHere && effect !== 'cannotThrow') result.push({ kind: 'throw', bindings })
        return result
      }
      if (statement.type === 'ExpressionStatement' && statement.expression?.type === 'AssignmentExpression' && statement.expression.operator === '=') {
        const effect = optionExpressionEffect(statement.expression, bindings)
        const result = []
        if (effect !== 'mustThrow') {
          const next = new Map(bindings)
          bindOptionPattern(statement.expression.left, statement.expression.right, next)
          result.push({ kind: 'normal', bindings: next })
        }
        if (catchesHere && effect !== 'cannotThrow') result.push({ kind: 'throw', bindings })
        return result
      }
      if (statement.type === 'IfStatement') {
        const testEffect = optionExpressionEffect(statement.test, bindings)
        if (testEffect === 'mustThrow') return catchesHere ? [{ kind: 'throw', bindings }] : []
        const condition = optionStaticValue(statement.test)
        const results = condition.known
          ? flowOne(condition.value ? statement.consequent : statement.alternate, new Map(bindings), catchesHere)
          : [...flowOne(statement.consequent, new Map(bindings), catchesHere), ...flowOne(statement.alternate, new Map(bindings), catchesHere)]
        if (catchesHere && testEffect === 'mayThrow') results.push({ kind: 'throw', bindings })
        return results
      }
      if (statement.type === 'TryStatement') {
        let results = flowOne(statement.block, bindings, true).flatMap(path => path.kind === 'throw' && statement.handler
          ? flowOne(statement.handler.body, new Map(path.bindings), false)
          : [path])
        if (statement.finalizer) results = results.flatMap(path => flowOne(statement.finalizer, new Map(path.bindings), true).map(finalPath => finalPath.kind === 'normal' ? { ...path, bindings: finalPath.bindings } : finalPath))
        return results
      }
      const effect = optionExpressionEffect(statement.expression, bindings)
      const result = effect === 'mustThrow' ? [] : [{ kind: 'normal', bindings }]
      if (catchesHere && effect !== 'cannotThrow') result.push({ kind: 'throw', bindings })
      return result
    }
    for (const statement of statements || []) paths = paths.flatMap(path => path.kind === 'normal' ? flowOne(statement, path.bindings, catches) : [path])
    return paths
  }
  const processOptionStatements = (statements, target) => {
    for (const raw of statements || []) {
      const statement = raw?.type === 'ExportNamedDeclaration' ? raw.declaration : raw
      if (statement?.type === 'FunctionDeclaration' && statement.id) target.set(statement.id.name, [statement])
    }
    for (const raw of statements || []) {
      const statement = raw?.type === 'ExportNamedDeclaration' ? raw.declaration : raw
      if (!statement) continue
      if (statement.type === 'FunctionDeclaration' && statement.id) target.set(statement.id.name, [statement])
      else if (statement.type === 'VariableDeclaration') {
        for (const declaration of statement.declarations) {
          if (optionExpressionEffect(declaration.init, target) === 'mustThrow') return false
          bindOptionPattern(declaration.id, declaration.init, target)
        }
      }
      else if (statement.type === 'ExpressionStatement' && statement.expression?.type === 'AssignmentExpression' && statement.expression.operator === '=') {
        if (optionExpressionEffect(statement.expression, target) === 'mustThrow') return false
        bindOptionPattern(statement.expression.left, statement.expression.right, target)
      }
      else if (statement.type === 'ExpressionStatement' && optionExpressionEffect(statement.expression, target) === 'mustThrow') return false
      else if (statement.type === 'ThrowStatement') return false
      else if (statement.type === 'ExportDefaultDeclaration') {
        const effect = optionExpressionEffect(statement.declaration, target)
        if (effect === 'mustThrow') return false
        exportedOptionStates.push(...effectiveOptionStates(statement.declaration, target))
        if (effect === 'mayThrow') exportedOptionStates.push({ map: new Map(), unknown: true })
      }
      else if (statement.type === 'BlockStatement') { if (!processOptionStatements(statement.body, target)) return false }
      else if (statement.type === 'TryStatement') {
        const paths = flowOptionStatements([statement], target).filter(path => path.kind === 'normal')
        if (!paths.length) return false
        const merged = paths.map(path => path.bindings).reduce((left, right) => mergeOptionBindings(left, right))
        target.clear(); for (const [name, values] of merged) target.set(name, values)
      }
      else if (statement.type === 'IfStatement') {
        if (optionExpressionEffect(statement.test, target) === 'mustThrow') return false
        const condition = optionStaticValue(statement.test)
        if (condition.known) {
          const branch = condition.value ? statement.consequent : statement.alternate
          if (!processOptionStatements(branch?.type === 'BlockStatement' ? branch.body : [branch], target)) return false
        } else {
          const left = new Map(target); const right = new Map(target)
          const leftAlive = processOptionStatements(statement.consequent?.type === 'BlockStatement' ? statement.consequent.body : [statement.consequent], left)
          const rightAlive = processOptionStatements(statement.alternate?.type === 'BlockStatement' ? statement.alternate.body : [statement.alternate], right)
          if (!leftAlive && !rightAlive) return false
          const merged = leftAlive && rightAlive ? mergeOptionBindings(left, right) : leftAlive ? left : right
          target.clear(); for (const [name, values] of merged) target.set(name, values)
        }
      }
    }
    return true
  }
  processOptionStatements(ast.program.body, optionBindings)
  for (const statement of ast.program.body) {
    if (statement.type === 'ImportDeclaration') for (const imported of statement.specifiers) {
      if (statement.source.value === 'vue' && imported.type === 'ImportNamespaceSpecifier') vueNamespaces.add(imported.local.name)
      const name = imported.imported?.name ?? imported.imported?.value
      if (statement.source.value === 'vue' && ['h', 'createVNode'].includes(name)) renderNames.add(imported.local.name)
      if (statement.source.value === 'vue' && ['Comment', 'Text', 'Static', 'Fragment'].includes(name)) vnodeKinds.set(imported.local.name, ['Comment', 'Text', 'Static'].includes(name) ? name.toLowerCase() : 'fragment')
      if (statement.source.value === 'vue' && ['KeepAlive', 'Suspense', 'Teleport'].includes(name)) vnodeKinds.set(imported.local.name, 'component')
      if (statement.source.value === specifier) { componentName = imported.local.name; vnodeKinds.set(imported.local.name, 'component') }
      else if (/\.vue(?:\?|$)/.test(statement.source.value)) vnodeKinds.set(imported.local.name, 'component')
    }
  }
  const functionBindings = new Map()
  walkScriptAst(ast.program, node => {
    if (node.type === 'FunctionDeclaration' && node.id) functionBindings.set(node.id.name, node)
    if (node.type === 'VariableDeclarator' && node.id?.type === 'Identifier' && ['ArrowFunctionExpression', 'FunctionExpression'].includes(unwrapScriptExpression(node.init)?.type)) functionBindings.set(node.id.name, unwrapScriptExpression(node.init))
  })
  const addOptionScope = (value, resolving = new Set(), scopes = componentScopes, roots = optionRootScopes) => {
    value = unwrapScriptExpression(value)
    if (!value || value === optionUnknown || resolving.size > 32) return
    if (value.type === 'Identifier') {
      if (resolving.has(value.name)) return
      if (functionBindings.has(value.name)) { scopes.add(functionBindings.get(value.name)); roots.add(functionBindings.get(value.name)) }
      else for (const candidate of optionBindings.get(value.name) || []) addOptionScope(candidate, new Set(resolving).add(value.name), scopes, roots)
      return
    }
    if (['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression', 'ObjectMethod'].includes(value.type)) { scopes.add(value); roots.add(value) }
  }
  const stateOptionScopes = exportedOptionStates.map(state => {
    const scopes = new Set()
    const name = state.map.has('render') ? 'render' : 'setup'
    const values = state.map.has(name) ? optionAccessValues(state.map.get(name), optionBindings) : []
    for (const value of values) if (value !== optionUnknown) addOptionScope(value, new Set(), scopes, scopes)
    for (const scope of scopes) { componentScopes.add(scope); optionRootScopes.add(scope) }
    return { state: { ...state, unknown: state.unknown || values.includes(optionUnknown) }, scopes }
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
  for (const pending = [...componentScopes]; pending.length;) {
    const scope = pending.shift()
    if (scope?.body?.type !== 'BlockStatement') for (const candidate of optionCandidates(scope.body, optionBindings)) {
      if (['ArrowFunctionExpression', 'FunctionExpression'].includes(candidate?.type) && !componentScopes.has(candidate)) { componentScopes.add(candidate); pending.push(candidate) }
    }
  }
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
  const vueNamespaceReference = (node, resolving = new Set()) => {
    node = unwrapScriptExpression(node)
    if (node?.type !== 'Identifier' || resolving.has(node.name)) return false
    if (vueNamespaces.has(node.name)) return true
    return bindings.has(node.name) && vueNamespaceReference(bindings.get(node.name), new Set(resolving).add(node.name))
  }
  const builtinVNodeKind = (node, resolving = new Set()) => {
    node = unwrapScriptExpression(node)
    if (!node || resolving.size > 32) return undefined
    if (node.type === 'Identifier') {
      if (vnodeKinds.has(node.name)) return vnodeKinds.get(node.name)
      return bindings.has(node.name) && !resolving.has(node.name) ? builtinVNodeKind(bindings.get(node.name), new Set(resolving).add(node.name)) : undefined
    }
    if (['MemberExpression', 'OptionalMemberExpression'].includes(node.type)) {
      const name = memberName(node)
      if (vueNamespaceReference(node.object, resolving) && ['Comment', 'Text', 'Static', 'Fragment', 'KeepAlive', 'Suspense', 'Teleport'].includes(name)) return ['Comment', 'Text', 'Static'].includes(name) ? name.toLowerCase() : name === 'Fragment' ? 'fragment' : 'component'
      const value = memberValue(node.object, name, resolving)
      return value ? builtinVNodeKind(value, resolving) : undefined
    }
    return undefined
  }
  const resolvedVNodeOutcomes = (node, resolving = new Set()) => {
    node = unwrapScriptExpression(node)
    if (!node || resolving.size > 32) return []
    if (node.type === 'StringLiteral') return [{ node, kind: 'native', truthy: Boolean(node.value) }]
    if (node.type === 'NullLiteral' || (node.type === 'Identifier' && node.name === 'undefined') || (node.type === 'UnaryExpression' && node.operator === 'void') || (node.type === 'BooleanLiteral' && node.value === false)) return [{ node, kind: 'nullish', truthy: false }]
    if (node.type === 'Identifier') {
      if (bindings.has(node.name) && !resolving.has(node.name)) return resolvedVNodeOutcomes(bindings.get(node.name), new Set(resolving).add(node.name))
      return [{ node, kind: vnodeKinds.get(node.name) || 'unknown', truthy: vnodeKinds.has(node.name) ? true : undefined }]
    }
    if (['MemberExpression', 'OptionalMemberExpression'].includes(node.type)) {
      const kind = builtinVNodeKind(node, resolving)
      if (kind) return [{ node, kind, truthy: true }]
      const value = memberValue(node.object, memberName(node), resolving)
      return value ? resolvedVNodeOutcomes(value, resolving) : [{ node, kind: 'unknown', truthy: undefined }]
    }
    if (node.type === 'ConditionalExpression') {
      const condition = staticValue(node.test)
      return condition.known
        ? resolvedVNodeOutcomes(condition.value ? node.consequent : node.alternate, resolving)
        : [...resolvedVNodeOutcomes(node.consequent, resolving), ...resolvedVNodeOutcomes(node.alternate, resolving)]
    }
    if (node.type === 'LogicalExpression') {
      const left = staticValue(node.left)
      if (left.known) {
        const usesRight = node.operator === '&&' ? Boolean(left.value) : node.operator === '||' ? !left.value : left.value == null
        return resolvedVNodeOutcomes(usesRight ? node.right : node.left, resolving)
      }
      const right = resolvedVNodeOutcomes(node.right, resolving)
      return resolvedVNodeOutcomes(node.left, resolving).flatMap(outcome => {
        if (node.operator === '??') return [outcome, ...right]
        const usesRight = node.operator === '&&' ? outcome.truthy === true : outcome.truthy === false
        const keepsLeft = node.operator === '&&' ? outcome.truthy === false : outcome.truthy === true
        if (usesRight) return right
        if (keepsLeft) return [outcome]
        return node.operator === '&&'
          ? [{ ...outcome, kind: 'nullish', truthy: false }, ...right]
          : [{ ...outcome, truthy: true }, ...right]
      })
    }
    if (node.type === 'SequenceExpression') return resolvedVNodeOutcomes(node.expressions.at(-1), resolving)
    const value = staticValue(node)
    return [{ node, kind: value.known && !value.value ? 'nullish' : 'unknown', truthy: value.known ? Boolean(value.value) : undefined }]
  }
  const sequenceRenderEffects = effects => effects.includes('mustThrow') ? 'mustThrow' : effects.includes('mayThrow') ? 'mayThrow' : 'cannotThrow'
  const alternativeRenderEffects = effects => effects.every(effect => effect === 'mustThrow') ? 'mustThrow' : effects.every(effect => effect === 'cannotThrow') ? 'cannotThrow' : 'mayThrow'
  const renderSpreadOperationKind = (expression, iterable) => {
    expression = unwrapScriptExpression(expression)
    if (!expression) return 'mayThrow'
    if (expression.type === 'ConditionalExpression') {
      const condition = staticValue(expression.test)
      return condition.known
        ? renderSpreadOperationKind(condition.value ? expression.consequent : expression.alternate, iterable)
        : alternativeRenderEffects([renderSpreadOperationKind(expression.consequent, iterable), renderSpreadOperationKind(expression.alternate, iterable)])
    }
    if (iterable) {
      if (expression.type === 'ArrayExpression' || expression.type === 'StringLiteral' || expression.type === 'TemplateLiteral') return 'cannotThrow'
      if (['ObjectExpression', 'NullLiteral', 'NumericLiteral', 'BooleanLiteral', 'BigIntLiteral', 'ArrowFunctionExpression', 'FunctionExpression', 'FunctionDeclaration'].includes(expression.type) || expression.type === 'Identifier' && expression.name === 'undefined') return 'mustThrow'
      return 'mayThrow'
    }
    if (expression.type === 'NullLiteral' || expression.type === 'Identifier' && expression.name === 'undefined') return 'cannotThrow'
    if (expression.type !== 'ObjectExpression') return ['StringLiteral', 'TemplateLiteral', 'NumericLiteral', 'BooleanLiteral', 'BigIntLiteral', 'ArrayExpression'].includes(expression.type) ? 'cannotThrow' : 'mayThrow'
    return sequenceRenderEffects(expression.properties.filter(property => property.type === 'ObjectMethod' && property.kind === 'get').map(property => callableBodyEffect(property.body, renderExpressionEffect, staticValue)))
  }
  const renderSpreadEffect = (expression, iterable) => sequenceRenderEffects([renderExpressionEffect(expression), renderSpreadOperationKind(expression, iterable)])
  const renderExpressionEffect = (node, chain = false) => {
    node = unwrapScriptExpression(node)
    if (!node) return 'cannotThrow'
    if (node.type === 'ChainExpression') return renderExpressionEffect(node.expression, true)
    if (['StringLiteral', 'NumericLiteral', 'BooleanLiteral', 'NullLiteral', 'BigIntLiteral', 'ArrowFunctionExpression', 'FunctionExpression', 'FunctionDeclaration', 'ObjectMethod', 'Identifier'].includes(node.type)) return 'cannotThrow'
    if (node.type === 'ObjectExpression') return sequenceRenderEffects(node.properties.flatMap(property => property.type === 'SpreadElement'
      ? [renderSpreadEffect(property.argument, false)]
      : [property.computed ? renderExpressionEffect(property.key) : 'cannotThrow', property.type === 'ObjectMethod' ? 'cannotThrow' : renderExpressionEffect(property.value)]))
    if (node.type === 'ArrayExpression') return sequenceRenderEffects(node.elements.filter(Boolean).map(element => element.type === 'SpreadElement' ? renderSpreadEffect(element.argument, true) : renderExpressionEffect(element)))
    if (node.type === 'ConditionalExpression') {
      const testEffect = renderExpressionEffect(node.test)
      if (testEffect === 'mustThrow') return testEffect
      const condition = staticValue(node.test)
      const branchEffect = condition.known
        ? renderExpressionEffect(condition.value ? node.consequent : node.alternate)
        : alternativeRenderEffects([renderExpressionEffect(node.consequent), renderExpressionEffect(node.alternate)])
      return sequenceRenderEffects([testEffect, branchEffect])
    }
    if (node.type === 'LogicalExpression') {
      const leftEffect = renderExpressionEffect(node.left)
      if (leftEffect === 'mustThrow') return leftEffect
      const left = staticValue(node.left)
      if (left.known) {
        const usesRight = node.operator === '&&' ? Boolean(left.value) : node.operator === '||' ? !left.value : left.value == null
        return sequenceRenderEffects([leftEffect, usesRight ? renderExpressionEffect(node.right) : 'cannotThrow'])
      }
      return sequenceRenderEffects([leftEffect, alternativeRenderEffects(['cannotThrow', renderExpressionEffect(node.right)])])
    }
    if (node.type === 'SequenceExpression') return sequenceRenderEffects(node.expressions.map(item => renderExpressionEffect(item)))
    if (['MemberExpression', 'OptionalMemberExpression'].includes(node.type)) {
      const object = unwrapScriptExpression(node.object)
      const nested = sequenceRenderEffects([renderExpressionEffect(node.object, chain || node.type === 'OptionalMemberExpression'), node.computed ? renderExpressionEffect(node.property) : 'cannotThrow'])
      if (nested === 'mustThrow') return 'mustThrow'
      const nullish = object?.type === 'NullLiteral' || object?.type === 'Identifier' && object.name === 'undefined' || object?.type === 'UnaryExpression' && object.operator === 'void'
      if (nullish) return node.optional ? nested : nested === 'cannotThrow' ? 'mustThrow' : 'mayThrow'
      return ['ObjectExpression', 'ArrayExpression', 'StringLiteral', 'NumericLiteral', 'BooleanLiteral'].includes(object?.type) ? nested : 'mayThrow'
    }
    if (['CallExpression', 'OptionalCallExpression'].includes(node.type)) {
      const callee = unwrapScriptExpression(node.callee)
      const operands = sequenceRenderEffects([renderExpressionEffect(node.callee, chain || node.type === 'OptionalCallExpression'), ...node.arguments.map(argument => argument.type === 'SpreadElement' ? renderSpreadEffect(argument.argument, true) : renderExpressionEffect(argument))])
      if (operands === 'mustThrow') return operands
      const invocation = callee?.type === 'Identifier' && renderNames.has(callee.name)
        ? 'cannotThrow'
        : ['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'].includes(callee?.type)
          ? callableBodyEffect(callee.body, renderExpressionEffect, staticValue)
          : 'mayThrow'
      return sequenceRenderEffects([operands, invocation])
    }
    if (node.type === 'AssignmentExpression') return sequenceRenderEffects([
      ['MemberExpression', 'OptionalMemberExpression'].includes(unwrapScriptExpression(node.left)?.type) ? renderExpressionEffect(node.left) : 'cannotThrow',
      renderExpressionEffect(node.right),
    ])
    if (node.type === 'TemplateLiteral') return sequenceRenderEffects(node.expressions.map(item => renderExpressionEffect(item)))
    if (node.type === 'UnaryExpression' || node.type === 'UpdateExpression' || node.type === 'AwaitExpression') return renderExpressionEffect(node.argument)
    if (node.type === 'BinaryExpression') return sequenceRenderEffects([renderExpressionEffect(node.left), renderExpressionEffect(node.right)])
    return 'mayThrow'
  }
  const returns = body => {
    body = unwrapScriptExpression(body)
    if (!body) return [undefined]
    if (body.type !== 'BlockStatement') return [body]
    const materialize = (node, local, resolving = new Set(), parent, key) => {
      node = unwrapScriptExpression(node)
      if (!node || typeof node !== 'object') return node
      if (node.type === 'Identifier' && local.has(node.name) && !resolving.has(node.name)) {
        const staticKey = parent?.type === 'MemberExpression' && key === 'property' && !parent.computed || ['ObjectProperty', 'ObjectMethod'].includes(parent?.type) && key === 'key' && !parent.computed
        if (!staticKey) return materialize(local.get(node.name), local, new Set(resolving).add(node.name))
      }
      if (['ArrowFunctionExpression', 'FunctionExpression', 'FunctionDeclaration', 'ObjectMethod'].includes(node.type)) return node
      const copy = {}
      for (const [childKey, child] of Object.entries(node)) copy[childKey] = ['loc', 'start', 'end', 'extra'].includes(childKey)
        ? child
        : Array.isArray(child) ? child.map(item => materialize(item, local, resolving, node, childKey)) : materialize(child, local, resolving, node, childKey)
      return copy
    }
    const bindLocalPattern = (pattern, value, local) => {
      pattern = unwrapScriptExpression(pattern)
      if (pattern?.type === 'Identifier') { local.set(pattern.name, value); return }
      if (pattern?.type === 'AssignmentPattern') { bindLocalPattern(pattern.left, value || pattern.right, local); return }
      if (pattern?.type === 'ObjectPattern') for (const property of pattern.properties) if (property.type !== 'RestElement') bindLocalPattern(property.value, optionMember(value, scriptPropertyName(property)), local)
      if (pattern?.type === 'ArrayPattern') for (let index = 0; index < pattern.elements.length; index += 1) if (pattern.elements[index]?.type !== 'RestElement') bindLocalPattern(pattern.elements[index], optionMember(value, index), local)
    }
    const statements = (items, seed = [{ kind: 'normal', bindings: new Map() }], catches = false) => {
      let paths = seed.map(path => {
        if (path.kind !== 'normal') return path
        const bindings = new Map(path.bindings)
        for (const statement of items || []) if (statement?.type === 'FunctionDeclaration' && statement.id) bindings.set(statement.id.name, statement)
        return { ...path, bindings }
      })
      for (const statement of items || []) paths = paths.flatMap(path => path.kind === 'normal' ? one(statement, path, catches) : [path])
      return paths
    }
    const one = (node, path, catches = false) => {
      if (!node) return [path]
      if (node.type === 'BlockStatement') return statements(node.body, [path], catches)
      if (node.type === 'ReturnStatement') {
        const expression = materialize(node.argument, path.bindings)
        const effect = renderExpressionEffect(expression)
        const result = effect === 'mustThrow' ? [] : [{ ...path, kind: 'return', expression }]
        if (catches && effect !== 'cannotThrow') result.push({ ...path, kind: 'throw' })
        return result
      }
      if (node.type === 'ThrowStatement') return [{ ...path, kind: 'throw' }]
      if (node.type === 'IfStatement') {
        const test = materialize(node.test, path.bindings)
        const testEffect = renderExpressionEffect(test)
        if (testEffect === 'mustThrow') return catches ? [{ ...path, kind: 'throw' }] : []
        const condition = staticValue(test)
        const paths = condition.known ? one(condition.value ? node.consequent : node.alternate, { ...path, bindings: new Map(path.bindings) }, catches) : [...one(node.consequent, { ...path, bindings: new Map(path.bindings) }, catches), ...one(node.alternate, { ...path, bindings: new Map(path.bindings) }, catches)]
        if (catches && testEffect === 'mayThrow') paths.push({ ...path, kind: 'throw' })
        return paths
      }
      if (node.type === 'TryStatement') {
        let paths = one(node.block, { ...path, bindings: new Map(path.bindings) }, true).flatMap(result => result.kind === 'throw' && node.handler ? one(node.handler.body, { ...result, kind: 'normal', bindings: new Map(result.bindings) }, false) : [result])
        if (node.finalizer) paths = paths.flatMap(result => one(node.finalizer, { ...result, kind: 'normal', bindings: new Map(result.bindings) }, true).flatMap(finalPath => finalPath.kind === 'normal' ? [{ ...result, bindings: finalPath.bindings }] : [finalPath]))
        return paths
      }
      if (node.type === 'SwitchStatement') {
        const condition = staticValue(materialize(node.discriminant, path.bindings))
        const fallback = node.cases.findIndex(branch => !branch.test)
        const matched = condition.known ? node.cases.findIndex(branch => branch.test && staticValue(branch.test).known && Object.is(staticValue(branch.test).value, condition.value)) : -1
        const entries = condition.known ? [matched >= 0 ? matched : fallback].filter(index => index >= 0) : node.cases.map((_, index) => index).concat(fallback < 0 ? [-1] : [])
        return entries.flatMap(entry => entry < 0 ? [path] : statements(node.cases.slice(entry).flatMap(branch => branch.consequent), [{ ...path, bindings: new Map(path.bindings) }], catches))
      }
      if (node.type === 'VariableDeclaration') {
        let paths = [path]
        for (const declaration of node.declarations) paths = paths.flatMap(current => {
          if (current.kind !== 'normal') return [current]
          const expression = materialize(declaration.init, current.bindings)
          const effect = renderExpressionEffect(expression)
          const result = []
          if (effect !== 'mustThrow') {
            const next = new Map(current.bindings)
            bindLocalPattern(declaration.id, expression, next)
            result.push({ ...current, bindings: next })
          }
          if (catches && effect !== 'cannotThrow') result.push({ ...current, kind: 'throw' })
          return result
        })
        return paths
      }
      if (node.type === 'ExpressionStatement' && unwrapScriptExpression(node.expression)?.type === 'AssignmentExpression' && node.expression.operator === '=') {
        const assignment = unwrapScriptExpression(node.expression)
        const right = materialize(assignment.right, path.bindings)
        const effect = renderExpressionEffect({ ...assignment, right })
        const result = []
        if (effect !== 'mustThrow') {
          const next = new Map(path.bindings)
          bindLocalPattern(assignment.left, right, next)
          result.push({ ...path, bindings: next })
        }
        if (catches && effect !== 'cannotThrow') result.push({ ...path, kind: 'throw' })
        return result
      }
      const expression = materialize(node.type === 'ExpressionStatement' ? node.expression : undefined, path.bindings)
      const effect = renderExpressionEffect(expression)
      const result = effect === 'mustThrow' ? [] : [path]
      if (catches && effect !== 'cannotThrow') result.push({ ...path, kind: 'throw' })
      return result
    }
    return statements(body.body).filter(path => path.kind !== 'throw').map(path => path.kind === 'return' ? path.expression : undefined)
  }
  const inspect = (node, resolving = new Set()) => {
    node = unwrapScriptExpression(node)
    if (!node) return false
    if (node.type === 'Identifier') {
      if (resolving.has(node.name)) return false
      const next = new Set(resolving).add(node.name)
      return bindings.has(node.name) ? inspect(bindings.get(node.name), next) : helpers.has(node.name) ? returns(helpers.get(node.name).body).every(value => inspect(value, next)) : false
    }
    if (['MemberExpression', 'OptionalMemberExpression'].includes(node.type)) {
      const value = memberValue(node.object, memberName(node), resolving)
      return value ? inspect(value, resolving) : false
    }
    if (['ArrowFunctionExpression', 'FunctionExpression', 'FunctionDeclaration'].includes(node.type)) { const values = returns(node.body); return values.length > 0 && values.every(value => inspect(value, resolving)) }
    if (node.type === 'ConditionalExpression') { const value = staticValue(node.test); return value.known ? inspect(value.value ? node.consequent : node.alternate, resolving) : inspect(node.consequent, resolving) && inspect(node.alternate, resolving) }
    if (node.type === 'LogicalExpression') { const left = staticValue(node.left); if (left.known) return inspect(node.left, resolving) || ((node.operator === '&&' ? Boolean(left.value) : node.operator === '||' ? !left.value : left.value == null) && inspect(node.right, resolving)); return inspect(node.left, resolving) && inspect(node.right, resolving) }
    if (node.type === 'SequenceExpression') return inspect(node.expressions.at(-1), resolving)
    if (node.type === 'ArrayExpression') return node.elements.some(value => inspect(value, resolving))
    if (!['CallExpression', 'OptionalCallExpression'].includes(node.type)) return false
    if (unwrapScriptExpression(node.callee)?.type === 'Identifier' && renderNames.has(node.callee.name)) {
      if (isComponentReference(node.arguments[0])) return true
      const vnodeTypes = resolvedVNodeOutcomes(node.arguments[0])
      const rendersChildren = vnodeTypes.length === 0 || vnodeTypes.some(type => ['native', 'component', 'unknown', 'fragment'].includes(type.kind))
      const executesSlots = vnodeTypes.length === 0 || vnodeTypes.some(type => ['component', 'unknown'].includes(type.kind))
      const executesDirectFunction = vnodeTypes.length === 0 || vnodeTypes.some(type => ['native', 'component', 'unknown'].includes(type.kind))
      const children = node.arguments.length >= 3 ? node.arguments.slice(2) : node.arguments.slice(1)
      const inspectRenderedChild = (child, arrayValue = false) => {
        child = unwrapScriptExpression(child)
        if (!child) return false
        if (child.type === 'ArrayExpression') return rendersChildren && child.elements.some(value => inspectRenderedChild(value, true))
        if (['ArrowFunctionExpression', 'FunctionExpression'].includes(child.type)) return !arrayValue && executesDirectFunction && returns(child.body).some(value => inspect(value, resolving))
        if (child.type === 'ObjectExpression') {
          if (!executesSlots) return false
          return child.properties.some(property => property.type === 'SpreadElement'
            ? inspect(property.argument, resolving)
            : inspect(property.type === 'ObjectMethod' ? property : property.value, resolving))
        }
        return rendersChildren && inspect(child, resolving)
      }
      return children.some(inspectRenderedChild)
    }
    if (unwrapScriptExpression(node.callee)?.type === 'Identifier' && helpers.has(node.callee.name) && !resolving.has(node.callee.name)) { const values = returns(helpers.get(node.callee.name).body); return values.length > 0 && values.every(value => inspect(value, new Set(resolving).add(node.callee.name))) }
    return false
  }
  return stateOptionScopes.length > 0 && stateOptionScopes.every(({ state, scopes }) => !state.unknown && scopes.size > 0 && [...scopes].every(fn => {
    const values = returns(fn?.body)
    return values.length > 0 && values.every(value => inspect(value))
  }))
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
    // Vue applies transition classes to the routed component's actual root, which may be any HTML element.
    return (classes.length === 0 && tags.length === 0)
      || (classes.length > 0 && classes.every(value => value === targetClass) && tags.length <= 1)
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
