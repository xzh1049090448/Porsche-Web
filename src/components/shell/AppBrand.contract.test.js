import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc'
import { JSDOM } from 'jsdom'

const vueUrl = new URL('../../../node_modules/vue/index.mjs', import.meta.url).href
const documentThemeUrl = new URL('../../composables/useDocumentTheme.js', import.meta.url).href
const dataModule = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
let moduleId = 0

test('authenticated console brand links to the public homepage', async () => {
  const source = await readFile(new URL('./AppBrand.vue', import.meta.url), 'utf8')
  assert.match(source, /<router-link\s+to="\/"\s+class="app-brand"/)
  assert.doesNotMatch(source, /<router-link\s+to="\/chat"\s+class="app-brand"/)
})

test('brand variants map to the AiPortCloud logo assets', async () => {
  const source = await readFile(new URL('./AppBrand.vue', import.meta.url), 'utf8')
  assert.match(source, /NAV_LOGOS = \{ light: '\/nav_logo\.png', dark: '\/dark_nav_logo\.png' \}/)
  // 页脚品牌区固定深色表面，故 brand 固定用近白字标；控制台图标随主题切换。
  assert.match(source, /VARIANT_LOGOS = \{\s*brand: '\/dark_logo\.png',\s*icon: \{ light: '\/icon_only\.png', dark: '\/dark_icon\.png' \},\s*\}/)
})

async function compileAppBrand() {
  const source = await readFile(new URL('./AppBrand.vue', import.meta.url), 'utf8')
  const descriptor = parse(source, { filename: 'AppBrand.vue' }).descriptor
  const id = `app-brand-${++moduleId}`
  const script = compileScript(descriptor, { id, genDefaultAs: '__sfc__' })
  const template = compileTemplate({
    id,
    filename: 'AppBrand.vue',
    source: descriptor.template.content,
    compilerOptions: { bindingMetadata: script.bindings },
  })
  assert.deepEqual(template.errors, [])
  // 主题组合式函数用真实实现，主题切换行为才可验证；它自身导入的是裸 'vue'，
  // 与 vueUrl 指向同一模块文件。
  const code = `${script.content}\n${template.code}\n__sfc__.render = render\nexport default __sfc__`
    .replaceAll("from 'vue'", `from '${vueUrl}'`)
    .replaceAll('from "vue"', `from '${vueUrl}'`)
    .replaceAll("from '@/composables/useDocumentTheme.js'", `from '${documentThemeUrl}'`)
    .replaceAll('from "@/composables/useDocumentTheme.js"', `from '${documentThemeUrl}'`)
  return (await import(`${dataModule(code)}#${id}`)).default
}

// 单个 jsdom 复用：vue 的 runtime-dom 在首次导入时捕获 document 并引用
// SVGElement/HTMLElement 等构造器，因此既要共享同一份文档，也要把这些
// 全局补上（构造器不能 bind，否则 instanceof 失效）。
const DOM_GLOBALS = [
  'window', 'document', 'MutationObserver', 'Element', 'HTMLElement', 'SVGElement',
  'Node', 'Text', 'Comment', 'DocumentFragment', 'Event', 'CustomEvent', 'MouseEvent',
]
const DOM_FUNCTIONS = ['getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame']

let shared
async function ensureDocument() {
  if (!shared) {
    const dom = new JSDOM('<!doctype html><html data-theme="light"><body></body></html>')
    for (const key of [...DOM_GLOBALS, ...DOM_FUNCTIONS]) {
      const value = dom.window[key]
      if (value === undefined) continue
      try {
        globalThis[key] = DOM_FUNCTIONS.includes(key) && typeof value === 'function' ? value.bind(dom.window) : value
      } catch { /* 宿主可能已有只读同名全局，保留宿主实现 */ }
    }
    shared = { dom, Component: await compileAppBrand(), vue: await import(vueUrl) }
  }
  return shared
}

/** 在主题设定后挂载 AppBrand，返回渲染出的 <img> 与主题切换入口。 */
async function mountAppBrand(variant, theme) {
  const { dom, Component, vue } = await ensureDocument()
  dom.window.document.documentElement.dataset.theme = theme
  const container = dom.window.document.createElement('div')
  dom.window.document.body.appendChild(container)

  const app = vue.createApp({ render: () => vue.h(Component, { variant, title: 'AiPortCloud', subtitle: '' }) })
  app.component('router-link', { props: ['to'], setup: (props, { slots }) => () => vue.h('a', { href: props.to }, slots.default?.()) })
  app.mount(container)
  await vue.nextTick()

  const setTheme = async value => {
    dom.window.document.documentElement.dataset.theme = value
    await new Promise(resolve => dom.window.setTimeout(resolve, 0))
    await vue.nextTick()
  }
  return {
    src: () => container.querySelector('.app-brand__icon').getAttribute('src'),
    isWordmark: () => container.querySelector('.app-brand').classList.contains('is-wordmark'),
    subtitle: () => container.querySelector('.app-brand__copy small'),
    setTheme,
    restore: () => { app.unmount(); container.remove() },
  }
}

test('navigation wordmark follows the document theme, including direct dataset writes', async () => {
  const mounted = await mountAppBrand('nav', 'light')
  try {
    assert.equal(mounted.src(), '/nav_logo.png')
    assert.equal(mounted.isWordmark(), true)
    // 副标题已从品牌配置中删除，字标旁不应再渲染 small。
    assert.equal(mounted.subtitle(), null)
    await mounted.setTheme('dark')
    assert.equal(mounted.src(), '/dark_nav_logo.png')
    await mounted.setTheme('light')
    assert.equal(mounted.src(), '/nav_logo.png')
  } finally { mounted.restore() }
})

test('brand uses its fixed surface asset while icon follows the theme', async () => {
  // 页脚是硬编码深色表面，与主题无关：两种主题下都必须用近白字标。
  const brand = await mountAppBrand('brand', 'light')
  try {
    assert.equal(brand.src(), '/dark_logo.png')
    assert.equal(brand.isWordmark(), true)
    await brand.setTheme('dark')
    assert.equal(brand.src(), '/dark_logo.png')
  } finally { brand.restore() }

  // 控制台顶栏随主题切换：深色用深色素材。
  const icon = await mountAppBrand('icon', 'light')
  try {
    assert.equal(icon.src(), '/icon_only.png')
    // 方形图标不含品牌名，保留标题文字。
    assert.equal(icon.isWordmark(), false)
    await icon.setTheme('dark')
    assert.equal(icon.src(), '/dark_icon.png')
    await icon.setTheme('light')
    assert.equal(icon.src(), '/icon_only.png')
  } finally { icon.restore() }
})
