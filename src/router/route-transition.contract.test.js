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
const mediaQueryMatchesScreen = (query, width, reduced) => {
  if (/(?:^|\s|\()print(?:\s|$|\))/i.test(query) && !/not\s+print/i.test(query)) return false
  if (/not\s+screen/i.test(query)) return false
  if (/prefers-reduced-motion\s*:\s*no-preference/i.test(query) && reduced) return false
  if (/prefers-reduced-motion\s*:\s*reduce/i.test(query) && !reduced) return false
  const minimums = [...query.matchAll(/min-width\s*:\s*(\d+(?:\.\d+)?)px/gi)].map(match => Number(match[1]))
  const maximums = [...query.matchAll(/max-width\s*:\s*(\d+(?:\.\d+)?)px/gi)].map(match => Number(match[1]))
  return minimums.every(minimum => width >= minimum) && maximums.every(maximum => width <= maximum)
}
const mediaMatchesScreen = (conditions, width, reduced) => conditions.every(condition => splitTopLevel(condition, ',').some(query => mediaQueryMatchesScreen(query, width, reduced)))
const selectorSpecificity = selector => (selector.match(/#[\w-]+/g) || []).length * 100 + (selector.match(/\.[\w-]+|\[[^\]]+\]|:(?!:)[\w-]+/g) || []).length * 10 + (selector.match(/(?:^|[\s>+~])(?:[a-z][\w-]*|\*)/gi) || []).filter(token => !token.trim().endsWith('*')).length
const selectorTargetsClass = (selector, target) => selector.trim() === target
const applicableRules = (rules, selector, width, reduced) => rules.filter(rule => rule.selectors.some(candidate => selectorTargetsClass(candidate, selector)) && mediaMatchesScreen(rule.media, width, reduced))
const reducedRuleExists = (rules, selector, width) => applicableRules(rules, selector, width, true).some(rule => rule.media.some(condition => /prefers-reduced-motion\s*:\s*reduce/i.test(condition)))
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
    const specificity = Math.max(...rule.selectors.filter(candidate => selectorTargetsClass(candidate, selector)).map(selectorSpecificity))
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
const assertEveryPhaseOpacityOnly = (rules, name) => {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const phaseClass = new RegExp(`\\.${escapedName}-(enter|leave)-(?:active|from|to)(?![\\w-])`, 'g')
  for (const rule of rules) {
    if (![375, 1440].some(width => mediaMatchesScreen(rule.media, width, false) || mediaMatchesScreen(rule.media, width, true))) continue
    const targets = rule.selectors.flatMap(selector => [...selectorSubject(selector).matchAll(phaseClass)].map(match => ({ selector, direction: match[1], phase: match[0] })))
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
const assertOpacityTransition = (rules, selector, durationMs) => {
  const properties = effectiveProperties(rules, selector, 1440, false)
  assert.deepEqual(transitionValues(properties, 'transition-property', 'all'), ['opacity'], `${selector} must effectively animate opacity only`)
  const durations = transitionValues(properties, 'transition-duration', '0s').map(milliseconds)
  assert.deepEqual(durations, [durationMs], `${selector} effective duration must be ${durationMs}ms`)
  const delays = transitionValues(properties, 'transition-delay', '0s').map(milliseconds)
  assert.deepEqual(delays, [0], `${selector} effective delay must be zero or omitted`)
  for (const [property, value] of properties) if (/^animation(?:-|$)/i.test(property)) assert.ok(/^none$|^0m?s$/i.test(value), `${selector} must not use CSS animation`)
}
const assertImmediateReducedMotion = (rules, selector) => {
  for (const width of [375, 1440]) {
    assert.equal(reducedRuleExists(rules, selector, width), true, `reduced motion must target ${selector} at ${width}px`)
    const properties = effectiveProperties(rules, selector, width, true)
    const transitionProperties = transitionValues(properties, 'transition-property', 'all')
    const durations = transitionValues(properties, 'transition-duration', '0s').map(milliseconds)
    const delays = transitionValues(properties, 'transition-delay', '0s').map(milliseconds)
    assert.ok(transitionProperties.every(property => property === 'none') || durations.every(duration => Number.isFinite(duration) && Math.abs(duration) <= 1), `${selector} reduced-motion transition must remain effectively none or near-zero at ${width}px`)
    assert.ok(delays.every(delay => delay === 0), `${selector} reduced-motion delay must be zero or omitted at ${width}px`)
  }
}
const effectiveProperty = (rules, selector, property, reduced = false) => effectiveProperties(rules, selector, 1440, reduced).get(property)

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
  assertEveryPhaseOpacityOnly(root, name)
  assertOpacityTransition(root, `.${name}-enter-active`, 350)
  assertOpacityTransition(root, `.${name}-leave-active`, 200)
  for (const selector of [`.${name}-enter-from`, `.${name}-leave-to`]) {
    assert.equal(effectiveProperty(root, selector, 'opacity'), '0', `${selector} must start or end transparent`)
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
