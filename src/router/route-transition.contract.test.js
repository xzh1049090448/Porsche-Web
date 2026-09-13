import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8')
const readRequired = (path, label) => {
  const url = new URL(path, import.meta.url)
  assert.equal(existsSync(url), true, `${label} must exist at ${url.pathname}`)
  return readFileSync(url, 'utf8')
}
const escapeRegExp = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const tag = (source, element, predicate) => (source.match(new RegExp(`<${element}\\b[^>]*>`, 'g')) || []).find(predicate)
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
    const argumentsList = balancedSlice(source, cursor, '(', ')')
    const argumentsSource = argumentsList?.content.trim()
    if (argumentsSource?.startsWith('{') && objectDeclaration.test(argumentsSource)) return true
    if (argumentsSource?.startsWith('[') && arrayDeclaration.test(argumentsSource)) return true
  }
  for (const match of source.matchAll(/\bprops\s*:\s*/g)) {
    const object = balancedSlice(source, match.index + match[0].length, '{', '}')
    if (object && objectDeclaration.test(object.content)) return true
    const array = balancedSlice(source, match.index + match[0].length, '[', ']')
    if (array && arrayDeclaration.test(array.content)) return true
  }
  return false
}
const declarations = (source, selector) => {
  const styleBlocks = [...source.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map(match => match[1])
  const css = styleBlocks.length ? styleBlocks.join('\n') : source
  const blocks = []
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = match[1].split(',').map(value => value.trim())
    if (selectors.includes(selector)) blocks.push(match[2])
  }
  assert.ok(blocks.length > 0, `${selector} must have CSS declarations`)
  return blocks.join(';')
}
const properties = (block, name) => [...block.matchAll(new RegExp(`(?:^|;)\\s*${escapeRegExp(name)}\\s*:\\s*([^;{}]+)`, 'gi'))]
  .map(match => match[1].trim())
const atRuleBlock = (source, header) => {
  const match = header.exec(source)
  if (!match) return undefined
  const open = source.indexOf('{', match.index)
  let depth = 1
  let end = open + 1
  while (end < source.length && depth > 0) {
    if (source[end] === '{') depth += 1
    else if (source[end] === '}') depth -= 1
    end += 1
  }
  return depth === 0 ? source.slice(open + 1, end - 1) : undefined
}
const splitTransitionList = value => {
  const items = []
  let depth = 0
  let start = 0
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === '(') depth += 1
    else if (value[index] === ')') depth -= 1
    else if (value[index] === ',' && depth === 0) {
      items.push(value.slice(start, index).trim())
      start = index + 1
    }
  }
  items.push(value.slice(start).trim())
  return items
}
const assertOpacityTransition = (block, duration) => {
  const transitions = properties(block, 'transition')
  assert.equal(transitions.length, 1, 'route active rule must declare exactly one transition value')
  const [value] = transitions
  const items = splitTransitionList(value)
  assert.equal(items.length, 1, 'route transition must animate exactly one property')
  assert.match(items[0], new RegExp(`(?:^|\\s)${duration}(?:\\s|$)`), `route transition duration must be ${duration}`)
  const animatedProperty = items[0]
    .replace(/(?:cubic-bezier|steps)\([^)]*\)/gi, ' ')
    .replace(/\b\d*\.?\d+m?s\b/gi, ' ')
    .replace(/\b(?:ease-in-out|ease-in|ease-out|ease|linear|step-start|step-end|allow-discrete|normal)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  assert.equal(animatedProperty, 'opacity', 'route transition must animate opacity and no other property')
  for (const longhand of properties(block, 'transition-property')) {
    assert.equal(longhand.replace(/\s+/g, ''), 'opacity', 'transition-property must be opacity only')
  }
  assert.doesNotMatch(block, /(?:^|;)\s*animation(?:-[\w-]+)?\s*:/i, 'route transition active rules must not add a separate animation')
}
const assertImmediate = block => {
  const transition = properties(block, 'transition')
  const duration = properties(block, 'transition-duration')
  const isNone = transition.some(value => /^none(?:\s*!important)?$/i.test(value))
  const isZeroDuration = duration.some(value => /^0m?s(?:\s*!important)?$/i.test(value))
  assert.ok(isNone || isZeroDuration, 'reduced-motion route rule must disable the transition duration')
  for (const delay of properties(block, 'transition-delay')) {
    assert.match(delay, /^0m?s(?:\s*!important)?$/i, 'reduced-motion route rule must not retain a delay')
  }
}

test('shared route transition keys leaf views by fullPath and identity epoch', () => {
  const transition = readRequired('../components/shell/RouteTransition.vue', 'shared route transition component')
  const mainLayout = read('../layouts/MainLayout.vue')
  assert.match(transition, /<RouterView\b[^>]*v-slot=/)
  const leaf = tag(transition, 'component', value => /:is\s*=\s*["']Component["']/.test(value))
  assert.ok(leaf, 'RouterView must render its resolved leaf component')
  const key = leaf.match(/:key\s*=\s*(["'])(.*?)\1/s)?.[2]
  assert.ok(key, 'rendered leaf component must bind :key')
  assert.match(key, /route\.fullPath/, 'rendered leaf :key must directly include route.fullPath')
  const identityName = key.match(/\b(identityEpoch|identityKey)\b/)?.[1]
  assert.ok(identityName, 'rendered leaf :key must directly include identityEpoch or identityKey')
  assert.equal(declaresComponentProp(transition, identityName), true, `${identityName} must be declared as a component prop`)
  assert.doesNotMatch(
    transition,
    new RegExp(`\\b(?:const|let|var)\\s+${identityName}\\b`),
    `${identityName} must come from the declared prop rather than a local key`,
  )
  const mainTransition = tag(mainLayout, 'RouteTransition', () => true)
  assert.ok(mainTransition, 'console layout must render the shared route transition')
  const identityAttribute = identityName === 'identityKey' ? 'identity-key' : 'identity-epoch'
  assert.match(
    mainTransition,
    new RegExp(`:${identityAttribute}\\s*=\\s*(["'])userStore\\.identityEpoch\\1`),
    `console layout must pass userStore.identityEpoch into ${identityName}`,
  )
})

test('route transition is opacity-only with approved timings and immediate reduced motion', () => {
  const transition = readRequired('../components/shell/RouteTransition.vue', 'shared route transition component')
  const transitionTag = tag(transition, 'Transition', () => true)
  assert.ok(transitionTag, 'shared route component must render Vue Transition')
  assert.match(transitionTag, /\bmode\s*=\s*["']out-in["']/)
  const name = transitionTag.match(/\bname\s*=\s*(["'])([^"']+)\1/)?.[2]
  assert.ok(name, 'Vue Transition must have a static CSS name')
  const enter = declarations(transition, `.${name}-enter-active`)
  const leave = declarations(transition, `.${name}-leave-active`)
  assertOpacityTransition(enter, '350ms')
  assertOpacityTransition(leave, '200ms')
  assert.match(declarations(transition, `.${name}-enter-from`), /(?:^|;)\s*opacity\s*:\s*0\s*(?:;|$)/)
  assert.match(declarations(transition, `.${name}-leave-to`), /(?:^|;)\s*opacity\s*:\s*0\s*(?:;|$)/)
  const reduced = atRuleBlock(transition, /@media\s*\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)/i)
  assert.ok(reduced, 'shared route transition must define reduced-motion CSS')
  assertImmediate(declarations(reduced, `.${name}-enter-active`))
  assertImmediate(declarations(reduced, `.${name}-leave-active`))
})

test('public and authenticated shells reuse the shared transition component', () => {
  const publicLayout = read('../layouts/PublicLayout.vue')
  const authEntry = read('../bootstrap/AuthApp.vue')
  const mainLayout = read('../layouts/MainLayout.vue')
  for (const [source, label] of [[publicLayout, 'public child outlet'], [authEntry, 'authenticated top-level outlet'], [mainLayout, 'console content outlet']]) {
    assert.match(source, /@\/components\/shell\/RouteTransition\.vue/, `${label} imports the shared transition`)
    assert.match(source, /RouteTransition/, `${label} renders the shared transition`)
  }
  assert.match(publicLayout, /h\(RouteTransition/, 'public child outlet uses the shared transition in its render function')
  assert.match(authEntry, /<RouteTransition\b/, 'authenticated entry uses the shared transition')
  assert.match(mainLayout, /<RouteTransition\b/, 'console content uses the shared transition')
})

test('router preserves guarded cross-bootstrap handoff and explicit scroll behavior', () => {
  const router = read('./index.js')
  assert.match(router, /export function installBootstrapHandoff/)
  assert.match(router, /if\s*\(!mode\s*\|\|\s*typeof handoff !== ['"]function['"]\)\s*return router/)
  assert.match(router, /if\s*\(targetMode === mode\)\s*return true/)
  assert.match(router, /handoff\(to\.fullPath\)[\s\S]{0,40}return false/)
  assert.match(router, /function\s+\w*scroll\w*\s*\(\s*to\s*,\s*from\s*,\s*savedPosition\s*\)/i, 'router defines scroll behavior for hash, pop and new routes')
  assert.match(router, /if\s*\(\s*savedPosition\s*\)\s*return\s+savedPosition/, 'pop navigation restores saved position')
  assert.match(router, /if\s*\(\s*to\.hash\s*\)[\s\S]{0,180}\bel\s*:\s*to\.hash/, 'hash navigation targets its anchor')
  assert.match(router, /(?:to\.path\s*!==\s*from\.path|to\.fullPath\s*!==\s*from\.fullPath)[\s\S]{0,180}\btop\s*:\s*0/, 'new-route navigation starts at the top')
  assert.match(router, /createRouter\(\s*\{[^}]*\bscrollBehavior\b/s, 'router installs the shared scroll behavior')
})
