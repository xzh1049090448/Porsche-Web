import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'
import { baseParse } from '@vue/compiler-dom'
import { parse as parseSfc } from '@vue/compiler-sfc'
import postcss from 'postcss'
import { createMemoryHistory } from 'vue-router'

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8')
const readRequired = (path, label) => {
  const url = new URL(path, import.meta.url)
  assert.equal(existsSync(url), true, `${label} must exist at ${url.pathname}`)
  return readFileSync(url, 'utf8')
}
const templateAst = source => {
  const template = parseSfc(source).descriptor.template?.content
  assert.ok(template, 'component must contain a Vue template')
  return baseParse(template)
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
const declaresComponentProp = (source, name) => {
  const objectDeclaration = new RegExp(`\\b${name}\\s*\\??\\s*:`)
  const arrayDeclaration = new RegExp(`["']${name}["']`)
  for (const match of source.matchAll(/\bdefineProps\b/g)) {
    let cursor = match.index + match[0].length
    while (/\s/.test(source[cursor])) cursor += 1
    if (source[cursor] === '<') {
      const generic = balancedSlice(source, cursor, '<', '>')
      if (generic && objectDeclaration.test(generic.content)) return true
      cursor = generic?.end ?? cursor
      while (/\s/.test(source[cursor])) cursor += 1
    }
    const args = balancedSlice(source, cursor, '(', ')')?.content.trim()
    if (args?.startsWith('{') && objectDeclaration.test(args)) return true
    if (args?.startsWith('[') && arrayDeclaration.test(args)) return true
  }
  for (const match of source.matchAll(/\bprops\s*:\s*/g)) {
    const object = balancedSlice(source, match.index + match[0].length, '{', '}')
    if (object && objectDeclaration.test(object.content)) return true
    const array = balancedSlice(source, match.index + match[0].length, '[', ']')
    if (array && arrayDeclaration.test(array.content)) return true
  }
  return false
}
const styleRoot = source => {
  const styles = parseSfc(source).descriptor.styles.map(style => style.content).join('\n')
  assert.ok(styles, 'shared route transition must contain CSS')
  return postcss.parse(styles)
}
const mediaAncestors = rule => {
  const media = []
  for (let parent = rule.parent; parent; parent = parent.parent) {
    if (parent.type === 'atrule' && parent.name.toLowerCase() === 'media') media.push(parent.params)
  }
  return media
}
const exactRules = (root, selector, context = 'base') => {
  const matches = []
  root.walkRules(rule => {
    if (!rule.selectors?.map(value => value.trim()).includes(selector)) return
    const media = mediaAncestors(rule)
    if (context === 'base' ? media.length === 0 : media.some(value => /prefers-reduced-motion\s*:\s*reduce/i.test(value))) matches.push(rule)
  })
  return matches
}
const propertyValues = (rules, property) => rules.flatMap(rule => rule.nodes
  .filter(node => node.type === 'decl' && node.prop.toLowerCase() === property)
  .map(node => node.value.trim()))
const splitTopLevel = (value, delimiter) => {
  const parts = []
  let depth = 0
  let start = 0
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === '(') depth += 1
    else if (value[index] === ')') depth -= 1
    else if (value[index] === delimiter && depth === 0) {
      parts.push(value.slice(start, index).trim())
      start = index + 1
    }
  }
  parts.push(value.slice(start).trim())
  return parts
}
const transitionTokens = value => splitTopLevel(value.replace(/\s+/g, ' ').trim(), ' ')
const assertZeroTime = (value, message) => assert.match(value, /^0m?s(?:\s*!important)?$/i, message)
const assertOpacityTransition = (root, selector, duration) => {
  const rules = exactRules(root, selector, 'base')
  assert.ok(rules.length > 0, `${selector} must have a base rule`)
  const transitions = propertyValues(rules, 'transition')
  assert.equal(transitions.length, 1, `${selector} must declare one base transition`)
  const clauses = splitTopLevel(transitions[0], ',')
  assert.equal(clauses.length, 1, `${selector} must animate one property`)
  const tokens = transitionTokens(clauses[0])
  const times = tokens.filter(token => /^\d*\.?\d+m?s$/i.test(token))
  assert.equal(times[0], duration, `${selector} duration must be ${duration}`)
  assert.ok(times.length <= 2, `${selector} must not add extra timing values`)
  if (times[1]) assertZeroTime(times[1], `${selector} delay must be zero`)
  const propertyTokens = tokens.filter(token => !/^\d*\.?\d+m?s$/i.test(token)
    && !/^(?:ease|ease-in|ease-out|ease-in-out|linear|step-start|step-end|allow-discrete|normal)$/i.test(token)
    && !/^(?:cubic-bezier|steps|linear)\(/i.test(token))
  assert.deepEqual(propertyTokens, ['opacity'], `${selector} must animate opacity only`)
  for (const value of propertyValues(rules, 'transition-property')) assert.equal(value.replace(/\s+/g, ''), 'opacity')
  for (const value of propertyValues(rules, 'transition-duration')) assert.equal(value, duration)
  for (const value of propertyValues(rules, 'transition-delay')) assertZeroTime(value, `${selector} delay must be zero`)
  for (const rule of rules) assert.equal(rule.nodes.some(node => node.type === 'decl' && /^animation(?:-|$)/i.test(node.prop)), false, `${selector} must not use CSS animation`)
}
const assertImmediateReducedMotion = (root, selector) => {
  const rules = exactRules(root, selector, 'reduced')
  assert.ok(rules.length > 0, `reduced motion must target ${selector}`)
  const transitions = propertyValues(rules, 'transition')
  const durations = propertyValues(rules, 'transition-duration')
  assert.ok(transitions.some(value => /^none(?:\s*!important)?$/i.test(value)) || durations.some(value => /^0m?s(?:\s*!important)?$/i.test(value)), `${selector} must become immediate`)
  for (const value of propertyValues(rules, 'transition-delay')) assertZeroTime(value, `${selector} reduced-motion delay must be zero`)
}

test('shared route transition keys leaf views by fullPath and identity epoch', () => {
  const transition = readRequired('../components/shell/RouteTransition.vue', 'shared route transition component')
  const mainLayout = read('../layouts/MainLayout.vue')
  assert.ok(elements(transition, 'RouterView').some(node => node.props.some(prop => prop.type === 7 && prop.name === 'slot')), 'RouterView must expose its slot')
  const leaf = elements(transition, 'component').find(node => boundAttribute(node, 'is')?.trim() === 'Component')
  assert.ok(leaf, 'RouterView must render its resolved leaf component')
  const key = boundAttribute(leaf, 'key')
  assert.ok(key, 'rendered leaf component must bind :key')
  assert.match(key, /\broute\.fullPath\b/, 'rendered leaf :key must directly include route.fullPath')
  const identityName = key.match(/\b(identityEpoch|identityKey)\b/)?.[1]
  assert.ok(identityName, 'rendered leaf :key must directly include identityEpoch or identityKey')
  assert.equal(declaresComponentProp(transition, identityName), true, `${identityName} must be declared as a component prop`)
  assert.doesNotMatch(transition, new RegExp(`\\b(?:const|let|var)\\s+${identityName}\\b`), `${identityName} must come from the declared prop`)
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
  assertOpacityTransition(root, `.${name}-enter-active`, '350ms')
  assertOpacityTransition(root, `.${name}-leave-active`, '200ms')
  for (const selector of [`.${name}-enter-from`, `.${name}-leave-to`]) {
    assert.ok(propertyValues(exactRules(root, selector, 'base'), 'opacity').includes('0'), `${selector} must start or end transparent`)
  }
  assertImmediateReducedMotion(root, `.${name}-enter-active`)
  assertImmediateReducedMotion(root, `.${name}-leave-active`)
})

test('public and authenticated shells reuse the shared transition component', () => {
  const publicLayout = read('../layouts/PublicLayout.vue')
  const authEntry = read('../bootstrap/AuthApp.vue')
  const mainLayout = read('../layouts/MainLayout.vue')
  for (const [source, label] of [[publicLayout, 'public child outlet'], [authEntry, 'authenticated top-level outlet'], [mainLayout, 'console content outlet']]) assert.match(source, /@\/components\/shell\/RouteTransition\.vue/, `${label} imports the shared transition`)
  assert.match(publicLayout, /h\(\s*RouteTransition\b/, 'public child outlet uses the shared transition in its render function')
  assert.ok(elements(authEntry, 'RouteTransition').length > 0, 'authenticated entry renders the shared transition')
  assert.ok(elements(mainLayout, 'RouteTransition').length > 0, 'console content renders the shared transition')
})

test('router preserves guarded cross-bootstrap handoff and explicit scroll behavior', async () => {
  const { createAppRouter, installBootstrapHandoff } = await import('./index.js')
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
