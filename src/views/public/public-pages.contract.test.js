import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import vuePlugin from '@vitejs/plugin-vue'
import { messages } from '../../i18n/messages.js'
import { publicMessages } from '../../i18n/public-messages.js'
import { routes } from '../../router/index.js'

const source = path => readFileSync(new URL(path, import.meta.url), 'utf8')
const vueCompiler = (() => {
  const plugin = vuePlugin()
  plugin.buildStart()
  return plugin.api.options.compiler
})()
// This helper is intentionally mirrored in the pricing contract: importing a *.test.js file would register its tests and alter the node:test harness.
const parseVue = (value, label = 'public Vue component') => {
  const parsed = vueCompiler.parse(value, { filename: label })
  assert.deepEqual(parsed.errors, [], `${label} must parse cleanly: ${parsed.errors.map(String).join('; ')}`)
  return parsed.descriptor
}
const templateAst = value => parseVue(value).template?.ast || { children: [] }
const reachableVueBranches = node => {
  if (node.type !== 9) return node.branches || []
  const branches = []
  for (const branch of node.branches || []) {
    if (!branch.condition) { branches.push(branch); break }
    let expression
    try { expression = vueCompiler.babelParse(`(${branch.condition.content})`, { sourceType: 'module', plugins: ['typescript'] }).program.body[0]?.expression }
    catch (error) { throw new Error(`public v-if branch must parse cleanly: ${error.message}`, { cause: error }) }
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
      catch (error) { throw new Error(`public v-if branch must parse cleanly: ${error.message}`, { cause: error }) }
      const condition = staticValue(expression)
      if (condition === unknownStaticValue) alternatives.push(branch)
      else if (condition) { alternatives.push(branch); guaranteed = true; break }
    }
    if (!guaranteed) alternatives.push(undefined)
    paths = paths.flatMap(path => alternatives.map(branch => branch ? [...path, branch] : path))
  }
  return paths
}
const normalizedComponentName = value => String(value || '').replace(/-/g, '').toLowerCase()
const elements = (value, name) => {
  const collect = node => {
    if (staticallyHidden(node)) return []
    if (node.type === 9) return reachableVueBranches(node).map(collect).sort((left, right) => right.length - left.length)[0] || []
    const own = node.type === 1 && normalizedComponentName(node.tag) === normalizedComponentName(name) ? [node] : []
    const children = reachableChildPaths(node).map(path => path.flatMap(collect)).sort((left, right) => right.length - left.length)[0] || []
    return [...own, ...children, ...reachableVueBranches(node).flatMap(collect)]
  }
  return collect(templateAst(value))
}
const renderedComponentIsWired = (value, _name, expectedFile) => {
  const descriptor = parseVue(value)
  const authoritativeModule = new URL(`../../components/public/${expectedFile}`, import.meta.url).pathname
  const sourceMatches = specifier => {
    if (typeof specifier !== 'string') return false
    const resolved = specifier.startsWith('@/')
      ? new URL(`../../${specifier.slice(2)}`, import.meta.url)
      : specifier.startsWith('.') ? new URL(specifier, import.meta.url) : undefined
    return resolved?.pathname === authoritativeModule
  }
  const wiredNames = new Set()
  for (const block of [descriptor.scriptSetup, descriptor.script].filter(Boolean)) {
    let ast
    try { ast = vueCompiler.babelParse(block.content, { sourceType: 'module', plugins: ['typescript'] }) }
    catch (error) { throw new Error(`home component wiring must parse cleanly: ${error.message}`, { cause: error }) }
    const imports = new Map()
    const bindings = new Map()
    const defineComponentNames = new Set()
    for (const statement of ast.program.body) if (statement.type === 'ImportDeclaration') {
      for (const specifier of statement.specifiers) {
        imports.set(specifier.local.name, statement.source.value)
        if (statement.source.value === 'vue' && (specifier.imported?.name ?? specifier.imported?.value) === 'defineComponent') defineComponentNames.add(specifier.local.name)
      }
    }
    const member = (object, key) => ({ type: 'MemberExpression', object, property: { type: 'StringLiteral', value: String(key) }, computed: true })
    const select = (expression, key) => {
      expression = unwrapExpression(expression)
      if (expression?.type === 'ArrayExpression') return expression.elements[Number(key)]
      if (expression?.type === 'ObjectExpression') {
        let found
        for (const property of expression.properties) {
          if (property.type === 'SpreadElement') {
            const spread = select(property.argument, key)
            if (spread) found = spread
          } else if (staticPropertyKey(property.key) === String(key)) found = propertyExpression(property)
        }
        if (found) return found
      }
      return member(expression, key)
    }
    const bind = (pattern, expression, target) => {
      pattern = unwrapExpression(pattern)
      if (pattern?.type === 'Identifier') { target.set(pattern.name, expression); return }
      if (pattern?.type === 'AssignmentPattern') { bind(pattern.left, expression || pattern.right, target); return }
      if (pattern?.type === 'ObjectPattern') for (const property of pattern.properties) if (property.type !== 'RestElement') bind(property.value, select(expression, staticPropertyKey(property.key)), target)
      if (pattern?.type === 'ArrayPattern') for (let index = 0; index < pattern.elements.length; index += 1) if (pattern.elements[index]?.type !== 'RestElement') bind(pattern.elements[index], select(expression, index), target)
    }
    let exported = []
    const possibilities = (expression, resolving = new Set()) => {
      expression = unwrapExpression(expression)
      if (!expression || resolving.size > 32) return []
      if (expression.type === 'Identifier' && bindings.has(expression.name) && !resolving.has(expression.name)) return possibilities(bindings.get(expression.name), new Set(resolving).add(expression.name))
      if (['MemberExpression', 'OptionalMemberExpression'].includes(expression.type)) {
        const key = expression.computed ? staticPropertyKey(expression.property) : expression.property?.name
        return possibilities(expression.object, resolving).flatMap(object => ['ObjectExpression', 'ArrayExpression'].includes(object?.type) ? possibilities(select(object, key), resolving) : [])
      }
      if (expression.type === 'ConditionalExpression') return [...possibilities(expression.consequent, resolving), ...possibilities(expression.alternate, resolving)]
      if (expression.type === 'SequenceExpression') return possibilities(expression.expressions.at(-1), resolving)
      return [expression]
    }
    const authoritative = expression => {
      const candidates = possibilities(expression)
      return candidates.length > 0 && candidates.every(candidate => candidate.type === 'Identifier' && sourceMatches(imports.get(candidate.name)))
    }
    const substitute = (node, replacements, parent, key) => {
      node = unwrapExpression(node)
      if (!node || typeof node !== 'object') return node
      if (node.type === 'Identifier' && replacements.has(node.name)) {
        const staticKey = parent?.type === 'MemberExpression' && key === 'property' && !parent.computed || ['ObjectProperty', 'ObjectMethod'].includes(parent?.type) && key === 'key' && !parent.computed
        if (!staticKey) return replacements.get(node.name)
      }
      if (['FunctionExpression', 'ArrowFunctionExpression', 'FunctionDeclaration', 'ObjectMethod'].includes(node.type)) return node
      let changed = false
      const copy = {}
      for (const [childKey, child] of Object.entries(node)) {
        copy[childKey] = ['loc', 'start', 'end', 'extra'].includes(childKey) ? child : Array.isArray(child) ? child.map(value => substitute(value, replacements, node, childKey)) : substitute(child, replacements, node, childKey)
        if (copy[childKey] !== child) changed = true
      }
      return changed ? copy : node
    }
    const factoryReturns = (fn, args) => {
      const replacements = new Map()
      for (let index = 0; index < (fn.params || []).length; index += 1) {
        const bound = new Map()
        bind(fn.params[index], args[index], bound)
        for (const [name, expression] of bound) replacements.set(name, expression)
      }
      if (fn.body?.type !== 'BlockStatement') return [substitute(fn.body, replacements)]
      const returned = []
      for (const statement of fn.body.body) {
        if (statement.type === 'VariableDeclaration') {
          for (const declaration of statement.declarations) {
            if (declaration.id?.type !== 'Identifier' || !declaration.init) return []
            const value = substitute(declaration.init, replacements)
            if (['CallExpression', 'OptionalCallExpression', 'NewExpression', 'AwaitExpression'].includes(value?.type)) return []
            replacements.set(declaration.id.name, value)
          }
        } else if (statement.type === 'ReturnStatement' && statement.argument) returned.push(substitute(statement.argument, replacements))
        else if (statement.type !== 'EmptyStatement' && statement.type !== 'FunctionDeclaration') return []
      }
      return returned
    }
    const bindingValue = (expression, target, resolving = new Set()) => {
      expression = unwrapExpression(expression)
      if (expression?.type === 'Identifier' && target.has(expression.name) && !resolving.has(expression.name)) return bindingValue(target.get(expression.name), target, new Set(resolving).add(expression.name))
      return expression
    }
    const expressionEffect = (expression, target, chain = false) => {
      expression = bindingValue(expression, target)
      if (!expression) return 'cannotThrow'
      if (expression.type === 'ChainExpression') return expressionEffect(expression.expression, target, true)
      if (['StringLiteral', 'NumericLiteral', 'BooleanLiteral', 'NullLiteral', 'BigIntLiteral', 'ObjectExpression', 'ArrayExpression', 'ArrowFunctionExpression', 'FunctionExpression', 'FunctionDeclaration', 'ObjectMethod', 'Identifier'].includes(expression.type)) return 'cannotThrow'
      if (['MemberExpression', 'OptionalMemberExpression'].includes(expression.type)) {
        const object = bindingValue(expression.object, target)
        const nested = expressionEffect(expression.object, target, chain || expression.type === 'OptionalMemberExpression')
        if (nested === 'mustThrow') return 'mustThrow'
        const nullish = object?.type === 'NullLiteral' || object?.type === 'Identifier' && object.name === 'undefined'
        const shortCircuited = ['MemberExpression', 'OptionalMemberExpression'].includes(object?.type) && expressionEffect(object, target, true) === 'cannotThrow' && object.optional
        if (nullish) return expression.optional ? nested : nested === 'cannotThrow' ? 'mustThrow' : 'mayThrow'
        if (shortCircuited) return chain || expression.type === 'OptionalMemberExpression' ? nested : 'mustThrow'
        return ['ObjectExpression', 'ArrayExpression', 'StringLiteral', 'NumericLiteral', 'BooleanLiteral'].includes(object?.type) ? nested : 'mayThrow'
      }
      if (['CallExpression', 'OptionalCallExpression'].includes(expression.type)) {
        const callee = bindingValue(expression.callee, target)
        if (['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'].includes(callee?.type) && factoryReturns(callee, expression.arguments).length) return 'cannotThrow'
        return 'mayThrow'
      }
      return 'cannotThrow'
    }
    const flow = (statements, initial, catches = false) => {
      const hoisted = new Map(initial)
      for (const statement of statements || []) if (statement?.type === 'FunctionDeclaration' && statement.id) hoisted.set(statement.id.name, statement)
      let paths = [{ kind: 'normal', bindings: hoisted, exports: [] }]
      const one = (statement, path, catchesHere) => {
        if (!statement) return [path]
        if (statement.type === 'BlockStatement') return flow(statement.body, path.bindings, catchesHere).map(result => ({ ...result, exports: path.exports.concat(result.exports) }))
        if (statement.type === 'ExportDefaultDeclaration') return [{ ...path, exports: path.exports.concat(substitute(statement.declaration, path.bindings)) }]
        if (statement.type === 'FunctionDeclaration' || statement.type === 'ImportDeclaration' || statement.type === 'EmptyStatement') return [path]
        if (statement.type === 'ThrowStatement') return [{ ...path, kind: 'throw' }]
        if (statement.type === 'VariableDeclaration') {
          const next = new Map(path.bindings)
          let effect = 'cannotThrow'
          for (const declaration of statement.declarations) {
            const current = expressionEffect(declaration.init, next)
            if (current === 'mustThrow') effect = 'mustThrow'
            else if (current === 'mayThrow' && effect === 'cannotThrow') effect = 'mayThrow'
            if (current !== 'mustThrow') bind(declaration.id, declaration.init || { type: 'Identifier', name: 'undefined' }, next)
          }
          const result = effect === 'mustThrow' ? [] : [{ ...path, bindings: next }]
          if (catchesHere && effect !== 'cannotThrow') result.push({ ...path, kind: 'throw' })
          return result
        }
        if (statement.type === 'ExpressionStatement' && unwrapExpression(statement.expression)?.type === 'AssignmentExpression') {
          const assignment = unwrapExpression(statement.expression)
          const effect = expressionEffect(assignment.right, path.bindings)
          const result = []
          if (effect !== 'mustThrow') {
            const next = new Map(path.bindings); bind(assignment.left, assignment.right, next)
            result.push({ ...path, bindings: next })
          }
          if (catchesHere && effect !== 'cannotThrow') result.push({ ...path, kind: 'throw' })
          return result
        }
        if (statement.type === 'IfStatement') {
          const condition = staticValue(substitute(statement.test, path.bindings))
          return condition !== unknownStaticValue
            ? one(condition ? statement.consequent : statement.alternate, { ...path, bindings: new Map(path.bindings) }, catchesHere)
            : [...one(statement.consequent, { ...path, bindings: new Map(path.bindings) }, catchesHere), ...one(statement.alternate, { ...path, bindings: new Map(path.bindings) }, catchesHere)]
        }
        if (statement.type === 'TryStatement') {
          let results = one(statement.block, { ...path, bindings: new Map(path.bindings) }, true).flatMap(result => result.kind === 'throw' && statement.handler
            ? one(statement.handler.body, { ...result, kind: 'normal', bindings: new Map(result.bindings) }, false)
            : [result])
          if (statement.finalizer) results = results.flatMap(result => one(statement.finalizer, { ...result, kind: 'normal', bindings: new Map(result.bindings) }, true).map(finalResult => finalResult.kind === 'normal' ? { ...result, bindings: finalResult.bindings, exports: finalResult.exports } : finalResult))
          return results
        }
        const effect = expressionEffect(statement.expression, path.bindings)
        const result = effect === 'mustThrow' ? [] : [path]
        if (catchesHere && effect !== 'cannotThrow') result.push({ ...path, kind: 'throw' })
        return result
      }
      for (const statement of statements || []) paths = paths.flatMap(path => path.kind === 'normal' ? one(statement, path, catches) : [path])
      return paths
    }
    const normalPaths = flow(ast.program.body, new Map()).filter(path => path.kind === 'normal')
    exported = normalPaths.flatMap(path => path.exports)
    if (normalPaths.length) {
      const names = new Set(normalPaths.flatMap(path => [...path.bindings.keys()]))
      for (const name of names) {
        const candidates = [...new Set(normalPaths.map(path => path.bindings.get(name)).filter(Boolean))]
        if (candidates.length) bindings.set(name, candidates.slice(1).reduce((alternate, consequent) => ({ type: 'ConditionalExpression', test: { type: 'Identifier', name: '__dynamic_branch__' }, consequent, alternate }), candidates[0]))
      }
    }
    if (block === descriptor.scriptSetup) for (const local of new Set([...imports.keys(), ...bindings.keys()])) if (authoritative({ type: 'Identifier', name: local })) wiredNames.add(normalizedComponentName(local))
    const isDefineComponent = callee => possibilities(callee).some(candidate => candidate?.type === 'Identifier' && defineComponentNames.has(candidate.name))
    const objectMaps = (expression, resolving = new Set()) => possibilities(expression, resolving).flatMap(candidate => {
      if (['CallExpression', 'OptionalCallExpression'].includes(candidate?.type) && isDefineComponent(candidate.callee)) return objectMaps(candidate.arguments[0], resolving)
      if (['CallExpression', 'OptionalCallExpression'].includes(candidate?.type)) {
        const functions = possibilities(candidate.callee, resolving).filter(value => ['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'].includes(value?.type))
        return functions.flatMap(fn => factoryReturns(fn, candidate.arguments).flatMap(value => objectMaps(value, resolving)))
      }
      if (candidate?.type !== 'ObjectExpression') return []
      const map = new Map()
      for (const property of candidate.properties) {
        if (property.type === 'SpreadElement') for (const spread of objectMaps(property.argument, resolving)) for (const [name, value] of spread) map.set(name, value)
        else map.set(staticPropertyKey(property.key), propertyExpression(property))
      }
      return [map]
    })
    const registryPaths = exported.map(option => objectMaps(option).flatMap(options => options.has('components') ? objectMaps(options.get('components')) : []))
    const registeredNames = new Set(registryPaths.flatMap(registries => registries.flatMap(registry => [...registry.keys()])))
    for (const registered of registeredNames) {
      if (registryPaths.length > 0 && registryPaths.every(registries => registries.length > 0 && registries.every(registry => registry.has(registered) && authoritative(registry.get(registered))))) wiredNames.add(normalizedComponentName(registered))
    }
  }
  const renderedCount = node => {
    if (staticallyHidden(node)) return 0
    if (node.type === 9) return Math.max(0, ...reachableVueBranches(node).map(renderedCount))
    const own = node.type === 1 && wiredNames.has(normalizedComponentName(node.tag)) ? 1 : 0
    const childCount = Math.max(0, ...reachableChildPaths(node).map(path => path.reduce((count, child) => count + renderedCount(child), 0)))
    return own + childCount
      + (node.type === 9 ? 0 : reachableVueBranches(node).reduce((count, branch) => count + renderedCount(branch), 0))
  }
  return renderedCount(templateAst(value))
}
const staticAttribute = (node, name) => node.props.find(prop => prop.type === 6 && prop.name === name)?.value?.content
const boundAttribute = (node, name) => node.props.find(prop => prop.type === 7 && prop.name === 'bind' && prop.arg?.type === 4 && prop.arg.content === name)?.exp?.content
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
  catch (error) { throw new Error(`public visibility expression must parse cleanly: ${error.message}`, { cause: error }) }
  const value = staticValue(expression)
  return value !== unknownStaticValue && !value
}
const staticallyHidden = node => node.type === 1 && node.props?.some(directiveIsStaticallyFalse)
const dataSectionOrder = value => {
  const visit = node => {
    if (staticallyHidden(node)) return []
    if (node.type === 9) return reachableVueBranches(node).map(visit).sort((left, right) => right.length - left.length)[0] || []
    const order = []
    if (node.type === 1) {
      const section = staticAttribute(node, 'data-section')
      if (section) order.push(section)
    }
    const childOrder = reachableChildPaths(node).map(path => path.flatMap(visit)).sort((left, right) => right.length - left.length)[0] || []
    order.push(...childOrder)
    for (const branch of reachableVueBranches(node)) order.push(...visit(branch))
    return order
  }
  return visit(templateAst(value))
}
const staticBindingInitializers = value => {
  const bindings = new Map()
  const descriptor = parseVue(value)
  for (const block of [descriptor.script, descriptor.scriptSetup].filter(Boolean)) {
    let ast
    try { ast = vueCompiler.babelParse(block.content, { sourceType: 'module', plugins: ['typescript'] }) }
    catch (error) { throw new Error(`public Vue script must parse cleanly: ${error.message}`, { cause: error }) }
    const member = (object, key) => ({ type: 'MemberExpression', object, property: { type: 'StringLiteral', value: String(key) }, computed: true })
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
    const sequenceEffect = effects => {
      let uncertain = false
      for (const effect of effects) {
        if (effect === 'mustThrow') return uncertain ? 'mayThrow' : 'mustThrow'
        if (effect === 'mayThrow') uncertain = true
      }
      return uncertain ? 'mayThrow' : 'cannotThrow'
    }
    const expressionEffect = (node, environment, resolving = new Set(), chain = false) => {
      node = unwrapExpression(node)
      if (!node || typeof node !== 'object') return 'cannotThrow'
      if (node.type === 'ChainExpression') return expressionEffect(node.expression, environment, resolving, true)
      if (['ArrowFunctionExpression', 'FunctionExpression', 'FunctionDeclaration', 'ObjectMethod'].includes(node.type)) return 'cannotThrow'
      if (['CallExpression', 'OptionalCallExpression'].includes(node.type)) {
        const calleeEffect = expressionEffect(node.callee, environment, resolving, chain || node.type === 'OptionalCallExpression')
        if (calleeEffect === 'mustThrow') return 'mustThrow'
        const calleeNullish = expressionNullish(node.callee, environment, resolving, chain || node.type === 'OptionalCallExpression')
        if (((chain || node.type === 'OptionalCallExpression') && calleeNullish === 'short-circuit') || (node.optional && calleeNullish === 'nullish')) return calleeEffect
        return 'mayThrow'
      }
      if (['NewExpression', 'AwaitExpression', 'TaggedTemplateExpression'].includes(node.type)) return 'mayThrow'
      if (['MemberExpression', 'OptionalMemberExpression'].includes(node.type)) {
        const receiverEffect = expressionEffect(node.object, environment, resolving, chain || node.type === 'OptionalMemberExpression')
        const propertyEffect = node.computed ? expressionEffect(node.property, environment, resolving) : 'cannotThrow'
        const prerequisite = sequenceEffect([receiverEffect, propertyEffect])
        if (prerequisite === 'mustThrow') return 'mustThrow'
        const receiverNullish = expressionNullish(node.object, environment, resolving, chain || node.type === 'OptionalMemberExpression')
        if (receiverNullish === 'short-circuit') return chain || node.type === 'OptionalMemberExpression' ? prerequisite : 'mustThrow'
        if (receiverNullish === 'nullish') return node.optional ? prerequisite : prerequisite === 'cannotThrow' ? 'mustThrow' : 'mayThrow'
        if (receiverNullish === 'unknown') return 'mayThrow'
        const key = node.computed ? staticPropertyKey(node.property) : node.property?.name
        const selectedValue = key === undefined ? { unknown: true } : factorySelection(node.object, key, environment, resolving)
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
    const setupReturns = (body, baseLocal = new Map()) => {
      const unknownThrown = { type: 'Identifier', name: '__unknown_thrown_value__' }
      const localCallPaths = (expression, environment, replacements, resolving) => {
        expression = unwrapExpression(expression)
        if (!['CallExpression', 'OptionalCallExpression'].includes(expression?.type)) return undefined
        const key = expression.callee?.type === 'Identifier' ? expression.callee.name : `iife:${expression.callee?.start ?? expression.start}`
        if (resolving.has(key)) return [{ kind: 'normal', replacements, environment }, { kind: 'throw', expression: unknownThrown, replacements, environment }]
        const functions = factoryFunctions(expression.callee, environment, resolving)
        if (!functions.length) return undefined
        return functions.flatMap(fn => {
          const local = new Map(environment)
          const bound = new Map(replacements)
          const localNames = new Set()
          const collectVarDeclarations = node => {
            if (!node || typeof node !== 'object') return
            if (node !== fn && ['ArrowFunctionExpression', 'FunctionExpression', 'FunctionDeclaration', 'ObjectMethod'].includes(node.type)) return
            if (node.type === 'VariableDeclaration' && node.kind === 'var') for (const declaration of node.declarations) for (const name of patternNames(declaration.id)) localNames.add(name)
            for (const [name, child] of Object.entries(node)) if (!['loc', 'start', 'end', 'extra'].includes(name)) {
              if (Array.isArray(child)) for (const item of child) collectVarDeclarations(item)
              else collectVarDeclarations(child)
            }
          }
          for (let index = 0; index < fn.params.length; index += 1) {
            const parameter = unwrapExpression(fn.params[index])
            for (const name of patternNames(parameter)) localNames.add(name)
            const argument = parameter?.type === 'RestElement' ? { type: 'ArrayExpression', elements: expression.arguments.slice(index) } : expression.arguments[index]
            bindFactoryPattern(parameter, argument, local, bound)
            if (parameter?.type === 'RestElement') break
          }
          for (const statement of fn.body?.body || []) {
            if (statement.type === 'VariableDeclaration') for (const declaration of statement.declarations) for (const name of patternNames(declaration.id)) localNames.add(name)
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
            if (!root && statement.type === 'VariableDeclaration' && statement.kind !== 'var') for (const declaration of statement.declarations) for (const name of patternNames(declaration.id)) scopedNames.add(name)
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
      return flow(body, new Map(), false, new Map(baseLocal), new Set(), true).filter(path => path.kind === 'return' && path.expression)
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
      return { values, safe: visit(fn.body, true) }
    }
    const patternNames = (pattern, names = []) => {
      pattern = unwrapExpression(pattern)
      if (pattern?.type === 'Identifier') names.push(pattern.name)
      else if (pattern?.type === 'AssignmentPattern') patternNames(pattern.left, names)
      else if (pattern?.type === 'RestElement') patternNames(pattern.argument, names)
      else if (pattern?.type === 'ObjectPattern') for (const property of pattern.properties) patternNames(property.type === 'RestElement' ? property.argument : property.value, names)
      else if (pattern?.type === 'ArrayPattern') for (const element of pattern.elements) if (element) patternNames(element, names)
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
        const propertyKey = staticPropertyKey(property.key)
        if (property.computed && propertyKey === undefined) return { unknown: true }
        if (propertyKey === String(key)) return property.type === 'ObjectMethod' && property.kind === 'get'
          ? { unknown: true }
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
        if (value.type === 'VariableDeclaration' && value.kind === 'var') for (const declaration of value.declarations) patternNames(declaration.id, names)
        for (const [name, child] of Object.entries(value)) if (!['loc', 'start', 'end', 'extra'].includes(name)) {
          if (Array.isArray(child)) for (const item of child) visit(item)
          else visit(child)
        }
      }
      visit(node.body)
      return names
    }
    const blockLexicalNames = node => (node.body || []).flatMap(statement => {
      if (statement.type === 'VariableDeclaration' && statement.kind !== 'var') return statement.declarations.flatMap(declaration => patternNames(declaration.id))
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
        const isStaticKey = (parent?.type === 'ObjectProperty' || parent?.type === 'ObjectMethod' || parent?.type === 'MemberExpression') && key === 'key' || parent?.type === 'MemberExpression' && key === 'property' && !parent.computed
        if (!isStaticKey && !resolving.has(node.name)) return substituteFactoryBindings(replacements.get(node.name), replacements, shadowed, parent, key, new Set(resolving).add(node.name))
      }
      let nestedShadowed = shadowed
      if (['ArrowFunctionExpression', 'FunctionExpression', 'FunctionDeclaration', 'ObjectMethod'].includes(node.type)) {
        nestedShadowed = new Set(shadowed)
        for (const name of (node.params || []).flatMap(parameter => patternNames(parameter)).concat(functionVarNames(node))) nestedShadowed.add(name)
        if (node.id?.name) nestedShadowed.add(node.id.name)
      }
      if (node.type === 'BlockStatement') { nestedShadowed = new Set(shadowed); for (const name of blockLexicalNames(node)) nestedShadowed.add(name) }
      if (node.type === 'CatchClause') { nestedShadowed = new Set(shadowed); for (const name of patternNames(node.param)) nestedShadowed.add(name) }
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
    const stateValues = (states, key) => {
      const values = []
      let uncertain = false
      for (const state of states) {
        if (state.map.has(key)) values.push(state.map.get(key))
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
      for (const key of keys) exposed.set(key, [...new Set(branches.flatMap(branch => stateValues(branch.states, key).flatMap(value => resolvedLocalValues(value, branch.environment))))])
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
        const functions = stateValues(options, name).flatMap(value => reachableOptionValues(value, target))
        const branches = functions.map(fn => returnedObjectBindings(unwrapExpression(fn), target))
        for (const key of new Set(branches.flatMap(branch => [...branch.keys()]))) target.set(key, [...new Set(branches.flatMap(branch => branch.get(key) || [unknownObjectValue]))])
      }
      for (const name of ['computed', 'methods']) {
        const registries = stateValues(options, name).flatMap(value => objectStates(value, target))
        for (const key of new Set(registries.flatMap(state => [...state.map.keys()]))) target.set(key, stateValues(registries, key).flatMap(value => resolvedLocalValues(value, target)))
      }
    }
    const process = (statements, target, scoped = false) => {
      const scopedNames = new Set()
      const previous = new Map()
      for (const raw of statements || []) {
        const declaration = raw?.type === 'ExportNamedDeclaration' ? raw.declaration : raw
        if (declaration?.type === 'FunctionDeclaration' && declaration.id) scopedNames.add(declaration.id.name)
        if (scoped && declaration?.type === 'VariableDeclaration' && declaration.kind !== 'var') for (const item of declaration.declarations) for (const name of patternNames(item.id)) scopedNames.add(name)
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
        else if (node.type === 'ExportDefaultDeclaration') exposeOptions(node.declaration, target)
        else if (node.type === 'ExpressionStatement') applyExpression(node.expression, target)
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
  }
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
const renderFunctionUsesImportedComponent = (value, expectedFile) => {
  const descriptor = parseVue(value, 'public layout render')
  for (const block of [descriptor.scriptSetup, descriptor.script].filter(Boolean)) {
    let ast
    try { ast = vueCompiler.babelParse(block.content, { sourceType: 'module', plugins: ['typescript'] }) }
    catch (error) { throw new Error(`public layout render must parse cleanly: ${error.message}`, { cause: error }) }
    const targets = new Set()
    const renderNames = new Set(['h', 'createVNode'])
    const vnodeKinds = new Map()
    const vueNamespaces = new Set()
    const helpers = new Map()
    const aliases = new Map()
    const defineComponentNames = new Set()
    const exportedOptions = []
    const walkScriptAst = (node, visit, parent) => {
      if (!node || typeof node !== 'object') return
      visit(node, parent)
      for (const [key, child] of Object.entries(node)) if (!['loc', 'start', 'end', 'extra'].includes(key)) {
        for (const item of Array.isArray(child) ? child : [child]) if (item?.type) walkScriptAst(item, visit, node)
      }
    }
    const parents = new WeakMap()
    walkScriptAst(ast.program, (node, parent) => { if (parent) parents.set(node, parent) })
    const componentScopes = new Set()
    for (const statement of ast.program.body) {
      if (statement.type === 'ImportDeclaration') for (const specifier of statement.specifiers) {
        if (statement.source.value === 'vue' && specifier.type === 'ImportNamespaceSpecifier') vueNamespaces.add(specifier.local.name)
        const imported = specifier.imported?.name ?? specifier.imported?.value
        if (statement.source.value === 'vue' && imported === 'defineComponent') defineComponentNames.add(specifier.local.name)
        if (statement.source.value === 'vue' && ['h', 'createVNode'].includes(imported)) renderNames.add(specifier.local.name)
        if (statement.source.value === 'vue' && ['Comment', 'Text', 'Static', 'Fragment'].includes(imported)) vnodeKinds.set(specifier.local.name, ['Comment', 'Text', 'Static'].includes(imported) ? imported.toLowerCase() : 'fragment')
        if (statement.source.value === 'vue' && ['KeepAlive', 'Suspense', 'Teleport'].includes(imported)) vnodeKinds.set(specifier.local.name, 'component')
        if (/\.vue(?:\?|$)/.test(statement.source.value)) vnodeKinds.set(specifier.local.name, 'component')
        if (String(statement.source.value).replace(/\\/g, '/').endsWith(`/${expectedFile}`)) targets.add(specifier.local.name)
      }
      if (statement.type === 'FunctionDeclaration' && statement.id) helpers.set(statement.id.name, statement)
      if (statement.type === 'ExportDefaultDeclaration') {
        exportedOptions.push(statement.declaration)
        let options = unwrapExpression(statement.declaration)
        if (['CallExpression', 'OptionalCallExpression'].includes(options?.type) && options.callee?.type === 'Identifier' && options.callee.name === 'defineComponent') options = unwrapExpression(options.arguments[0])
        if (options?.type === 'ObjectExpression') for (const property of options.properties.filter(candidate => ['setup', 'render'].includes(String(staticPropertyKey(candidate.key))))) componentScopes.add(property.type === 'ObjectMethod' ? property : unwrapExpression(property.value))
      }
    }
    const functionBindings = new Map()
    walkScriptAst(ast.program, node => {
      if (node.type === 'FunctionDeclaration' && node.id) functionBindings.set(node.id.name, node)
      if (node.type === 'VariableDeclarator' && node.id?.type === 'Identifier' && ['ArrowFunctionExpression', 'FunctionExpression'].includes(unwrapExpression(node.init)?.type)) functionBindings.set(node.id.name, unwrapExpression(node.init))
    })
    const nearestFunction = node => {
      for (let current = parents.get(node); current; current = parents.get(current)) if (['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression', 'ObjectMethod'].includes(current.type)) return current
      return undefined
    }
    for (const scope of [...componentScopes]) walkScriptAst(scope?.body, node => {
      if (node.type !== 'ReturnStatement' || nearestFunction(node) !== scope || !node.argument) return
      const expression = unwrapExpression(node.argument)
      if (['ArrowFunctionExpression', 'FunctionExpression'].includes(expression?.type)) componentScopes.add(expression)
      if (expression?.type === 'Identifier' && functionBindings.has(expression.name)) componentScopes.add(functionBindings.get(expression.name))
    })
    const reachability = node => {
      let uncertain = false
      for (let current = node, parent = parents.get(current); parent; current = parent, parent = parents.get(parent)) {
        if (['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression', 'ObjectMethod'].includes(parent.type) && !componentScopes.has(parent)) return false
        if (parent.type === 'IfStatement' && (current === parent.consequent || current === parent.alternate)) {
          const condition = staticValue(parent.test)
          if (condition !== unknownStaticValue && Boolean(condition) !== (current === parent.consequent)) return false
          if (condition === unknownStaticValue) uncertain = true
        }
        if (parent.type === 'ConditionalExpression' && (current === parent.consequent || current === parent.alternate)) {
          const condition = staticValue(parent.test)
          if (condition !== unknownStaticValue && Boolean(condition) !== (current === parent.consequent)) return false
          if (condition === unknownStaticValue) uncertain = true
        }
        if (parent.type === 'LogicalExpression' && current === parent.right) {
          const left = staticValue(parent.left)
          if (left !== unknownStaticValue && ((parent.operator === '&&' && !left) || (parent.operator === '||' && left))) return false
          if (left === unknownStaticValue) uncertain = true
        }
      }
      return uncertain ? 'maybe' : true
    }
    const aliasMember = (object, key) => ({ type: 'MemberExpression', object, property: { type: 'StringLiteral', value: String(key) }, computed: true })
    const bindAliasPattern = (pattern, value, certainty = true) => {
      pattern = unwrapExpression(pattern)
      if (!pattern || certainty === false) return
      if (pattern.type === 'Identifier') {
        const previous = aliases.get(pattern.name)
        aliases.set(pattern.name, certainty === 'maybe' && previous
          ? { type: 'ConditionalExpression', test: { type: 'Identifier', name: '__dynamic_branch__' }, consequent: value, alternate: previous }
          : value)
        return
      }
      if (pattern.type === 'AssignmentPattern') { bindAliasPattern(pattern.left, value || pattern.right, certainty); return }
      if (pattern.type === 'ObjectPattern') for (const property of pattern.properties) if (property.type !== 'RestElement') bindAliasPattern(property.value, aliasMember(value, staticPropertyKey(property.key)), certainty)
      if (pattern.type === 'ArrayPattern') for (let index = 0; index < pattern.elements.length; index += 1) if (pattern.elements[index]?.type !== 'RestElement') bindAliasPattern(pattern.elements[index], aliasMember(value, index), certainty)
    }
    walkScriptAst(ast.program, node => {
      if (node.type === 'FunctionDeclaration' && node.id) { helpers.set(node.id.name, node); aliases.set(node.id.name, node) }
      if (node.type === 'VariableDeclarator' && node.init) {
        const certainty = reachability(node)
        bindAliasPattern(node.id, node.init, certainty)
        if (certainty !== false && node.id?.type === 'Identifier' && ['ArrowFunctionExpression', 'FunctionExpression'].includes(unwrapExpression(node.init)?.type)) helpers.set(node.id.name, unwrapExpression(node.init))
      }
      if (node.type === 'AssignmentExpression' && node.operator === '=' && ['Identifier', 'ObjectPattern', 'ArrayPattern'].includes(node.left?.type)) bindAliasPattern(node.left, node.right, reachability(node))
    })
    const memberName = node => {
      const property = unwrapExpression(node?.property)
      if (!node?.computed && property?.type === 'Identifier') return property.name
      return node?.computed && ['StringLiteral', 'NumericLiteral'].includes(property?.type) ? String(property.value) : undefined
    }
    const memberValue = (object, name, resolving = new Set()) => {
      object = unwrapExpression(object)
      if (!object || resolving.size > 32) return undefined
      if (object.type === 'Identifier' && aliases.has(object.name) && !resolving.has(object.name)) return memberValue(aliases.get(object.name), name, new Set(resolving).add(object.name))
      if (object.type === 'ArrayExpression') return object.elements[Number(name)]
      if (object.type !== 'ObjectExpression') return undefined
      let found
      for (const property of object.properties) {
        if (property.type === 'SpreadElement') {
          const spread = memberValue(property.argument, name, resolving)
          if (spread) found = spread
        } else if (String(property.key?.name ?? property.key?.value) === String(name)) found = property.type === 'ObjectMethod' ? property : property.value
      }
      return found
    }
    const optionValues = (node, resolving = new Set()) => {
      node = unwrapExpression(node)
      if (!node || resolving.size > 32) return []
      if (node.type === 'Identifier' && aliases.has(node.name) && !resolving.has(node.name)) return optionValues(aliases.get(node.name), new Set(resolving).add(node.name))
      if (['MemberExpression', 'OptionalMemberExpression'].includes(node.type)) {
        const value = memberValue(node.object, memberName(node), resolving)
        return value ? optionValues(value, resolving) : []
      }
      if (node.type === 'ConditionalExpression') {
        const condition = staticValue(node.test)
        return condition !== unknownStaticValue ? optionValues(condition ? node.consequent : node.alternate, resolving) : [...optionValues(node.consequent, resolving), ...optionValues(node.alternate, resolving)]
      }
      if (node.type === 'SequenceExpression') return optionValues(node.expressions.at(-1), resolving)
      return [node]
    }
    const replaceFactoryParams = (node, replacements, parent, key) => {
      node = unwrapExpression(node)
      if (!node || typeof node !== 'object') return node
      if (node.type === 'Identifier' && replacements.has(node.name)) {
        const staticKey = parent?.type === 'MemberExpression' && key === 'property' && !parent.computed || ['ObjectProperty', 'ObjectMethod'].includes(parent?.type) && key === 'key' && !parent.computed
        if (!staticKey) return replacements.get(node.name)
      }
      let scopedReplacements = replacements
      if (['FunctionExpression', 'ArrowFunctionExpression', 'FunctionDeclaration', 'ObjectMethod'].includes(node.type)) {
        scopedReplacements = new Map(replacements)
        const remove = pattern => {
          pattern = unwrapExpression(pattern)
          if (pattern?.type === 'Identifier') scopedReplacements.delete(pattern.name)
          else if (pattern?.type === 'AssignmentPattern') remove(pattern.left)
          else if (pattern?.type === 'RestElement') remove(pattern.argument)
          else if (pattern?.type === 'ObjectPattern') for (const property of pattern.properties) remove(property.type === 'RestElement' ? property.argument : property.value)
          else if (pattern?.type === 'ArrayPattern') for (const item of pattern.elements) remove(item)
        }
        for (const parameter of node.params || []) remove(parameter)
        if (node.id) remove(node.id)
      }
      const copy = {}
      let changed = false
      for (const [childKey, child] of Object.entries(node)) {
        copy[childKey] = ['loc', 'start', 'end', 'extra'].includes(childKey) ? child : Array.isArray(child) ? child.map(item => replaceFactoryParams(item, scopedReplacements, node, childKey)) : replaceFactoryParams(child, scopedReplacements, node, childKey)
        if (copy[childKey] !== child) changed = true
      }
      return changed ? copy : node
    }
    const optionFactoryReturns = (fn, args) => {
      const replacements = new Map()
      for (let index = 0; index < (fn.params || []).length; index += 1) if (fn.params[index]?.type === 'Identifier' && args[index]) replacements.set(fn.params[index].name, args[index])
      if (fn.body?.type !== 'BlockStatement') return [replaceFactoryParams(fn.body, replacements)]
      const values = []
      for (const statement of fn.body.body) {
        if (statement.type === 'VariableDeclaration') {
          for (const declaration of statement.declarations) {
            if (declaration.id?.type !== 'Identifier' || !declaration.init) return []
            const initializer = replaceFactoryParams(declaration.init, replacements)
            if (['CallExpression', 'OptionalCallExpression', 'NewExpression', 'AwaitExpression'].includes(initializer?.type)) return []
            replacements.set(declaration.id.name, initializer)
          }
        } else if (statement.type === 'ReturnStatement' && statement.argument) values.push(replaceFactoryParams(statement.argument, replacements))
        else if (statement.type !== 'EmptyStatement' && statement.type !== 'FunctionDeclaration') return []
      }
      return values
    }
    const optionMaps = (node, resolving = new Set()) => optionValues(node, resolving).flatMap(candidate => {
      if (['CallExpression', 'OptionalCallExpression'].includes(candidate?.type)) {
        const callees = optionValues(candidate.callee, resolving)
        if (callees.some(callee => callee?.type === 'Identifier' && defineComponentNames.has(callee.name))) return optionMaps(candidate.arguments[0], resolving)
        const functions = callees.filter(callee => ['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'].includes(callee?.type))
        return functions.flatMap(fn => optionFactoryReturns(fn, candidate.arguments).flatMap(returned => optionMaps(returned, resolving)))
      }
      if (candidate?.type !== 'ObjectExpression') return []
      const map = new Map()
      for (const property of candidate.properties) {
        if (property.type === 'SpreadElement') for (const spread of optionMaps(property.argument, resolving)) for (const [name, value] of spread) map.set(name, value)
        else map.set(staticPropertyKey(property.key), propertyExpression(property))
      }
      return [map]
    })
    const optionNullish = (expression, local, chain = false) => {
      expression = unwrapExpression(replaceFactoryParams(expression, local))
      if (expression?.type === 'ChainExpression') return optionNullish(expression.expression, local, true)
      if (!expression) return 'unknown'
      if (expression.type === 'NullLiteral' || expression.type === 'Identifier' && expression.name === 'undefined' || expression.type === 'UnaryExpression' && expression.operator === 'void') return 'nullish'
      if (['StringLiteral', 'NumericLiteral', 'BooleanLiteral', 'BigIntLiteral', 'ObjectExpression', 'ArrayExpression', 'ArrowFunctionExpression', 'FunctionExpression', 'FunctionDeclaration', 'ObjectMethod'].includes(expression.type)) return 'nonnull'
      if (['MemberExpression', 'OptionalMemberExpression'].includes(expression.type)) {
        const receiver = optionNullish(expression.object, local, chain || expression.type === 'OptionalMemberExpression')
        if (receiver === 'short-circuit') return chain || expression.type === 'OptionalMemberExpression' ? 'short-circuit' : 'unknown'
        if (receiver === 'nullish') return expression.optional ? 'short-circuit' : 'unknown'
        if (receiver !== 'nonnull') return 'unknown'
        const object = unwrapExpression(replaceFactoryParams(expression.object, local))
        const name = memberName(expression)
        if (object?.type === 'ObjectExpression' && name !== undefined) {
          const value = memberValue(object, name)
          return value ? optionNullish(value, local) : 'nullish'
        }
        return 'unknown'
      }
      if (expression.type === 'OptionalCallExpression') {
        const callee = optionNullish(expression.callee, local, chain)
        if (callee === 'short-circuit' || expression.optional && callee === 'nullish') return 'short-circuit'
      }
      return 'unknown'
    }
    const optionEffect = (expression, local, chain = false) => {
      expression = unwrapExpression(replaceFactoryParams(expression, local))
      if (!expression) return 'cannotThrow'
      if (expression.type === 'ChainExpression') return optionEffect(expression.expression, local, true)
      if (['StringLiteral', 'NumericLiteral', 'BooleanLiteral', 'NullLiteral', 'BigIntLiteral', 'ObjectExpression', 'ArrayExpression', 'ArrowFunctionExpression', 'FunctionExpression', 'FunctionDeclaration', 'ObjectMethod', 'Identifier'].includes(expression.type)) return 'cannotThrow'
      if (['MemberExpression', 'OptionalMemberExpression'].includes(expression.type)) {
        const receiverEffect = optionEffect(expression.object, local, chain || expression.type === 'OptionalMemberExpression')
        if (receiverEffect === 'mustThrow') return 'mustThrow'
        const receiver = optionNullish(expression.object, local, chain || expression.type === 'OptionalMemberExpression')
        if (receiver === 'short-circuit') return chain || expression.type === 'OptionalMemberExpression' ? receiverEffect : 'mustThrow'
        if (receiver === 'nullish') return expression.optional ? receiverEffect : receiverEffect === 'cannotThrow' ? 'mustThrow' : 'mayThrow'
        if (receiver === 'unknown') return 'mayThrow'
        return receiverEffect
      }
      if (['CallExpression', 'OptionalCallExpression'].includes(expression.type)) {
        const calleeEffect = optionEffect(expression.callee, local, chain || expression.type === 'OptionalCallExpression')
        if (calleeEffect === 'mustThrow') return 'mustThrow'
        const calleeNullish = optionNullish(expression.callee, local, chain || expression.type === 'OptionalCallExpression')
        if (((chain || expression.type === 'OptionalCallExpression') && calleeNullish === 'short-circuit') || (expression.optional && calleeNullish === 'nullish')) return calleeEffect
        const callees = optionValues(expression.callee)
        const functions = callees.filter(callee => ['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'].includes(callee?.type))
        return functions.length && functions.every(fn => optionFactoryReturns(fn, expression.arguments).length > 0) ? 'cannotThrow' : 'mayThrow'
      }
      if (expression.type === 'SequenceExpression') {
        let uncertain = false
        for (const item of expression.expressions) {
          const effect = optionEffect(item, local)
          if (effect === 'mustThrow') return uncertain ? 'mayThrow' : 'mustThrow'
          if (effect === 'mayThrow') uncertain = true
        }
        return uncertain ? 'mayThrow' : 'cannotThrow'
      }
      return 'cannotThrow'
    }
    const bindTopPattern = (pattern, value, target) => {
      pattern = unwrapExpression(pattern)
      if (pattern?.type === 'Identifier') { target.set(pattern.name, value); return }
      if (pattern?.type === 'AssignmentPattern') { bindTopPattern(pattern.left, value || pattern.right, target); return }
      if (pattern?.type === 'ObjectPattern') for (const property of pattern.properties) if (property.type !== 'RestElement') bindTopPattern(property.value, aliasMember(value, staticPropertyKey(property.key)), target)
      if (pattern?.type === 'ArrayPattern') for (let index = 0; index < pattern.elements.length; index += 1) if (pattern.elements[index]?.type !== 'RestElement') bindTopPattern(pattern.elements[index], aliasMember(value, index), target)
    }
    const topLevelFlow = (statements, initial, catches = false) => {
      const hoisted = new Map(initial)
      for (const raw of statements || []) {
        const statement = raw?.type === 'ExportNamedDeclaration' ? raw.declaration : raw
        if (statement?.type === 'FunctionDeclaration' && statement.id) hoisted.set(statement.id.name, statement)
      }
      let paths = [{ kind: 'normal', bindings: hoisted, exports: [] }]
      const flowOne = (statement, path, catchesHere) => {
        if (!statement) return [path]
        if (statement.type === 'BlockStatement') return topLevelFlow(statement.body, path.bindings, catchesHere).map(result => ({ ...result, exports: path.exports.concat(result.exports) }))
        if (statement.type === 'ExportDefaultDeclaration') return [{ ...path, exports: path.exports.concat(replaceFactoryParams(statement.declaration, path.bindings)) }]
        if (statement.type === 'ThrowStatement') return [{ ...path, kind: 'throw' }]
        if (statement.type === 'FunctionDeclaration' || statement.type === 'ImportDeclaration' || statement.type === 'EmptyStatement') return [path]
        if (statement.type === 'VariableDeclaration') {
          const next = new Map(path.bindings)
          let effect = 'cannotThrow'
          for (const declaration of statement.declarations) {
            const current = optionEffect(declaration.init, next)
            if (current === 'mustThrow') effect = 'mustThrow'
            else if (current === 'mayThrow' && effect === 'cannotThrow') effect = 'mayThrow'
            if (current !== 'mustThrow') bindTopPattern(declaration.id, declaration.init || { type: 'Identifier', name: 'undefined' }, next)
          }
          const results = effect === 'mustThrow' ? [] : [{ ...path, bindings: next }]
          if (catchesHere && effect !== 'cannotThrow') results.push({ ...path, kind: 'throw' })
          return results
        }
        if (statement.type === 'ExpressionStatement' && statement.expression?.type === 'AssignmentExpression' && statement.expression.operator === '=') {
          const effect = optionEffect(statement.expression.right, path.bindings)
          const results = []
          if (effect !== 'mustThrow') {
            const next = new Map(path.bindings)
            bindTopPattern(statement.expression.left, statement.expression.right, next)
            results.push({ ...path, bindings: next })
          }
          if (catchesHere && effect !== 'cannotThrow') results.push({ ...path, kind: 'throw' })
          return results
        }
        if (statement.type === 'IfStatement') {
          const condition = staticValue(replaceFactoryParams(statement.test, path.bindings))
          return condition !== unknownStaticValue
            ? flowOne(condition ? statement.consequent : statement.alternate, { ...path, bindings: new Map(path.bindings) }, catchesHere)
            : [...flowOne(statement.consequent, { ...path, bindings: new Map(path.bindings) }, catchesHere), ...flowOne(statement.alternate, { ...path, bindings: new Map(path.bindings) }, catchesHere)]
        }
        if (statement.type === 'TryStatement') {
          let results = flowOne(statement.block, { ...path, bindings: new Map(path.bindings) }, true).flatMap(result => result.kind === 'throw' && statement.handler
            ? flowOne(statement.handler.body, { ...result, kind: 'normal', bindings: new Map(result.bindings) }, false)
            : [result])
          if (statement.finalizer) results = results.flatMap(result => flowOne(statement.finalizer, { ...result, kind: 'normal', bindings: new Map(result.bindings) }, true).map(finalResult => finalResult.kind === 'normal' ? { ...result, bindings: finalResult.bindings, exports: finalResult.exports } : finalResult))
          return results
        }
        const effect = optionEffect(statement.expression, path.bindings)
        const results = effect === 'mustThrow' ? [] : [path]
        if (catchesHere && effect !== 'cannotThrow') results.push({ ...path, kind: 'throw' })
        return results
      }
      for (const statement of statements || []) paths = paths.flatMap(path => path.kind === 'normal' ? flowOne(statement, path, catches) : [path])
      return paths
    }
    const topLevelPaths = topLevelFlow(ast.program.body, new Map()).filter(path => path.kind === 'normal')
    exportedOptions.splice(0, exportedOptions.length, ...topLevelPaths.flatMap(path => path.exports))
    if (topLevelPaths.length) {
      const names = new Set(topLevelPaths.flatMap(path => [...path.bindings.keys()]))
      for (const name of names) {
        const candidates = [...new Set(topLevelPaths.map(path => path.bindings.get(name)).filter(Boolean))]
        if (candidates.length) aliases.set(name, candidates.slice(1).reduce((alternate, consequent) => ({
          type: 'ConditionalExpression', test: { type: 'Identifier', name: '__dynamic_branch__' }, consequent, alternate,
        }), candidates[0]))
      }
    }
    const exportedScopeGroups = exportedOptions.flatMap(expression => {
      const maps = optionMaps(expression)
      return maps.length ? maps.map(options => {
        const scopes = new Set()
        const name = options.has('render') ? 'render' : 'setup'
        const scope = options.get(name)
        if (scope) for (const candidate of optionValues(scope)) if (['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression', 'ObjectMethod'].includes(candidate?.type)) { scopes.add(candidate); componentScopes.add(candidate) }
        return { known: true, scopes }
      }) : [{ known: false, scopes: new Set() }]
    })
    for (const pending = [...componentScopes]; pending.length;) {
      const scope = pending.shift()
      if (scope?.body?.type !== 'BlockStatement') for (const candidate of optionValues(scope.body)) {
        if (['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression', 'ObjectMethod'].includes(candidate?.type) && !componentScopes.has(candidate)) { componentScopes.add(candidate); pending.push(candidate) }
      }
      walkScriptAst(scope?.body, node => {
        if (node.type !== 'ReturnStatement' || nearestFunction(node) !== scope || !node.argument) return
        for (const candidate of optionValues(node.argument)) if (['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression', 'ObjectMethod'].includes(candidate?.type) && !componentScopes.has(candidate)) { componentScopes.add(candidate); pending.push(candidate) }
      })
    }
    const resolvesTarget = (node, resolving = new Set()) => {
      node = unwrapExpression(node)
      if (!node || resolving.size > 32) return false
      if (node.type === 'Identifier') {
        if (resolving.has(node.name)) return false
        if (targets.has(node.name)) return true
        return aliases.has(node.name) && resolvesTarget(aliases.get(node.name), new Set(resolving).add(node.name))
      }
      if (['MemberExpression', 'OptionalMemberExpression'].includes(node.type)) {
        const value = memberValue(node.object, memberName(node), resolving)
        return value ? resolvesTarget(value, resolving) : false
      }
      return false
    }
    const vueNamespaceReference = (node, resolving = new Set()) => {
      node = unwrapExpression(node)
      if (node?.type !== 'Identifier' || resolving.has(node.name)) return false
      if (vueNamespaces.has(node.name)) return true
      return aliases.has(node.name) && vueNamespaceReference(aliases.get(node.name), new Set(resolving).add(node.name))
    }
    const builtinVNodeKind = (node, resolving = new Set()) => {
      node = unwrapExpression(node)
      if (!node || resolving.size > 32) return undefined
      if (node.type === 'Identifier') {
        if (vnodeKinds.has(node.name)) return vnodeKinds.get(node.name)
        return aliases.has(node.name) && !resolving.has(node.name) ? builtinVNodeKind(aliases.get(node.name), new Set(resolving).add(node.name)) : undefined
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
      node = unwrapExpression(node)
      if (!node || resolving.size > 32) return []
      if (node.type === 'StringLiteral') return [{ node, kind: 'native', truthy: Boolean(node.value) }]
      if (node.type === 'NullLiteral' || (node.type === 'Identifier' && node.name === 'undefined') || (node.type === 'UnaryExpression' && node.operator === 'void') || (node.type === 'BooleanLiteral' && node.value === false)) return [{ node, kind: 'nullish', truthy: false }]
      if (node.type === 'Identifier') {
        if (aliases.has(node.name) && !resolving.has(node.name)) return resolvedVNodeOutcomes(aliases.get(node.name), new Set(resolving).add(node.name))
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
        return condition !== unknownStaticValue
          ? resolvedVNodeOutcomes(condition ? node.consequent : node.alternate, resolving)
          : [...resolvedVNodeOutcomes(node.consequent, resolving), ...resolvedVNodeOutcomes(node.alternate, resolving)]
      }
      if (node.type === 'LogicalExpression') {
        const left = staticValue(node.left)
        if (left !== unknownStaticValue) {
          const usesRight = node.operator === '&&' ? Boolean(left) : node.operator === '||' ? !left : left == null
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
      return [{ node, kind: value !== unknownStaticValue && !value ? 'nullish' : 'unknown', truthy: value === unknownStaticValue ? undefined : Boolean(value) }]
    }
    const renderExpressionEffect = (node, chain = false) => {
      node = unwrapExpression(node)
      if (!node) return 'cannotThrow'
      if (node.type === 'ChainExpression') return renderExpressionEffect(node.expression, true)
      if (['StringLiteral', 'NumericLiteral', 'BooleanLiteral', 'NullLiteral', 'BigIntLiteral', 'ObjectExpression', 'ArrayExpression', 'ArrowFunctionExpression', 'FunctionExpression', 'FunctionDeclaration', 'ObjectMethod', 'Identifier'].includes(node.type)) return 'cannotThrow'
      if (['MemberExpression', 'OptionalMemberExpression'].includes(node.type)) {
        const object = unwrapExpression(node.object)
        const nested = renderExpressionEffect(node.object, chain || node.type === 'OptionalMemberExpression')
        if (nested === 'mustThrow') return 'mustThrow'
        const nullish = object?.type === 'NullLiteral' || object?.type === 'Identifier' && object.name === 'undefined' || object?.type === 'UnaryExpression' && object.operator === 'void'
        if (nullish) return node.optional ? nested : nested === 'cannotThrow' ? 'mustThrow' : 'mayThrow'
        return ['ObjectExpression', 'ArrayExpression', 'StringLiteral', 'NumericLiteral', 'BooleanLiteral'].includes(object?.type) ? nested : 'mayThrow'
      }
      if (['CallExpression', 'OptionalCallExpression'].includes(node.type)) {
        const callee = unwrapExpression(node.callee)
        if (callee?.type === 'Identifier' && renderNames.has(callee.name)) return 'cannotThrow'
        return 'mayThrow'
      }
      return 'cannotThrow'
    }
    const returns = body => {
      body = unwrapExpression(body)
      if (!body) return [undefined]
      if (body.type !== 'BlockStatement') return [body]
      const statements = (items, seed = [{ kind: 'normal' }], catches = false) => {
        let paths = seed
        for (const statement of items || []) paths = paths.flatMap(path => path.kind === 'normal' ? one(statement, catches) : [path])
        return paths
      }
      const one = (node, catches = false) => {
        if (!node) return [{ kind: 'normal' }]
        if (node.type === 'BlockStatement') return statements(node.body, [{ kind: 'normal' }], catches)
        if (node.type === 'ReturnStatement') {
          const effect = renderExpressionEffect(node.argument)
          const result = effect === 'mustThrow' ? [] : [{ kind: 'return', expression: node.argument }]
          if (catches && effect !== 'cannotThrow') result.push({ kind: 'throw' })
          return result
        }
        if (node.type === 'ThrowStatement') return [{ kind: 'throw' }]
        if (node.type === 'IfStatement') {
          const condition = staticValue(node.test)
          return condition !== unknownStaticValue ? one(condition ? node.consequent : node.alternate, catches) : [...one(node.consequent, catches), ...one(node.alternate, catches)]
        }
        if (node.type === 'TryStatement') {
          let paths = one(node.block, true).flatMap(path => path.kind === 'throw' && node.handler ? one(node.handler.body, false) : [path])
          if (node.finalizer) paths = paths.flatMap(path => one(node.finalizer, true).flatMap(finalPath => finalPath.kind === 'normal' ? [path] : [finalPath]))
          return paths
        }
        if (node.type === 'SwitchStatement') {
          const condition = staticValue(node.discriminant)
          const fallback = node.cases.findIndex(branch => !branch.test)
          const matched = condition !== unknownStaticValue ? node.cases.findIndex(branch => branch.test && staticValue(branch.test) !== unknownStaticValue && Object.is(staticValue(branch.test), condition)) : -1
          const entries = condition !== unknownStaticValue ? [matched >= 0 ? matched : fallback].filter(index => index >= 0) : node.cases.map((_, index) => index).concat(fallback < 0 ? [-1] : [])
          return entries.flatMap(entry => entry < 0 ? [{ kind: 'normal' }] : statements(node.cases.slice(entry).flatMap(branch => branch.consequent), [{ kind: 'normal' }], catches))
        }
        const expression = node.type === 'ExpressionStatement' ? node.expression : node.type === 'VariableDeclaration' ? node.declarations.map(item => item.init).filter(Boolean) : undefined
        const effects = (Array.isArray(expression) ? expression : [expression]).map(value => renderExpressionEffect(value))
        const must = effects.includes('mustThrow')
        const may = effects.includes('mayThrow')
        const result = must ? [] : [{ kind: 'normal' }]
        if (catches && (must || may)) result.push({ kind: 'throw' })
        return result
      }
      return statements(body.body).filter(path => path.kind !== 'throw').map(path => path.kind === 'return' ? path.expression : undefined)
    }
    const inspect = (node, resolving = new Set()) => {
      node = unwrapExpression(node)
      if (!node) return false
      if (node.type === 'Identifier' && helpers.has(node.name) && !resolving.has(node.name)) { const values = returns(helpers.get(node.name).body); return values.length > 0 && values.every(result => inspect(result, new Set(resolving).add(node.name))) }
      if (['ArrowFunctionExpression', 'FunctionExpression', 'FunctionDeclaration'].includes(node.type)) { const values = returns(node.body); return values.length > 0 && values.every(result => inspect(result, resolving)) }
      if (node.type === 'ConditionalExpression') {
        const condition = staticValue(node.test)
        return condition !== unknownStaticValue ? inspect(condition ? node.consequent : node.alternate, resolving) : inspect(node.consequent, resolving) && inspect(node.alternate, resolving)
      }
      if (node.type === 'LogicalExpression') {
        const left = staticValue(node.left)
        if (left !== unknownStaticValue) return inspect(node.left, resolving) || ((node.operator === '&&' ? Boolean(left) : node.operator === '||' ? !left : left == null) && inspect(node.right, resolving))
        return inspect(node.left, resolving) && inspect(node.right, resolving)
      }
      if (node.type === 'SequenceExpression') return inspect(node.expressions.at(-1), resolving)
      if (node.type === 'ArrayExpression') return node.elements.some(item => inspect(item, resolving))
      if (!['CallExpression', 'OptionalCallExpression'].includes(node.type)) return false
      if (node.callee?.type === 'Identifier' && renderNames.has(node.callee.name)) {
        if (resolvesTarget(node.arguments[0])) return true
        const vnodeTypes = resolvedVNodeOutcomes(node.arguments[0])
        const rendersChildren = vnodeTypes.length === 0 || vnodeTypes.some(type => ['native', 'component', 'unknown', 'fragment'].includes(type.kind))
        const executesSlots = vnodeTypes.length === 0 || vnodeTypes.some(type => ['component', 'unknown'].includes(type.kind))
        const executesDirectFunction = vnodeTypes.length === 0 || vnodeTypes.some(type => ['native', 'component', 'unknown'].includes(type.kind))
        const children = node.arguments.length >= 3 ? node.arguments.slice(2) : node.arguments.slice(1)
        const inspectRenderedChild = (child, arrayValue = false) => {
          child = unwrapExpression(child)
          if (!child) return false
          if (child.type === 'ArrayExpression') return rendersChildren && child.elements.some(value => inspectRenderedChild(value, true))
          if (['ArrowFunctionExpression', 'FunctionExpression'].includes(child.type)) return !arrayValue && executesDirectFunction && returns(child.body).some(result => inspect(result, resolving))
          if (child.type === 'ObjectExpression') return executesSlots && child.properties.some(property => inspect(property.type === 'ObjectMethod' ? property : property.value, resolving))
          return rendersChildren && inspect(child, resolving)
        }
        return children.some(inspectRenderedChild)
      }
      if (node.callee?.type !== 'Identifier' || !helpers.has(node.callee.name) || resolving.has(node.callee.name)) return false
      const values = returns(helpers.get(node.callee.name).body)
      return values.length > 0 && values.every(result => inspect(result, new Set(resolving).add(node.callee.name)))
    }
    if (exportedScopeGroups.length > 0 && exportedScopeGroups.every(({ known, scopes }) => known && scopes.size > 0 && [...scopes].every(scope => {
      const values = returns(scope?.body)
      return values.length > 0 && values.every(result => inspect(result))
    }))) return true
  }
  return false
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
const templateBindingPatterns = (value, label) => {
  const parameters = String(value || '').trim().replace(/^\(([\s\S]*)\)$/, '$1')
  if (!parameters) return []
  try { return vueCompiler.babelParse(`(${parameters}) => 0`, { sourceType: 'module', plugins: ['typescript'] }).program.body[0]?.expression?.params || [] }
  catch (error) { throw new Error(`${label} must parse cleanly: ${error.message}`, { cause: error }) }
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
  const loop = node.props?.find(prop => prop.type === 7 && prop.name === 'for')?.exp?.content?.match(/^\s*(.*?)\s+(?:in|of)\s+([\s\S]+)$/)
  if (loop) {
    let sourceAst
    try { sourceAst = vueCompiler.babelParse(`(${loop[2]})`, { sourceType: 'module', plugins: ['typescript'] }).program.body[0]?.expression }
    catch (error) { throw new Error(`v-for source must parse cleanly: ${error.message}`, { cause: error }) }
    const values = staticIterationValues(sourceAst, bindings)
    const patterns = templateBindingPatterns(loop[1], 'v-for aliases')
    for (let index = 0; index < patterns.length; index += 1) bindTemplatePattern(patterns[index], index === 0 ? values : [], scoped)
  }
  for (const slot of node.props?.filter(prop => prop.type === 7 && prop.name === 'slot' && prop.exp?.content) || []) {
    for (const pattern of templateBindingPatterns(slot.exp.content, 'slot props')) bindTemplatePattern(pattern, [], scoped)
  }
  return scoped
}
const visibleStrings = value => {
  const result = []
  const bindings = staticBindingInitializers(value)
  const visibleAttributes = new Set(['alt', 'aria-label', 'placeholder', 'title', 'value'])
  const visit = (node, inheritedBindings = bindings) => {
    const scopedBindings = node.type === 1 ? bindingsForElement(node, inheritedBindings) : inheritedBindings
    if (node.type === 2 && node.content.trim()) result.push(node.content.trim())
    if (node.type === 5) result.push(...literalExpressionStrings(node.content.content, scopedBindings))
    if (node.type === 1) for (const prop of node.props) {
      if (prop.type === 6 && visibleAttributes.has(prop.name) && prop.value?.content) result.push(prop.value.content)
      const visibleBinding = prop.type === 7 && prop.name === 'bind' && prop.arg?.type === 4 && prop.arg.isStatic && visibleAttributes.has(prop.arg.content)
      const visibleDirective = prop.type === 7 && ['text', 'html'].includes(prop.name)
      if ((visibleBinding || visibleDirective) && prop.exp?.content) result.push(...literalExpressionStrings(prop.exp.content, scopedBindings))
    }
    for (const child of new Set(reachableChildPaths(node).flat())) visit(child, scopedBindings)
    for (const branch of reachableVueBranches(node)) visit(branch, scopedBindings)
  }
  visit(templateAst(value))
  return result
}
const stringValues = value => {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.flatMap(stringValues)
  if (value && typeof value === 'object') return Object.values(value).flatMap(stringValues)
  return []
}
const routePathsByName = (() => {
  const paths = new Map()
  const visit = (items, parent = '') => {
    for (const route of items) {
      const path = route.path.startsWith('/') ? route.path : route.path ? `${parent.replace(/\/$/, '')}/${route.path}` : (parent || '/')
      if (route.name) paths.set(route.name, path)
      if (route.children) visit(route.children, path)
    }
  }
  visit(routes)
  return paths
})()
const routerLinkTargets = value => elements(value, 'RouterLink').flatMap(node => {
  const direct = staticAttribute(node, 'to')
  if (direct) return [direct]
  const binding = boundAttribute(node, 'to')
  const path = binding?.match(/(?:^|\{|,)\s*path\s*:\s*["']([^"']+)["']/)?.[1] || binding?.match(/^\s*["']([^"']+)["']\s*$/)?.[1]
  if (path) return [path]
  const name = binding?.match(/(?:^|\{|,)\s*name\s*:\s*["']([^"']+)["']/)?.[1]
  return name && routePathsByName.has(name) ? [routePathsByName.get(name)] : []
})
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
  [/40\+/i, 'prototype model count'],
  [/100%/i, 'prototype percentage claim'],
  [/MIT License/i, 'prototype license claim'],
  [/Tailwind\s+CDN/i, 'Tailwind CDN claim'],
  [/(?:admin|demo)(?:@[^\s<"']+)?\s*(?:\/|:|：)\s*(?:admin|password|123456)/i, 'demo credentials'],
  [/\b(?:admin|demo)@[A-Z0-9._%+-]+\.[A-Z]{2,}\b/i, 'demo account email'],
  [/(?:password|密码)\s*[:=：]\s*["']?(?:admin\d*|demo\d*|123456(?:78)?)/i, 'demo password'],
  [/(?:API[_ -]?KEY\s*[=:]\s*["']?(?:sk-)?[A-Za-z0-9_-]{8,}|sk-[A-Za-z0-9_-]{8,})/i, 'demo API credential'],
  [/\d+(?:\.\d+)?\s*(?:x|×|倍)(?![\w-])/i, 'prototype multiplier'],
  [numericPerRequestOffer, 'numeric per-request price offer'],
]
const tailwindUrl = /(?:https?:)?\/\/[^\s"')]*(?:cdn\.tailwindcss\.com|tailwind)[^\s"')]*/i
const assertNoTailwindLoading = (cssSources, vueSources) => {
  const descriptors = vueSources.map(value => parseVue(value))
  for (const css of cssSources.concat(descriptors.flatMap(descriptor => descriptor.styles.map(style => style.content)))) {
    const executableCss = css.replace(/\/\*[\s\S]*?\*\//g, '')
    for (const match of executableCss.matchAll(/@(?:import|use)\s+([^;{}]+)/gi)) assert.doesNotMatch(match[1], tailwindUrl, 'public styles must not import Tailwind from a CDN')
    for (const match of executableCss.matchAll(/\burl\(\s*([^)]+)\)/gi)) assert.doesNotMatch(match[1], tailwindUrl, 'public styles must not load a Tailwind CDN URL')
  }
  for (const descriptor of descriptors) {
    const externalSources = [descriptor.script?.src, descriptor.scriptSetup?.src]
      .concat(descriptor.styles.map(style => style.src), descriptor.customBlocks.map(block => block.src))
      .filter(Boolean)
    for (const url of externalSources) assert.doesNotMatch(url, tailwindUrl, 'public Vue blocks must not load Tailwind from a CDN')
  }
  for (const vue of vueSources) for (const name of ['script', 'link']) for (const node of elements(vue, name)) {
    const url = staticAttribute(node, name === 'script' ? 'src' : 'href')
    if (url) assert.doesNotMatch(url, tailwindUrl, 'public template sources must not load Tailwind from a CDN')
  }
}

test('public shell and homepage preserve the published-content contract', () => {
  const layout = source('../../layouts/PublicLayout.vue')
  const home = source('./Home.vue')
  const header = source('../../components/public/PublicHeader.vue')
  const footer = source('../../components/public/PublicFooter.vue')
  assert.equal(renderFunctionUsesImportedComponent(layout, 'PublicHeader.vue'), true, 'public layout renders its imported header from a reachable render root')
  assert.equal(renderFunctionUsesImportedComponent(layout, 'PublicFooter.vue'), true, 'public layout renders its imported footer from a reachable render root')
  assert.deepEqual(dataSectionOrder(home), ['hero', 'proof', 'advantages', 'models', 'announcements-faq', 'cta'])
  assert.match(home, /演示|demo/i)
  assert.match(home, /releaseVersion/)
  assert.match(home, /localStorage/)
  assert.match(layout, /usePublicContentStore/)
  assert.match(layout, /provide\(['"]public-home-publication['"]/)
  assert.match(layout, /createPublicLayoutPublication/)
  assert.match(layout, /onUnmounted\(lifecycle\.dispose\)/)
  assert.doesNotMatch(layout, /publicContentApi|getHome\(/)
  assert.match(home, /inject\(['"]public-home-publication['"]\)/)
  assert.doesNotMatch(home, /createPublicContentState|createPublishedDocumentCodec/)
  assert.doesNotMatch(home, /loadModels|pageSize/)
  assert.match(home, /state\.value\.site\.status === ['"]error['"] \? ['"]error['"]/)
  assert.match(home, /const load = \(\) => loadHome\(\)/)
  assert.match(home, /@retry\s*=\s*(["'])load\1/)
  const linkTargets = routerLinkTargets(home)
  assert.ok(linkTargets.includes('/chat'), 'homepage uses a RouterLink resolving to /chat')
  assert.ok(linkTargets.includes('/pricing'), 'homepage uses a RouterLink resolving to /pricing')
  assert.doesNotMatch(`${layout}${home}${header}${footer}`, /href=["']#["']/)
})

test('about and legal pages expose safe published states and metadata', () => {
  const about = source('./About.vue')
  const legal = source('./LegalPage.vue')
  const state = source('../../components/public/PublicContentState.vue')
  assert.match(about, /loadPage\(['"]about['"]\)/)
  assert.match(about, /inject\(['"]public-home-publication['"]\)/)
  assert.match(legal, /inject\(['"]public-home-publication['"]\)/)
  assert.doesNotMatch(`${about}${legal}`, /createPublicContentState/)
  assert.match(legal, /invalidatePage\(previous\)/)
  assert.match(legal, /onCleanup\([\s\S]*invalidatePage\(page\)/)
  assert.match(legal, /version/)
  assert.match(legal, /effectiveDate/)
  assert.match(legal, /table-of-contents|目录/)
  assert.match(legal, /createPublishedDocumentCodec/)
  assert.match(about, /createPublishedDocumentCodec/)
  assert.doesNotMatch(`${about}${legal}`, /JSON\.parse|frontmatter/i)
  assert.match(state, /loading/)
  assert.match(state, /preparing/)
  assert.match(state, /empty/)
  assert.match(state, /error/)
  assert.match(state, /retry/)
  assert.match(`${about}${legal}`, /<h1/)
  assert.equal((about.match(/<h1/g) || []).length, 1)
  assert.equal((legal.match(/<h1/g) || []).length, 1)
  assert.match(about, /content\.bodyHTML/)
  assert.match(legal, /content\.legalBodyHTML/)
  assert.match(`${about}${legal}${state}`, /\bt\('/)
})

test('public and administrative surfaces retain distinct state identifiers', () => {
  const home = source('./Home.vue')
  const state = source('../../components/public/PublicContentState.vue')
  const notFound = source('../PublicNotFound.vue')
  const detail = source('./ModelPricingDetail.vue')
  const publicApi = source('../../api/publicContent.js')
  const publicModelDetail = source('../PublicModelDetail.vue')

  for (const status of ['loading', 'preparing', 'idle', 'empty', 'ready-empty', 'error', 'not_found', 'gone']) {
    assert.match(state, new RegExp(`['"]${status}['"]`), status)
  }
  assert.match(home, /homeStatus !== ['"]ready['"]/)
  assert.match(home, /status=["']preparing["']/)
  assert.match(notFound, /(?:>|aria-label=["'][^"']*)404(?:<|["'])/)
  assert.match(publicApi, /401:\s*['"]authentication_required['"]/)
  assert.match(publicApi, /404:\s*['"]not_found['"]/)
  assert.match(publicApi, /410:\s*['"]gone['"]/)
  assert.match(publicApi, /503:\s*['"]unavailable['"]/)
  for (const status of ['not_found', 'gone', 'login_required', 'error']) {
    assert.match(detail, new RegExp(`slot\\.status === ['"]${status}['"]`), status)
  }
  assert.match(publicModelDetail, /revision_conflict/)
  assert.match(publicModelDetail, /root_required/)
  assert.match(publicModelDetail, /unavailable/)
})

test('public publication ownership remains in the layout and every consumer cancels its work', () => {
  const layout = source('../../layouts/PublicLayout.vue')
  const home = source('./Home.vue')
  const about = source('./About.vue')
  const legal = source('./LegalPage.vue')
  const pricing = source('./Pricing.vue')
  const detail = source('./ModelPricingDetail.vue')

  assert.match(layout, /provide\('public-home-publication', \{ store, publication, ready, loadHome: lifecycle\.loadHome, loadPage: lifecycle\.loadPage \}\)/)
  assert.match(layout, /onUnmounted\(lifecycle\.dispose\)/)
  for (const consumer of [home, about, legal, pricing, detail]) assert.match(consumer, /inject\(['"]public-home-publication['"]\)/)
  assert.match(pricing, /onBeforeUnmount\([\s\S]*store\.cancel\(['"]models['"]\)/)
  assert.match(detail, /onCleanup\(\(\) => store\.cancel\(`detail:\$\{key\}`\)\)/)
  assert.match(detail, /onBeforeUnmount\([\s\S]*store\.cancel\(`detail:\$\{modelKey\.value\}`\)/)
  assert.match(legal, /onCleanup\([\s\S]*invalidatePage\(page\)/)
})

test('public pages are lazy routes and styles cover themes, breakpoints and reduced motion', () => {
  const router = source('../../router/index.js')
  const shell = source('../../styles/public-shell.scss')
  assert.match(router, /import\(['"]@\/views\/public\/Home\.vue['"]\)/)
  assert.match(router, /import\(['"]@\/views\/public\/About\.vue['"]\)/)
  assert.match(router, /import\(['"]@\/views\/public\/LegalPage\.vue['"]\)/)
  assert.match(shell, /--public-primary:\s*var\(--color-brand\)/i)
  assert.match(shell, /prefers-color-scheme:\s*dark/)
  assert.match(shell, /prefers-reduced-motion:\s*reduce/)
  assert.match(shell, /max-width:\s*767px/)
  assert.match(shell, /min-width:\s*768px/)
  assert.match(shell, /max-width:\s*1279px/)
})

test('public content pages compose the approved safe landing system', () => {
  const home = source('./Home.vue')
  const hero = source('../../components/public/HeroPreview.vue')
  const section = source('../../components/public/PublicSection.vue')
  const styles = source('../../styles/public-content.scss')
  const about = source('./About.vue')
  const legal = source('./LegalPage.vue')
  const notFound = source('../PublicNotFound.vue')
  const preview = source('../PublicContentPreview.vue')
  const layout = source('../../layouts/PublicLayout.vue')
  const header = source('../../components/public/PublicHeader.vue')
  const footer = source('../../components/public/PublicFooter.vue')
  const publicComponents = readdirSync(new URL('../../components/public/', import.meta.url))
    .filter(file => file.endsWith('.vue'))
    .map(file => source(`../../components/public/${file}`))
  const vueSources = [layout, header, footer, home, hero, section, about, legal, notFound, preview, ...publicComponents]
  const publicStyleSources = [
    source('../../styles/public-content.scss'),
    source('../../styles/public-shell.scss'),
    source('../../styles/public-pricing.scss'),
  ]
  const runtimePublicMessages = [messages, publicMessages]
    .flatMap(catalog => Object.values(catalog).flatMap(locale => stringValues(locale.publicSite)))
  assert.ok(runtimePublicMessages.length > 0, 'runtime publicSite messages must exist')
  const visibleCopy = vueSources.flatMap(visibleStrings).concat(runtimePublicMessages)

  assertNoTailwindLoading(publicStyleSources, vueSources)

  assert.equal(renderedComponentIsWired(home, 'HeroPreview', 'HeroPreview.vue'), 1, 'the rendered home tree contains one reachable hero imported from HeroPreview.vue')
  assert.ok(renderedComponentIsWired(home, 'PublicSection', 'PublicSection.vue') >= 3, 'the rendered home tree contains at least three reachable sections imported from PublicSection.vue')
  assert.match(hero, /aria-hidden="true"/)
  assert.match(hero, /capability-preview/)
  assert.doesNotMatch(hero, /v-html|api[_-]?key|token|user(?:name)?|chat/i)
  assert.match(styles, /radial-gradient/)
  assert.match(styles, /repeat\(3,\s*minmax\(0,\s*1fr\)\)/)
  assert.match(styles, /prefers-reduced-motion:\s*reduce/)
  assert.match(styles, /max-width:\s*767px/)
  assert.match(`${about}${legal}`, /public-document__content/)
  assert.match(legal, /public-document__meta/)
  assert.match(legal, /table-of-contents/)
  assert.match(notFound, /public-not-found/)
  assert.match(preview, /preview-banner/)
  assert.match(preview, /aria-live="polite"/)
  assert.match(`${home}${about}${legal}`, /v-html="(?:home\.|content\.)/)
  for (const [pattern, label] of prototypePatterns) for (const copy of visibleCopy) assert.doesNotMatch(copy, pattern, label)
  for (const copy of visibleCopy) assert.deepEqual(positivePerRequestClaims(copy), [], 'positive per-request pricing claim')
})
