import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vuePlugin from '@vitejs/plugin-vue'
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
  try {
    assertAllowedValues('../components/chat/ChatMessageList.vue', '.welcome h2', new Set([
      '20px', '16px', 'var(--font-size-page-title)', 'var(--font-size-subtitle)',
    ]))
  } catch (error) { failures.push(error.message) }
  assert.deepEqual(failures, [], failures.join('\n'))
})

test('display typography is limited to the approved hero and price exceptions', () => {
  const hero = declarations('../styles/public-shell.scss', '.public-hero h1')
  assert.deepEqual(hero.map(item => item.value), ['var(--font-size-hero)', 'var(--font-size-hero-mobile)'], 'Home hero must keep its sole desktop/mobile display scale')
  assertApprovedPixels('./Billing.vue', '.plan-card .price', 28, 36)
  assertSemantic('../styles/public-pricing.scss', '.detail-price-card strong', 'page-title')
})
