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
    const aliases = new Map()
    for (const statement of ast.program.body) if (statement.type === 'ImportDeclaration') {
      for (const specifier of statement.specifiers) imports.set(specifier.local.name, statement.source.value)
    }
    for (const statement of ast.program.body) if (statement.type === 'VariableDeclaration') for (const declaration of statement.declarations) {
      if (declaration.id?.type === 'Identifier' && declaration.init?.type === 'Identifier') aliases.set(declaration.id.name, declaration.init.name)
    }
    const importedSource = (local, resolving = new Set()) => {
      if (!local || resolving.has(local)) return undefined
      if (imports.has(local)) return imports.get(local)
      return importedSource(aliases.get(local), new Set(resolving).add(local))
    }
    if (block === descriptor.scriptSetup) for (const local of new Set([...imports.keys(), ...aliases.keys()])) {
      if (sourceMatches(importedSource(local))) wiredNames.add(normalizedComponentName(local))
    }
    for (const statement of ast.program.body) {
      if (statement.type !== 'ExportDefaultDeclaration') continue
      let options = statement.declaration
      if (['CallExpression', 'OptionalCallExpression'].includes(options?.type) && options.callee?.type === 'Identifier' && options.callee.name === 'defineComponent') options = options.arguments[0]
      if (options?.type !== 'ObjectExpression') continue
      const components = options.properties.find(property => (property.key?.name ?? property.key?.value) === 'components')
      const registry = components?.type === 'ObjectMethod' ? undefined : components?.value
      if (registry?.type !== 'ObjectExpression') continue
      for (const property of registry.properties) {
        if (property.type === 'SpreadElement') continue
        const registered = property.key?.name ?? property.key?.value
        const local = property.shorthand ? property.key?.name : property.value?.name
        if (sourceMatches(importedSource(local))) wiredNames.add(normalizedComponentName(registered))
      }
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
    const process = (statements, target) => {
      for (const raw of statements || []) {
        const node = raw?.type === 'ExportNamedDeclaration' ? raw.declaration : raw
        if (!node) continue
        if (node.type === 'FunctionDeclaration' && node.id) target.set(node.id.name, [node])
        else if (node.type === 'VariableDeclaration') for (const declaration of node.declarations) bindPattern(declaration.id, declaration.init, target)
        else if (node.type === 'ExpressionStatement') applyExpression(node.expression, target)
        else if (node.type === 'BlockStatement') process(node.body, target)
        else if (node.type === 'IfStatement') {
          const condition = staticValue(node.test)
          if (condition !== unknownStaticValue) process((condition ? node.consequent : node.alternate)?.type === 'BlockStatement' ? (condition ? node.consequent : node.alternate).body : [condition ? node.consequent : node.alternate], target)
          else {
            const left = new Map(target); const right = new Map(target)
            process(node.consequent?.type === 'BlockStatement' ? node.consequent.body : [node.consequent], left)
            process(node.alternate?.type === 'BlockStatement' ? node.alternate.body : [node.alternate], right)
            target.clear(); for (const [name, values] of merge(left, right)) target.set(name, values)
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
  node = unwrapExpression(node)
  if (!node) return []
  if (node.type === 'ReturnStatement') return node.argument ? [node.argument] : []
  if (node.type === 'IfStatement') return returnedExpressions(node.consequent).concat(returnedExpressions(node.alternate))
  if (node.type === 'SwitchStatement') return node.cases.flatMap(branch => branch.consequent.flatMap(returnedExpressions))
  if (node.type === 'BlockStatement') return node.body.flatMap(returnedExpressions)
  return [node]
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
    const helpers = new Map()
    const aliases = new Map()
    for (const statement of ast.program.body) {
      if (statement.type === 'ImportDeclaration') for (const specifier of statement.specifiers) {
        const imported = specifier.imported?.name ?? specifier.imported?.value
        if (statement.source.value === 'vue' && ['h', 'createVNode'].includes(imported)) renderNames.add(specifier.local.name)
        if (statement.source.value === 'vue' && ['Comment', 'Text', 'Static', 'Fragment'].includes(imported)) vnodeKinds.set(specifier.local.name, ['Comment', 'Text', 'Static'].includes(imported) ? imported.toLowerCase() : 'fragment')
        if (statement.source.value === 'vue' && ['KeepAlive', 'Suspense', 'Teleport'].includes(imported)) vnodeKinds.set(specifier.local.name, 'component')
        if (/\.vue(?:\?|$)/.test(statement.source.value)) vnodeKinds.set(specifier.local.name, 'component')
        if (String(statement.source.value).replace(/\\/g, '/').endsWith(`/${expectedFile}`)) targets.add(specifier.local.name)
      }
      if (statement.type === 'FunctionDeclaration' && statement.id) helpers.set(statement.id.name, statement)
    }
    const registerBindings = node => {
      if (!node || typeof node !== 'object') return
      if (node.type === 'VariableDeclarator' && node.id?.type === 'Identifier' && node.init) {
        aliases.set(node.id.name, node.init)
        if (['ArrowFunctionExpression', 'FunctionExpression'].includes(unwrapExpression(node.init)?.type)) helpers.set(node.id.name, unwrapExpression(node.init))
      }
      for (const [key, child] of Object.entries(node)) if (!['loc', 'start', 'end', 'extra'].includes(key)) {
        for (const item of Array.isArray(child) ? child : [child]) if (item?.type) registerBindings(item)
      }
    }
    registerBindings(ast.program)
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
    const returns = body => {
      body = unwrapExpression(body)
      if (!body) return []
      if (body.type !== 'BlockStatement') return [body]
      const values = []
      const visit = statement => {
        if (!statement) return
        if (statement.type === 'ReturnStatement') { if (statement.argument) values.push(statement.argument); return }
        if (statement.type === 'IfStatement') {
          const condition = staticValue(statement.test)
          if (condition !== unknownStaticValue) visit(condition ? statement.consequent : statement.alternate)
          else { visit(statement.consequent); visit(statement.alternate) }
          return
        }
        if (statement.type === 'SwitchStatement') {
          const discriminant = staticValue(statement.discriminant)
          const caseValues = statement.cases.map(branch => branch.test ? staticValue(branch.test) : undefined)
          const fallback = statement.cases.findIndex(branch => !branch.test)
          const known = discriminant !== unknownStaticValue && caseValues.every((value, index) => index === fallback || value !== unknownStaticValue)
          const matched = known ? caseValues.findIndex((value, index) => index !== fallback && Object.is(value, discriminant)) : -1
          const entries = known ? [matched >= 0 ? matched : fallback].filter(index => index >= 0) : statement.cases.map((_, index) => index)
          for (const entry of entries) for (let index = entry; index < statement.cases.length; index += 1) {
            const statements = statement.cases[index].consequent
            const stop = statements.findIndex(child => child.type === 'BreakStatement')
            for (const child of stop < 0 ? statements : statements.slice(0, stop)) visit(child)
            if (stop >= 0) break
          }
          return
        }
        if (statement.type === 'BlockStatement') for (const child of statement.body) visit(child)
      }
      visit(body)
      return values
    }
    const inspect = (node, resolving = new Set()) => {
      node = unwrapExpression(node)
      if (!node) return false
      if (node.type === 'Identifier' && helpers.has(node.name) && !resolving.has(node.name)) return returns(helpers.get(node.name).body).some(result => inspect(result, new Set(resolving).add(node.name)))
      if (['ArrowFunctionExpression', 'FunctionExpression', 'FunctionDeclaration'].includes(node.type)) return returns(node.body).some(result => inspect(result, resolving))
      if (node.type === 'ConditionalExpression') {
        const condition = staticValue(node.test)
        return condition !== unknownStaticValue ? inspect(condition ? node.consequent : node.alternate, resolving) : inspect(node.consequent, resolving) || inspect(node.alternate, resolving)
      }
      if (node.type === 'LogicalExpression') {
        const left = staticValue(node.left)
        if (left !== unknownStaticValue) return inspect(node.left, resolving) || ((node.operator === '&&' ? Boolean(left) : node.operator === '||' ? !left : left == null) && inspect(node.right, resolving))
        return inspect(node.left, resolving) || inspect(node.right, resolving)
      }
      if (node.type === 'SequenceExpression') return inspect(node.expressions.at(-1), resolving)
      if (node.type === 'ArrayExpression') return node.elements.some(item => inspect(item, resolving))
      if (!['CallExpression', 'OptionalCallExpression'].includes(node.type)) return false
      if (node.callee?.type === 'Identifier' && renderNames.has(node.callee.name)) {
        if (resolvesTarget(node.arguments[0])) return true
        const vnodeTypes = resolvedVNodeOutcomes(node.arguments[0])
        const componentVNode = vnodeTypes.length === 0 || vnodeTypes.some(type => !['native', 'nullish', 'comment', 'text', 'static', 'fragment'].includes(type.kind))
        const children = node.arguments.length >= 3 ? node.arguments.slice(2) : node.arguments.slice(1)
        const inspectRenderedChild = child => {
          child = unwrapExpression(child)
          if (!child) return false
          if (child.type === 'ArrayExpression') return child.elements.some(inspectRenderedChild)
          if (['ArrowFunctionExpression', 'FunctionExpression'].includes(child.type)) return componentVNode && returns(child.body).some(result => inspect(result, resolving))
          if (child.type === 'ObjectExpression') return componentVNode && child.properties.some(property => inspect(property.type === 'ObjectMethod' ? property : property.value, resolving))
          return inspect(child, resolving)
        }
        return children.some(inspectRenderedChild)
      }
      return node.callee?.type === 'Identifier' && helpers.has(node.callee.name) && !resolving.has(node.callee.name)
        && returns(helpers.get(node.callee.name).body).some(result => inspect(result, new Set(resolving).add(node.callee.name)))
    }
    for (const statement of ast.program.body) if (statement.type === 'ExportDefaultDeclaration') {
      let options = unwrapExpression(statement.declaration)
      if (['CallExpression', 'OptionalCallExpression'].includes(options?.type) && options.callee?.name === 'defineComponent') options = unwrapExpression(options.arguments[0])
      if (options?.type !== 'ObjectExpression') continue
      for (const property of options.properties) if (['setup', 'render'].includes(String(property.key?.name ?? property.key?.value))) {
        const fn = property.type === 'ObjectMethod' ? property : unwrapExpression(property.value)
        if (returns(fn?.body).some(result => inspect(result))) return true
      }
    }
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
