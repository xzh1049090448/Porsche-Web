import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { baseParse } from '@vue/compiler-dom'
import { parse as parseSfc } from '@vue/compiler-sfc'
import { parse, parseExpression } from '@babel/parser'
import postcss from 'postcss'
import { messages } from '../../i18n/messages.js'
import { publicMessages } from '../../i18n/public-messages.js'
import { routes } from '../../router/index.js'

const source = path => readFileSync(new URL(path, import.meta.url), 'utf8')
const templateAst = value => baseParse(parseSfc(value).descriptor.template?.content || '')
const elements = (value, name) => {
  const matches = []
  const visit = node => {
    if (node.type === 1 && node.tag === name) matches.push(node)
    for (const child of node.children || []) visit(child)
  }
  visit(templateAst(value))
  return matches
}
const staticAttribute = (node, name) => node.props.find(prop => prop.type === 6 && prop.name === name)?.value?.content
const boundAttribute = (node, name) => node.props.find(prop => prop.type === 7 && prop.name === 'bind' && prop.arg?.type === 4 && prop.arg.content === name)?.exp?.content
const dataSectionOrder = value => {
  const order = []
  const visit = node => {
    if (node.type === 1) {
      const section = staticAttribute(node, 'data-section')
      if (section) order.push(section)
    }
    for (const child of node.children || []) visit(child)
  }
  visit(templateAst(value))
  return order
}
const staticBindingInitializers = value => {
  const bindings = new Map()
  const descriptor = parseSfc(value).descriptor
  for (const block of [descriptor.script, descriptor.scriptSetup].filter(Boolean)) {
    let ast
    try { ast = parse(block.content, { sourceType: 'module', plugins: ['typescript'] }) }
    catch { continue }
    for (const statement of ast.program.body) {
      const node = statement.type === 'ExportNamedDeclaration' ? statement.declaration : statement
      if (node?.type === 'VariableDeclaration' && node.kind === 'const') for (const declaration of node.declarations) {
        if (declaration.id.type !== 'Identifier' || !declaration.init) continue
        if (!bindings.has(declaration.id.name)) bindings.set(declaration.id.name, [])
        bindings.get(declaration.id.name).push(declaration.init)
      }
    }
  }
  return bindings
}
const staticExpressionPossibilities = (node, bindings, resolving = new Set()) => {
  if (node?.type === 'StringLiteral' || node?.type === 'NumericLiteral' || node?.type === 'BooleanLiteral') return [node.value]
  if (node?.type === 'NullLiteral') return [null]
  if (node?.type === 'ParenthesizedExpression' || node?.type === 'TSAsExpression' || node?.type === 'TSTypeAssertion' || node?.type === 'TSNonNullExpression') return staticExpressionPossibilities(node.expression, bindings, resolving)
  if (node?.type === 'Identifier') {
    if (resolving.has(node.name)) return []
    const next = new Set(resolving).add(node.name)
    return (bindings.get(node.name) || []).flatMap(initializer => staticExpressionPossibilities(initializer, bindings, next))
  }
  if (node?.type === 'BinaryExpression' && node.operator === '+') {
    const left = staticExpressionPossibilities(node.left, bindings, resolving)
    const right = staticExpressionPossibilities(node.right, bindings, resolving)
    return left.flatMap(leftValue => right.map(rightValue => leftValue + rightValue))
  }
  if (node?.type === 'ConditionalExpression') return [node.consequent, node.alternate].flatMap(branch => staticExpressionPossibilities(branch, bindings, resolving))
  if (node?.type === 'LogicalExpression') return [node.left, node.right].flatMap(branch => staticExpressionPossibilities(branch, bindings, resolving))
  if (node?.type === 'SequenceExpression') return staticExpressionPossibilities(node.expressions.at(-1), bindings, resolving)
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
  // Calls, member reads, and other dynamic code are intentionally not executed or guessed.
  return []
}
const outputBindingRoots = node => {
  const roots = new Set()
  const visit = value => {
    if (!value || typeof value !== 'object') return
    if (value.type === 'Identifier') { roots.add(value.name); return }
    if (value.type === 'ConditionalExpression') { visit(value.consequent); visit(value.alternate); return }
    if (value.type === 'CallExpression' || value.type === 'OptionalCallExpression' || value.type === 'NewExpression') { value.arguments.forEach(visit); return }
    if (value.type === 'MemberExpression' || value.type === 'OptionalMemberExpression') { visit(value.object); if (value.computed) visit(value.property); return }
    if (value.type === 'ObjectProperty') { if (value.computed) visit(value.key); visit(value.value); return }
    if (value.type === 'ObjectMethod' || value.type === 'FunctionExpression' || value.type === 'ArrowFunctionExpression') return
    for (const child of Object.values(value)) {
      if (Array.isArray(child)) child.forEach(visit)
      else if (child && typeof child === 'object' && typeof child.type === 'string') visit(child)
    }
  }
  visit(node)
  return roots
}
const referencedBindingLeaves = (name, bindings, resolving = new Set()) => {
  if (resolving.has(name)) return []
  const next = new Set(resolving).add(name)
  return (bindings.get(name) || []).flatMap(initializer => staticLiteralLeaves(initializer, bindings, next))
}
const staticLiteralLeaves = (node, bindings, resolving = new Set()) => {
  if (!node) return []
  const values = staticExpressionPossibilities(node, bindings, resolving).filter(value => typeof value === 'string' && value)
  if (node.type === 'Identifier') return values.concat(referencedBindingLeaves(node.name, bindings, resolving))
  if (node.type === 'CallExpression' || node.type === 'OptionalCallExpression' || node.type === 'NewExpression') return values.concat(node.arguments.flatMap(argument => staticLiteralLeaves(argument, bindings, resolving)))
  if (node.type === 'ObjectExpression') return values.concat(node.properties.flatMap(property => property.type === 'SpreadElement' ? staticLiteralLeaves(property.argument, bindings, resolving) : staticLiteralLeaves(property.value, bindings, resolving)))
  if (node.type === 'ArrayExpression') return values.concat(node.elements.flatMap(element => staticLiteralLeaves(element, bindings, resolving)))
  if (node.type === 'MemberExpression' || node.type === 'OptionalMemberExpression') return values.concat(staticLiteralLeaves(node.object, bindings, resolving), node.computed ? staticLiteralLeaves(node.property, bindings, resolving) : [])
  if (node.type === 'ConditionalExpression') return values.concat(staticLiteralLeaves(node.consequent, bindings, resolving), staticLiteralLeaves(node.alternate, bindings, resolving))
  if (node.type === 'LogicalExpression' || node.type === 'BinaryExpression') return values.concat(staticLiteralLeaves(node.left, bindings, resolving), staticLiteralLeaves(node.right, bindings, resolving))
  if (node.type === 'TemplateLiteral') return values.concat(node.quasis.map(quasi => quasi.value.cooked ?? quasi.value.raw).filter(Boolean), node.expressions.flatMap(expression => staticLiteralLeaves(expression, bindings, resolving)))
  if (node.type === 'TaggedTemplateExpression') return values.concat(staticLiteralLeaves(node.quasi, bindings, resolving))
  if (node.type === 'SequenceExpression') return values.concat(node.expressions.flatMap(expression => staticLiteralLeaves(expression, bindings, resolving)))
  if (node.type === 'ParenthesizedExpression' || node.type === 'TSAsExpression' || node.type === 'TSTypeAssertion' || node.type === 'TSNonNullExpression' || node.type === 'UnaryExpression' || node.type === 'AwaitExpression') return values.concat(staticLiteralLeaves(node.expression || node.argument, bindings, resolving))
  if (node.type === 'ArrowFunctionExpression' || node.type === 'FunctionExpression') return values.concat(staticLiteralLeaves(node.body, bindings, resolving))
  if (node.type === 'BlockStatement') return values.concat(node.body.flatMap(statement => staticLiteralLeaves(statement, bindings, resolving)))
  if (node.type === 'ReturnStatement' || node.type === 'ExpressionStatement') return values.concat(staticLiteralLeaves(node.argument || node.expression, bindings, resolving))
  return values
}
const literalExpressionStrings = (expression, bindings) => {
  let ast
  try { ast = parseExpression(expression, { plugins: ['typescript'] }) }
  catch { return [] }
  const direct = staticExpressionPossibilities(ast, bindings).filter(value => typeof value === 'string' && value)
  const referenced = [...outputBindingRoots(ast)].flatMap(name => referencedBindingLeaves(name, bindings))
  return [...new Set(direct.concat(referenced))]
}
const visibleStrings = value => {
  const result = []
  const bindings = staticBindingInitializers(value)
  const visibleAttributes = new Set(['alt', 'aria-label', 'placeholder', 'title', 'value'])
  const visit = node => {
    if (node.type === 2 && node.content.trim()) result.push(node.content.trim())
    if (node.type === 5) result.push(...literalExpressionStrings(node.content.content, bindings))
    if (node.type === 1) for (const prop of node.props) {
      if (prop.type === 6 && visibleAttributes.has(prop.name) && prop.value?.content) result.push(prop.value.content)
      const visibleBinding = prop.type === 7 && prop.name === 'bind' && prop.arg?.type === 4 && prop.arg.isStatic && visibleAttributes.has(prop.arg.content)
      const visibleDirective = prop.type === 7 && ['text', 'html'].includes(prop.name)
      if ((visibleBinding || visibleDirective) && prop.exp?.content) result.push(...literalExpressionStrings(prop.exp.content, bindings))
    }
    for (const child of node.children || []) visit(child)
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
const stripSafePerRequestCopy = value => value
  .replace(/每次请求不单独计价/g, '')
  .replace(/\bper[- ]request pricing is not offered\b/gi, '')
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
  [/(?:单次调用价|每次请求(?:价格|价)|每请求(?:价格|价)|per[- ]request\s+(?:price|pricing)|(?:[$¥￥]\s*\d+(?:\.\d+)?|\d+(?:\.\d+)?\s*(?:USD|CNY))\s*\/\s*request\b)/i, 'per-request pricing'],
]
const tailwindUrl = /(?:https?:)?\/\/[^\s"')]*(?:cdn\.tailwindcss\.com|tailwind)[^\s"')]*/i
const assertNoTailwindLoading = (cssSources, vueSources) => {
  const descriptors = vueSources.map(value => parseSfc(value).descriptor)
  for (const css of cssSources.concat(descriptors.flatMap(descriptor => descriptor.styles.map(style => style.content)))) {
    const root = postcss.parse(css)
    root.walkAtRules(rule => {
      if (['import', 'use'].includes(rule.name.toLowerCase())) assert.doesNotMatch(rule.params, tailwindUrl, 'public styles must not import Tailwind from a CDN')
    })
    root.walkDecls(declaration => assert.doesNotMatch(declaration.value, tailwindUrl, 'public styles must not load a Tailwind CDN URL'))
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
  assert.match(layout, /h\(PublicHeader/)
  assert.match(layout, /h\(PublicFooter/)
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
  const visibleCopy = vueSources.flatMap(visibleStrings).concat(runtimePublicMessages).map(stripSafePerRequestCopy)

  assertNoTailwindLoading(publicStyleSources, vueSources)

  assert.match(home, /<HeroPreview/)
  assert.equal((home.match(/<PublicSection/g) || []).length, 3)
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
})
