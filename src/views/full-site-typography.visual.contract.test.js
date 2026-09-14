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

const auditedStylePaths = [
  './Login.vue', './Register.vue', './Chat.vue', './Billing.vue', './ApiKeys.vue', './Profile.vue',
  './Users.vue', './UserDetail.vue', './PublicModelsAdmin.vue', './PublicPricingAdmin.vue',
  './PublicContentAdmin.vue', './RootNotifications.vue',
  '../components/public-admin/PublicModelForm.vue', '../components/public/PricingTable.vue',
  '../components/public/PricingCards.vue', '../components/mobile/MobileDrawer.vue',
  '../components/chat/ChatMessageList.vue', '../components/admin/UserPermissionEditor.vue',
  '../styles/console-pages.scss', '../styles/global.scss', '../styles/console-shell.scss',
  '../styles/mobile.scss', '../styles/public-pricing.scss', '../styles/public-shell.scss',
]

function descriptor(path) {
  const parsed = vueCompiler.parse(read(path), { filename: path })
  assert.equal(parsed.errors.length, 0, `${path} must parse as a Vue SFC`)
  return parsed.descriptor
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

function selectorSpecificity(selector) {
  let score = 0
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
    if (name !== 'where') {
      score += ['is', 'not', 'has'].includes(name)
        ? Math.max(0, ...postcss.list.comma(selector.slice(open + 1, end - 1)).map(selectorSpecificity))
        : 10
    }
    cursor = end
  }
  return score
    + (plain.match(/#[\w-]+/g) || []).length * 100
    + (plain.match(/\.[\w-]+|\[[^\]]+\]|:(?!:)[\w-]+/g) || []).length * 10
    + (plain.match(/(?:^|[\s>+~])(?:[a-z][\w-]*|\*)/gi) || []).filter(token => !token.trim().endsWith('*')).length
}

function effectiveMatchedFontSize(path, target, width) {
  let winner
  for (const declaration of fontSizeDeclarations(path)) {
    if (!declaration.media.every(query => mediaQueryApplies(query, width))) continue
    const selector = selectorForDom(declaration.selector)
    if (!selector) continue
    try { if (!target.matches(selector)) continue } catch { continue }
    const candidate = { ...declaration, specificity: selectorSpecificity(selector) }
    if (!winner
      || Number(candidate.important) > Number(winner.important)
      || (candidate.important === winner.important && (candidate.specificity > winner.specificity
        || (candidate.specificity === winner.specificity && candidate.order > winner.order)))) winner = candidate
  }
  return winner
}

function classifyFontSize({ selector, value }) {
  if (selector === '.model-icon' && value === '10px') return 'technical icon glyph'
  if (selector === '.pricing-drawer>header button' && value === '28px') return 'technical close glyph'

  const token = /^var\(--font-size-([a-z-]+)\)$/.exec(value)?.[1]
  if (compactTokens.has(token)) return 'compact semantic token'
  if ((token === 'hero' || token === 'hero-mobile') && selector === '.public-hero h1') return 'Home hero exception'

  const pixels = /^(\d+(?:\.\d+)?)px$/.exec(value)
  if (!pixels) return null
  const size = Number(pixels[1])
  if ([11, 12, 13, 14, 16, 20, 30].includes(size)) return 'approved compact literal'
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
  const dom = new JSDOM('<section class="message-list-shell conversation-surface"><div class="message-list"><div class="welcome"><h2>Welcome</h2></div></div></section>')
  const title = dom.window.document.querySelector('.message-list-shell>.message-list>.welcome>h2')
  const desktop = effectiveMatchedFontSize('../components/chat/ChatMessageList.vue', title, 769)
  const mobile = effectiveMatchedFontSize('../components/chat/ChatMessageList.vue', title, 768)
  assert.equal(desktop?.value, '20px', `desktop welcome title must resolve to 20px; winner ${desktop ? `${desktop.selector} => ${desktop.value}` : 'missing'}`)
  assert.equal(mobile?.value, 'var(--font-size-subtitle)', `<=768px welcome title must resolve to --font-size-subtitle; winner ${mobile ? `${mobile.selector} => ${mobile.value}` : 'missing'}`)
  assert.ok(mobile?.media.some(query => /max-width\s*:\s*768px/i.test(query)), 'mobile .welcome h2 must be guarded by max-width: 768px')
})

test('representative SFC and shared style declarations reject unscoped display type', () => {
  const failures = []
  for (const path of auditedStylePaths) {
    for (const declaration of fontSizeDeclarations(path)) {
      if (!classifyFontSize(declaration)) {
        failures.push(`${declaration.file} ${declaration.selector} has unapproved font-size ${declaration.value}${declaration.media.length ? ` under ${declaration.media.join(' -> ')}` : ''}`)
      }
    }
  }
  assert.deepEqual(failures, [], failures.join('\n'))
})

test('display typography is limited to the approved hero and price exceptions', () => {
  const hero = declarations('../styles/public-shell.scss', '.public-hero h1')
  assert.deepEqual(hero.map(item => item.value), ['var(--font-size-hero)', 'var(--font-size-hero-mobile)'], 'Home hero must keep its sole desktop/mobile display scale')
  assertApprovedPixels('./Billing.vue', '.plan-card .price', 28, 36)
  assertSemantic('../styles/public-pricing.scss', '.detail-price-card strong', 'page-title')
})
