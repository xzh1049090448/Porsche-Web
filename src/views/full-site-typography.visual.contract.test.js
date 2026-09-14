import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vuePlugin from '@vitejs/plugin-vue'
import { JSDOM } from 'jsdom'
import postcss from 'postcss'
import { compileString } from 'sass'

const vueCompiler = (() => {
  const plugin = vuePlugin()
  plugin.buildStart()
  return plugin.api.options.compiler
})()

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8')
const normalizeSelector = selector => selector.trim().replace(/\s*([>+~])\s*/g, '$1').replace(/\s+/g, ' ')
const tokenPixels = { xs: '11px', sm: '12px', body: '14px', subtitle: '16px', 'page-title': '20px' }
const compactTokens = new Set(['xs', 'sm', 'body', 'subtitle', 'page-title', 'section-title'])

const representativeVueRoots = [
  './Login.vue', './Register.vue', './Chat.vue', './Billing.vue', './ApiKeys.vue', './Profile.vue',
  './Users.vue', './UserDetail.vue', './PublicModelsAdmin.vue', './PublicPricingAdmin.vue',
  './PublicContentAdmin.vue', './RootNotifications.vue', './public/Home.vue', './public/Pricing.vue',
  './public/ModelPricingDetail.vue', '../components/admin/UserPermissionEditor.vue', '../layouts/MainLayout.vue',
]
const sharedStylePaths = [
  '../styles/console-pages.scss', '../styles/global.scss', '../styles/console-shell.scss',
  '../styles/mobile.scss', '../styles/public-pricing.scss', '../styles/public-shell.scss',
]

function descriptor(path) {
  const parsed = vueCompiler.parse(read(path), { filename: path })
  assert.equal(parsed.errors.length, 0, `${path} must parse as a Vue SFC`)
  return parsed.descriptor
}

function resolveLocalVueImport(fromPath, source) {
  if (!source.endsWith('.vue')) return null
  if (source.startsWith('@/')) return new URL(source.slice(2), new URL('../', import.meta.url)).href
  if (source.startsWith('.')) return new URL(source, new URL(fromPath, import.meta.url)).href
  return null
}

function localVueImportGraph(roots) {
  const pending = roots.map(path => new URL(path, import.meta.url).href)
  const seen = new Set()
  while (pending.length) {
    const path = pending.shift()
    if (seen.has(path)) continue
    seen.add(path)
    const component = descriptor(path)
    if (!component.script && !component.scriptSetup) continue
    const compiled = vueCompiler.compileScript(component, { id: path })
    const bindingSources = Object.values(compiled.imports || {}).map(binding => binding.source)
    const astSources = [...(compiled.scriptAst || []), ...(compiled.scriptSetupAst || [])]
      .filter(node => node.type === 'ImportDeclaration').map(node => node.source.value)
    for (const source of new Set([...bindingSources, ...astSources])) {
      const resolved = resolveLocalVueImport(path, source)
      if (resolved && !seen.has(resolved)) pending.push(resolved)
    }
  }
  return seen
}

function auditedStylePaths() {
  const importedVueStyles = [...localVueImportGraph(representativeVueRoots)]
    .filter(path => descriptor(path).styles.length > 0)
  return [...importedVueStyles, ...sharedStylePaths]
}

function templateClasses(path) {
  const classes = new Set()
  const walk = node => {
    if (!node || typeof node !== 'object') return
    for (const prop of node.props || []) {
      if (prop.type === 6 && prop.name === 'class') {
        for (const value of prop.value?.content.split(/\s+/) || []) if (value) classes.add(value)
      }
    }
    for (const child of node.children || []) walk(child)
    if (node.branches) for (const branch of node.branches) walk(branch)
  }
  walk(descriptor(path).template?.ast)
  return classes
}

function staticClasses(node) {
  const attribute = node.props?.find(prop => prop.type === 6 && prop.name === 'class')
  return attribute?.value?.content.split(/\s+/).filter(Boolean) || []
}

function staticAttributes(node) {
  return (node.props || []).filter(prop => prop.type === 6).map(prop => [prop.name, prop.value?.content])
}

function templateElementPath(path, predicate) {
  let found
  const walk = (node, ancestors = []) => {
    if (found || !node || typeof node !== 'object') return
    const current = node.type === 1 ? [...ancestors, node] : ancestors
    if (node.type === 1 && predicate(node, current)) { found = current; return }
    for (const child of node.children || []) walk(child, current)
    if (node.branches) for (const branch of node.branches) walk(branch, current)
  }
  walk(descriptor(path).template?.ast)
  assert.ok(found, `${path} must expose the requested real template path`)
  return found
}

function minimalDomFromTemplatePath(path) {
  return path.reduceRight((content, node) => {
    if (node.tag === 'template') return content
    const attributes = staticAttributes(node).map(([name, value]) => value === undefined ? name : `${name}="${value.replaceAll('&', '&amp;').replaceAll('"', '&quot;')}"`).join(' ')
    return `<${node.tag}${attributes ? ` ${attributes}` : ''}>${content}</${node.tag}>`
  }, 'Welcome')
}

function parsedStyles(path) {
  if (path.endsWith('.vue')) {
    const styles = descriptor(path).styles
    assert.ok(styles.length > 0, `${path} must expose styles for its typography contract`)
    return styles.map((style, index) => {
      const css = style.lang === 'scss'
        ? compileString(style.content, { url: new URL(path, import.meta.url), logger: { warn() {}, debug() {} } }).css
        : style.content
      return { file: `${path}#style-${index + 1}`, root: postcss.parse(css, { from: path }) }
    })
  }
  const source = read(path)
  const css = path.endsWith('.scss') ? compileString(source, { url: new URL(path, import.meta.url), logger: { warn() {}, debug() {} } }).css : source
  return [{ file: path, root: postcss.parse(css, { from: path }) }]
}

function declarations(path, selector, property = 'font-size') {
  const expected = normalizeSelector(selector)
  return parsedStyles(path).flatMap(({ file, root }) => {
    const values = []
    root.walkRules(rule => {
      if (!postcss.list.comma(rule.selector).some(candidate => normalizeSelector(candidate) === expected)) return
      rule.walkDecls(property, declaration => values.push({ file, selector, value: declaration.value.trim() }))
    })
    return values
  })
}

function mediaConditions(rule) {
  const conditions = []
  for (let parent = rule.parent; parent; parent = parent.parent) {
    if (parent.type === 'atrule' && parent.name.toLowerCase() === 'media') conditions.unshift(parent.params)
  }
  return conditions
}

function fontSizeDeclarations(path) {
  const found = []
  let order = 0
  for (const { file, root } of parsedStyles(path)) {
    root.walkRules(rule => {
      const selectors = postcss.list.comma(rule.selector).map(normalizeSelector)
      rule.nodes.filter(node => node.type === 'decl' && node.prop === 'font-size').forEach(declaration => {
        const declarationOrder = order++
        for (const selector of selectors) {
          found.push({
            file,
            selector,
            value: declaration.value.trim(),
            important: Boolean(declaration.important),
            media: mediaConditions(rule),
            order: declarationOrder,
          })
        }
      })
    })
  }
  return found
}

function mediaQueryApplies(query, width) {
  return postcss.list.comma(query).some(branch => {
    const widthTerms = [...branch.matchAll(/\((min|max)-width\s*:\s*(\d+(?:\.\d+)?)px\)/gi)]
    const remainder = branch
      .replace(/\((min|max)-width\s*:\s*(\d+(?:\.\d+)?)px\)/gi, '')
      .replace(/\b(?:only\s+)?screen\b/gi, '')
      .replace(/\band\b/gi, '')
      .trim()
    if (remainder) return false
    return widthTerms.every(([, bound, pixels]) => bound.toLowerCase() === 'min' ? width >= Number(pixels) : width <= Number(pixels))
  })
}

function selectorForDom(selector) {
  let candidate = selector
  let previous
  do {
    previous = candidate
    candidate = candidate.replace(/::v-deep\(([^()]*)\)|:(?:deep|global|slotted)\(([^()]*)\)/g, (_match, legacy, modern) => legacy || modern)
  } while (candidate !== previous)
  candidate = candidate.replace(/\s*(?:>>>|\/deep\/)\s*/g, ' ')
  if (/::[\w-]+/.test(candidate)) return null
  return candidate
}

const addSpecificity = (left, right) => left.map((value, index) => value + right[index])
const compareSpecificity = (left, right) => left[0] - right[0] || left[1] - right[1] || left[2] - right[2]
const maxSpecificity = values => values.reduce((winner, value) => compareSpecificity(value, winner) > 0 ? value : winner, [0, 0, 0])

function nthOfSelector(argument) {
  let depth = 0
  for (let index = 0; index < argument.length - 3; index += 1) {
    if (argument[index] === '(' || argument[index] === '[') depth += 1
    else if (argument[index] === ')' || argument[index] === ']') depth -= 1
    else if (depth === 0 && /\s/.test(argument[index]) && /^of\s+/i.test(argument.slice(index).trimStart())) {
      return argument.slice(index).trimStart().replace(/^of\s+/i, '')
    }
  }
  return null
}

function selectorSpecificity(selector) {
  let score = [0, 0, 0]
  let plain = ''
  for (let cursor = 0; cursor < selector.length;) {
    const match = /:([\w-]+)\s*\(/.exec(selector.slice(cursor))
    if (!match) { plain += selector.slice(cursor); break }
    const index = cursor + match.index
    plain += selector.slice(cursor, index)
    const open = selector.indexOf('(', index)
    let end = open + 1
    let depth = 1
    for (; end < selector.length && depth > 0; end += 1) {
      if (selector[end] === '(') depth += 1
      else if (selector[end] === ')') depth -= 1
    }
    if (depth !== 0) { plain += selector.slice(index); break }
    const name = match[1].toLowerCase()
    const argument = selector.slice(open + 1, end - 1)
    if (['is', 'not', 'has'].includes(name)) score = addSpecificity(score, maxSpecificity(postcss.list.comma(argument).map(selectorSpecificity)))
    else if (['nth-child', 'nth-last-child'].includes(name)) {
      score = addSpecificity(score, [0, 1, 0])
      const ofSelector = nthOfSelector(argument)
      if (ofSelector) score = addSpecificity(score, maxSpecificity(postcss.list.comma(ofSelector).map(selectorSpecificity)))
    } else if (name !== 'where') score = addSpecificity(score, [0, 1, 0])
    cursor = end
  }
  return addSpecificity(score, [
    (plain.match(/#[\w-]+/g) || []).length,
    (plain.match(/\.[\w-]+|\[[^\]]+\]|:(?!:)[\w-]+/g) || []).length,
    (plain.match(/(?:^|[\s>+~])(?:[a-z][\w-]*|\*)/gi) || []).filter(token => !token.trim().endsWith('*')).length,
  ])
}

function effectiveMatchedFontSize(path, target, width) {
  let winner
  for (const declaration of fontSizeDeclarations(path)) {
    if (!declaration.media.every(query => mediaQueryApplies(query, width))) continue
    const selector = selectorForDom(declaration.selector)
    if (!selector) continue
    try { if (!target.matches(selector)) continue } catch (error) { assert.fail(`unsupported typography selector ${declaration.selector}: ${error.message}`) }
    const candidate = { ...declaration, specificity: selectorSpecificity(selector) }
    if (!winner
      || Number(candidate.important) > Number(winner.important)
      || (candidate.important === winner.important && (compareSpecificity(candidate.specificity, winner.specificity) > 0
        || (compareSpecificity(candidate.specificity, winner.specificity) === 0 && candidate.order > winner.order)))) winner = candidate
  }
  return winner
}

function cascadeDeclarations(paths) {
  const found = []
  let order = 0
  for (const path of paths) for (const { file, root } of parsedStyles(path)) {
    root.walkRules(rule => {
      const selectors = postcss.list.comma(rule.selector).map(normalizeSelector)
      for (const declaration of rule.nodes.filter(node => node.type === 'decl' && (node.prop === 'font-size' || node.prop.startsWith('--')))) {
        const declarationOrder = order++
        for (const selector of selectors) found.push({
          file, selector, property: declaration.prop, value: declaration.value.trim(),
          important: Boolean(declaration.important), media: mediaConditions(rule), order: declarationOrder,
        })
      }
    })
  }
  return found
}

function cascadeWinner(declarations, target, property, width) {
  let winner
  for (const declaration of declarations) {
    if (declaration.property !== property || !declaration.media.every(query => mediaQueryApplies(query, width))) continue
    const selector = selectorForDom(declaration.selector)
    if (!selector) continue
    try { if (!target.matches(selector)) continue } catch (error) { assert.fail(`unsupported cascade selector ${declaration.file} ${declaration.selector}: ${error.message}`) }
    const candidate = { ...declaration, specificity: selectorSpecificity(selector) }
    if (!winner || Number(candidate.important) > Number(winner.important)
      || (candidate.important === winner.important && (compareSpecificity(candidate.specificity, winner.specificity) > 0
        || (compareSpecificity(candidate.specificity, winner.specificity) === 0 && candidate.order > winner.order)))) winner = candidate
  }
  return winner
}

function splitVarArguments(value) {
  let depth = 0
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === '(') depth += 1
    else if (value[index] === ')') depth -= 1
    else if (value[index] === ',' && depth === 0) return [value.slice(0, index).trim(), value.slice(index + 1).trim()]
  }
  return [value.trim(), undefined]
}

function customPropertyValue(declarations, target, name, width) {
  for (let node = target; node?.nodeType === 1; node = node.parentElement) {
    const winner = cascadeWinner(declarations, node, name, width)
    if (winner) return winner.value
  }
  return undefined
}

function resolveVars(value, declarations, target, width, resolving = new Set()) {
  const start = value.indexOf('var(')
  if (start < 0) return value.trim()
  let end = start + 4
  let depth = 1
  for (; end < value.length && depth; end += 1) {
    if (value[end] === '(') depth += 1
    else if (value[end] === ')') depth -= 1
  }
  if (depth) return undefined
  const [name, fallback] = splitVarArguments(value.slice(start + 4, end - 1))
  if (!/^--[\w-]+$/.test(name)) return undefined
  let replacement
  if (!resolving.has(name)) {
    const custom = customPropertyValue(declarations, target, name, width)
    if (custom !== undefined) replacement = resolveVars(custom, declarations, target, width, new Set([...resolving, name]))
  }
  if (replacement === undefined && fallback !== undefined) replacement = resolveVars(fallback, declarations, target, width, resolving)
  if (replacement === undefined) return undefined
  return resolveVars(`${value.slice(0, start)}${replacement}${value.slice(end)}`, declarations, target, width, resolving)
}

function computedFontSize(declarations, target, width, resolvingElements = new Set()) {
  if (!target || resolvingElements.has(target)) return undefined
  const winner = cascadeWinner(declarations, target, 'font-size', width)
  if (!winner) return computedFontSize(declarations, target.parentElement, width, new Set([...resolvingElements, target]))
  const resolved = resolveVars(winner.value, declarations, target, width)
  const match = /^(\d*(?:\.\d+)?)(px|em|rem)$/.exec(resolved || '')
  if (!match) return { winner, resolved, px: Number.NaN }
  const number = Number(match[1])
  if (match[2] === 'px') return { winner, resolved, px: number }
  if (match[2] === 'rem') return { winner, resolved, px: number * 16 }
  const parent = computedFontSize(declarations, target.parentElement, width, new Set([...resolvingElements, target]))
  return { winner, resolved, px: number * (parent?.px || 16) }
}

function templateFixture(path, predicate) {
  const elements = templateElementPath(path, predicate)
  const dom = new JSDOM(minimalDomFromTemplatePath(elements))
  let target = dom.window.document.body.firstElementChild
  while (target?.firstElementChild) target = target.firstElementChild
  assert.ok(target, `${path} template fixture must create a target`)
  return target
}

function cascadeStylePaths() {
  const imported = [...localVueImportGraph(representativeVueRoots)].filter(path => descriptor(path).styles.length > 0)
  return ['../styles/tokens.scss', '../styles/foundations.scss', '../styles/public-shell.scss', '../styles/global.scss', '../styles/mobile.scss', '../styles/console-shell.scss', '../styles/public-pricing.scss', ...imported]
}

function classifyFontSize({ selector, value }) {
  if (selector === '.model-icon' && value === '10px') return 'technical icon glyph'
  if (selector === '.pricing-drawer>header button' && value === '28px') return 'technical close glyph'
  if (['.theme-toggle', '.conv-more', '.conv-delete', '.send-btn'].includes(selector) && value === '18px') return 'technical icon control'
  if (selector === '.markdown-body :deep(code)' && value === '0.9em') return 'independent inline code scale'

  const token = /^var\(--font-size-([a-z-]+)\)$/.exec(value)?.[1]
  if (compactTokens.has(token)) return 'compact semantic token'
  if ((token === 'hero' || token === 'hero-mobile') && selector === '.public-hero h1') return 'Home hero exception'

  const pixels = /^(\d+(?:\.\d+)?)px$/.exec(value)
  const rem = /^(\d*(?:\.\d+)?)rem$/.exec(value)
  if (!pixels && !rem) return null
  const size = pixels ? Number(pixels[1]) : Number(rem[1]) * 16
  if (size === 11 || (size >= 12 && size <= 14) || [16, 20, 30].includes(size)) return 'approved compact literal'
  if (size >= 28 && size <= 36 && new Set(['.plan-card .price', '.detail-price-card strong']).has(selector)) return 'approved price exception'
  if ([34, 44].includes(size) && selector === '.public-hero h1') return 'Home hero exception'
  return null
}

function assertSemantic(path, selector, token, property = 'font-size') {
  const found = declarations(path, selector, property)
  assert.deepEqual(found.map(item => item.value), [`var(--font-size-${token})`],
    `${path} ${selector} ${property} must use --font-size-${token}; found ${found.map(item => item.value).join(', ') || `no ${property} declaration`}`)
}

function assertSemanticBatch(specifications) {
  const failures = []
  for (const [path, selector, token, property] of specifications) {
    try { assertSemantic(path, selector, token, property) }
    catch (error) { failures.push(error.message) }
  }
  assert.deepEqual(failures, [], failures.join('\n'))
}

function assertSemanticOrExact(path, selector, token) {
  const found = declarations(path, selector)
  const approved = new Set([`var(--font-size-${token})`, tokenPixels[token]])
  assert.deepEqual(found.length, 1, `${path} ${selector} must declare one font-size; found ${found.length}`)
  assert.ok(approved.has(found[0].value), `${path} ${selector} must use --font-size-${token} or ${tokenPixels[token]}; found ${found[0].value}`)
}

function assertAllowedValues(path, selector, approved) {
  const found = declarations(path, selector)
  assert.ok(found.length > 0, `${path} ${selector} must declare font-size`)
  const invalid = found.filter(item => !approved.has(item.value))
  assert.deepEqual(invalid, [], `${path} ${selector} has unapproved font-size values: ${invalid.map(item => item.value).join(', ')}`)
}

function assertApprovedPixels(path, selector, minimum, maximum) {
  const found = declarations(path, selector)
  assert.equal(found.length, 1, `${path} ${selector} must declare one approved font-size`)
  const match = /^(\d+(?:\.\d+)?)px$/.exec(found[0].value)
  assert.ok(match, `${path} ${selector} must use an explicit px exception; found ${found[0].value}`)
  const value = Number(match[1])
  assert.ok(value >= minimum && value <= maximum, `${path} ${selector} must stay in ${minimum}-${maximum}px; found ${value}px`)
}

test('representative page families retain real template ancestry for the typography cascade', () => {
  const families = [
    ['login', './Login.vue', 'auth-page'], ['register', './Register.vue', 'auth-page'],
    ['chat', './Chat.vue', 'chat-workspace'], ['billing', './Billing.vue', 'console-page'],
    ['API keys', './ApiKeys.vue', 'console-page'], ['profile', './Profile.vue', 'console-page'],
    ['users', './Users.vue', 'user-admin-page'], ['user detail', './UserDetail.vue', 'user-detail-page'],
    ['public models admin', './PublicModelsAdmin.vue', 'console-page'],
    ['public pricing admin', './PublicPricingAdmin.vue', 'console-page'],
    ['public content admin', './PublicContentAdmin.vue', 'console-page'],
    ['notifications', './RootNotifications.vue', 'console-page'],
    ['native dialog', './PublicContentAdmin.vue', 'responsive-dialog'],
    ['Element dialog', '../components/public-admin/PublicModelForm.vue', 'responsive-dialog'],
    ['responsive table', './Users.vue', 'responsive-table'],
    ['public pricing table', '../components/public/PricingTable.vue', 'pricing-table'],
    ['status badge', '../components/shell/StatusBadge.vue', 'status-badge'],
    ['mobile drawer', '../components/mobile/MobileDrawer.vue', 'drawer-header'],
    ['pricing mobile drawer', './public/Pricing.vue', 'pricing-drawer'],
    ['public model detail', './public/ModelPricingDetail.vue', 'pricing-detail'],
    ['home hero', './public/Home.vue', 'public-hero'],
  ]
  for (const [family, path, className] of families) {
    assert.ok(templateClasses(path).has(className), `${family} must render .${className}`)
  }
})

test('shared console, dialog, table and badge rules resolve to the compact semantic scale', () => {
  assertSemanticBatch([
    ['../styles/console-pages.scss', '.console-page h2', 'subtitle'],
    ['../styles/console-pages.scss', '.console-page h3', 'body'],
    ['../styles/global.scss', '.el-dialog', 'subtitle', '--el-dialog-title-font-size'],
    ['../styles/global.scss', '.el-table', 'body'],
    ['../styles/global.scss', '.el-table th.el-table__cell', 'sm'],
    ['../styles/global.scss', '.el-tag', 'sm'],
    ['../styles/console-shell.scss', '.status-badge', 'sm'],
  ])
})

test('remaining functional titles and mobile labels use semantic tokens', () => {
  const failures = []
  for (const [path, selector, token] of [
    ['./Chat.vue', '.panel-label', 'body'],
    ['./Chat.vue', '.mobile-bar .mobile-title', 'subtitle'],
    ['./Billing.vue', '.section-title', 'subtitle'],
    ['./UserDetail.vue', '.title', 'page-title'],
    ['../components/mobile/MobileDrawer.vue', '.drawer-header', 'subtitle'],
    ['../components/public/PricingCards.vue', '.pricing-card h2', 'subtitle'],
  ]) {
    try { assertSemanticOrExact(path, selector, token) }
    catch (error) { failures.push(error.message) }
  }
  for (const specification of [
    ['../styles/mobile.scss', '.drawer-nav-menu .el-menu-item', 'body'],
    ['../components/admin/UserPermissionEditor.vue', '.permission-editor__module h3', 'subtitle'],
    ['../styles/public-pricing.scss', '.pricing-drawer h2', 'subtitle'],
    ['../styles/public-pricing.scss', '.detail-price-card h2', 'subtitle'],
  ]) {
    try { assertSemantic(...specification) }
    catch (error) { failures.push(error.message) }
  }
  assert.deepEqual(failures, [], failures.join('\n'))
})

test('chat welcome title resolves through the ordered desktop and mobile cascade', () => {
  const templatePath = templateElementPath('../components/chat/ChatMessageList.vue', (node, path) =>
    node.tag === 'h2' && path.some(ancestor => staticClasses(ancestor).includes('welcome')))
  assert.equal(templatePath[0].tag, 'div', 'cascade fixture root tag must come from the real ChatMessageList template')
  assert.ok(staticClasses(templatePath[0]).includes('message-list-shell'), 'cascade fixture root class must come from the real ChatMessageList template')
  const dom = new JSDOM(minimalDomFromTemplatePath(templatePath))
  const title = dom.window.document.querySelector('.message-list-shell>.message-list>.welcome>h2')
  const desktop = effectiveMatchedFontSize('../components/chat/ChatMessageList.vue', title, 769)
  const mobile = effectiveMatchedFontSize('../components/chat/ChatMessageList.vue', title, 768)
  assert.equal(desktop?.value, '20px', `desktop welcome title must resolve to 20px; winner ${desktop ? `${desktop.selector} => ${desktop.value}` : 'missing'}`)
  assert.equal(mobile?.value, 'var(--font-size-subtitle)', `<=768px welcome title must resolve to --font-size-subtitle; winner ${mobile ? `${mobile.selector} => ${mobile.value}` : 'missing'}`)
  assert.ok(mobile?.media.some(query => /max-width\s*:\s*768px/i.test(query)), 'mobile .welcome h2 must be guarded by max-width: 768px')
})

test('representative SFC and shared style declarations reject unscoped display type', () => {
  const failures = []
  const graph = localVueImportGraph(representativeVueRoots)
  assert.ok(graph.has(new URL('../components/chat/MarkdownContent.vue', import.meta.url).href), 'Chat import graph must include MarkdownContent.vue')
  for (const path of auditedStylePaths()) {
    for (const declaration of fontSizeDeclarations(path)) {
      if (!classifyFontSize(declaration)) {
        failures.push(`${declaration.file} ${declaration.selector} has unapproved font-size ${declaration.value}${declaration.media.length ? ` under ${declaration.media.join(' -> ')}` : ''}`)
      }
    }
  }
  assert.deepEqual(failures, [], failures.join('\n'))
})

test('all repaired targets resolve their final cascade to compact pixels', () => {
  const declarations = cascadeDeclarations(cascadeStylePaths())
  const billingH2 = templateFixture('./Billing.vue', node => node.tag === 'h2' && staticClasses(node).includes('section-title'))
  const billingH3 = templateFixture('./Billing.vue', (node, path) => node.tag === 'h3' && path.some(ancestor => staticClasses(ancestor).includes('plan-card')))
  const permissionH3 = templateFixture('../components/admin/UserPermissionEditor.vue', node => node.tag === 'h3')
  const pricingDrawerH2 = templateFixture('./public/Pricing.vue', node => node.tag === 'h2' && staticAttributes(node).some(([name, value]) => name === 'id' && value === 'pricing-filter-title'))
  const detailPriceH2 = templateFixture('./public/ModelPricingDetail.vue', (node, path) => node.tag === 'h2' && path.some(ancestor => staticClasses(ancestor).includes('detail-price-card')))
  const welcomeH2 = templateFixture('../components/chat/ChatMessageList.vue', (node, path) => node.tag === 'h2' && path.some(ancestor => staticClasses(ancestor).includes('welcome')))

  const drawerPath = templateElementPath('../layouts/MainLayout.vue', (node, path) => node.tag === 'el-menu-item' && path.some(ancestor => staticClasses(ancestor).includes('drawer-nav-menu')))
  assert.ok(drawerPath.some(node => node.tag === 'el-menu' && staticClasses(node).includes('drawer-nav-menu')), 'drawer output fixture must be anchored to the real Element menu template')
  const drawerDom = new JSDOM('<ul class="drawer-nav-menu" role="menu"><li class="el-menu-item" role="menuitem">Navigation</li></ul>')
  const drawerItem = drawerDom.window.document.querySelector('.drawer-nav-menu>.el-menu-item')

  const targets = [
    ['console-page h2', billingH2, width => 16],
    ['console-page h3', billingH3, width => 14],
    ['drawer menu item', drawerItem, width => 14],
    ['permission module h3', permissionH3, width => 16],
    ['pricing drawer h2', pricingDrawerH2, width => 16],
    ['detail price card h2', detailPriceH2, width => 16],
    ['welcome h2', welcomeH2, width => width <= 768 ? 16 : 20],
  ]
  for (const width of [767, 768, 769, 1440]) for (const [name, target, expected] of targets) {
    const actual = computedFontSize(declarations, target, width)
    const evidence = actual?.winner ? `${actual.winner.file} ${actual.winner.selector} => ${actual.winner.value} (${actual.resolved})` : 'no winning declaration'
    assert.equal(actual?.px, expected(width), `${name} must resolve to ${expected(width)}px at ${width}px; winner ${evidence}`)
  }
})

test('display typography is limited to the approved hero and price exceptions', () => {
  const hero = declarations('../styles/public-shell.scss', '.public-hero h1')
  assert.deepEqual(hero.map(item => item.value), ['var(--font-size-hero)', 'var(--font-size-hero-mobile)'], 'Home hero must keep its sole desktop/mobile display scale')
  assertApprovedPixels('./Billing.vue', '.plan-card .price', 28, 36)
  assertSemantic('../styles/public-pricing.scss', '.detail-price-card strong', 'page-title')

  const cascade = cascadeDeclarations(cascadeStylePaths())
  const heroTitle = templateFixture('./public/Home.vue', node => node.tag === 'h1' && staticAttributes(node).some(([name, value]) => name === 'id' && value === 'home-title'))
  const billingPrice = templateFixture('./Billing.vue', node => staticClasses(node).includes('price'))
  const detailPrice = templateFixture('./public/ModelPricingDetail.vue', (node, path) => node.tag === 'strong' && path.some(ancestor => staticClasses(ancestor).includes('detail-price-card')))
  for (const [width, expected] of [[767, 34], [768, 44], [1440, 44]]) {
    const actual = computedFontSize(cascade, heroTitle, width)
    assert.equal(actual?.px, expected, `Home hero must resolve to ${expected}px at ${width}px; winner ${actual?.winner?.selector || 'missing'} => ${actual?.winner?.value || 'missing'}`)
  }
  assert.equal(computedFontSize(cascade, billingPrice, 1440)?.px, 28, 'billing currency emphasis must resolve to its approved 28px exception')
  assert.equal(computedFontSize(cascade, detailPrice, 1440)?.px, 20, 'public detail price must retain its approved compact 20px value')
})
