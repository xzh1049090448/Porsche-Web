import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc'
import { JSDOM } from 'jsdom'

const read = path => readFile(new URL(path, import.meta.url), 'utf8')
const dataModule = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
const DOM_GLOBAL_KEYS = ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'SVGElement', 'XMLSerializer', 'Event', 'MouseEvent', 'getComputedStyle']
const originalDomDescriptors = new Map(DOM_GLOBAL_KEYS.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))

function installDomGlobals(dom) {
  for (const key of DOM_GLOBAL_KEYS) {
    const value = key === 'getComputedStyle' ? dom.window.getComputedStyle.bind(dom.window) : dom.window[key]
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
  }
}

function restoreDomGlobals() {
  for (const [key, descriptor] of originalDomDescriptors) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor)
    else delete globalThis[key]
  }
}

async function mountedMainLayout() {
  const source = await read('./MainLayout.vue')
  const descriptor = parse(source, { filename: 'MainLayout.vue' }).descriptor
  const script = compileScript(descriptor, { id: 'visual-shell-navigation', genDefaultAs: '__sfc__' })
  const template = compileTemplate({ id: 'visual-shell-navigation', filename: 'MainLayout.vue', source: descriptor.template.content, compilerOptions: { bindingMetadata: script.bindings } })
  assert.deepEqual(template.errors, [])

  const vueURL = new URL('../../node_modules/vue/index.mjs', import.meta.url).href
  const componentStub = dataModule(`import{h}from'${vueURL}';export default{setup(_,ctx){return()=>h('span',ctx.slots.default?.())}}`)
  const drawerStub = dataModule(`import{h}from'${vueURL}';export default{props:['show'],emits:['update:show'],setup(_,ctx){return()=>h('aside',{'data-mobile-drawer':''},ctx.slots.default?.())}}`)
  const sidebarStub = dataModule(`import{h}from'${vueURL}';export default{props:['items','activeRoute'],setup(p){return()=>h('nav',{'class':'console-sidebar'},p.items.map(item=>h('a',{'data-route':item.to,'aria-current':item.to===p.activeRoute?'page':undefined},item.label)))}}`)
  const routerStub = dataModule('export const useRoute=()=>globalThis.__visualShell.route;export const useRouter=()=>globalThis.__visualShell.router')
  const userStub = dataModule('export const useUserStore=()=>globalThis.__visualShell.userStore')
  const settingsStub = dataModule('export const useSettingsStore=()=>globalThis.__visualShell.settingsStore')
  const publicModelStub = dataModule('export const usePublicModelAdminStore=()=>globalThis.__visualShell.publicModelStore')
  const notificationStub = dataModule('export const useRootNotificationsStore=()=>globalThis.__visualShell.notificationsStore')
  const breakpointStub = dataModule(`import{ref}from'${vueURL}';export const useBreakpoint=()=>({isTablet:ref(false)})`)
  const i18nStub = dataModule('export const useI18n=()=>({t:key=>key})')
  const rootGuardStub = dataModule('export const installRuntimeRootGuard=()=>{}')
  const elementStub = dataModule('export const ElMessageBox={confirm:()=>Promise.reject(new Error("unused"))}')
  const iconsStub = dataModule(`import{h}from'${vueURL}';const icon={setup(){return()=>h('i')}};export{icon as ArrowDown,icon as ArrowLeft,icon as Menu,icon as ChatDotRound,icon as Wallet,icon as Key,icon as User,icon as Setting,icon as Bell}`)
  const replacements = new Map([
    ['vue', vueURL], ['vue-router', routerStub], ['@element-plus/icons-vue', iconsStub],
    ['@/stores/user', userStub], ['@/stores/settings', settingsStub],
    ['@/stores/publicModelAdmin', publicModelStub], ['@/stores/rootNotifications', notificationStub],
    ['@/components/mobile/MobileDrawer.vue', drawerStub], ['@/components/ThemeToggle.vue', componentStub],
    ['@/components/shell/ConsoleSidebar.vue', sidebarStub], ['@/components/shell/AppBrand.vue', componentStub],
    ['@/components/LocaleToggle.vue', componentStub], ['@/components/AuthStatus.vue', componentStub],
    ['@/components/RootNotificationBadge.vue', componentStub], ['@/composables/useBreakpoint', breakpointStub],
    ['@/composables/useI18n', i18nStub], ['@/router/runtime-root-guard.js', rootGuardStub],
    ['element-plus', elementStub],
  ])
  let code = `${script.content}\n${template.code}\n__sfc__.render=render\nexport default __sfc__`
  for (const [specifier, replacement] of replacements) {
    code = code.replaceAll(`from '${specifier}'`, `from '${replacement}'`).replaceAll(`from "${specifier}"`, `from "${replacement}"`)
  }
  return (await import(`${dataModule(code)}#${Date.now()}-${Math.random()}`)).default
}

async function mountedPublicHeader() {
  const source = await read('../components/public/PublicHeader.vue')
  const descriptor = parse(source, { filename: 'PublicHeader.vue' }).descriptor
  const script = compileScript(descriptor, { id: 'visual-public-header', genDefaultAs: '__sfc__' })
  const template = compileTemplate({ id: 'visual-public-header', filename: 'PublicHeader.vue', source: descriptor.template.content, compilerOptions: { bindingMetadata: script.bindings } })
  assert.deepEqual(template.errors, [])

  const vueURL = new URL('../../node_modules/vue/index.mjs', import.meta.url).href
  const routerStub = dataModule(`import{h}from'${vueURL}';export const RouterLink={props:['to'],setup(p,{attrs,slots}){return()=>h('a',{...attrs,href:p.to},slots.default?.())}}`)
  const i18nStub = dataModule(`import{ref}from'${vueURL}';export const usePublicI18n=()=>({locale:ref('zh'),t:key=>key,toggle(){}})`)
  let code = `${script.content}\n${template.code}\n__sfc__.render=render\nexport default __sfc__`
  code = code.replaceAll("from 'vue'", `from '${vueURL}'`).replaceAll('from "vue"', `from '${vueURL}'`)
  code = code.replaceAll("from 'vue-router'", `from '${routerStub}'`)
    .replaceAll("from '@/i18n/public-runtime.js'", `from '${i18nStub}'`)
  return (await import(`${dataModule(code)}#${Date.now()}-${Math.random()}`)).default
}

test('current public and authenticated layouts keep stable accessible landmarks', async () => {
  const [publicLayout, mainLayout] = await Promise.all([
    read('./PublicLayout.vue'),
    read('./MainLayout.vue'),
  ])

  assert.match(publicLayout, /class="[^"]*public-layout[^"]*"/)
  assert.match(publicLayout, /class="public-skip-link"[^>]+href="#public-content"/)
  assert.match(publicLayout, /<main id="public-content" tabindex="-1">/)
  assert.match(publicLayout, /<PublicHeader/)
  assert.match(publicLayout, /<PublicFooter/)

  assert.match(mainLayout, /class="main-layout console-shell"/)
  assert.match(mainLayout, /<AuthStatus/)
  assert.match(mainLayout, /class="[^"]*app-header[^"]*"/)
  assert.match(mainLayout, /<ConsoleSidebar/)
  assert.match(mainLayout, /<MobileDrawer/)
  assert.match(mainLayout, /<main[^>]+class="console-workspace"/)
})

test('authenticated navigation keeps users.read and Root visibility semantics', async () => {
  const mainLayout = await read('./MainLayout.vue')

  assert.match(mainLayout, /admin_permissions\?\.includes\(['"]users\.read['"]\) === true/)
  assert.match(mainLayout, /user\.value\?\.role === ['"]root['"]/)
  for (const path of [
    '/users',
    '/admin/public-models',
    '/admin/public-pricing',
    '/admin/public-content',
    '/admin/notifications',
  ]) assert.match(mainLayout, new RegExp(path.replaceAll('/', '\\/')))
  assert.match(mainLayout, /<router-view :key="userStore\.identityEpoch"/)

  const userStore = await read('../stores/user.js')
  assert.match(userStore, /const identityEpoch = ref\(authSession\.capture\(\)\.epoch\)/)
  assert.match(userStore, /identityEpoch\.value = next\.epoch/)
  assert.match(userStore, /return \{[^}]*identityEpoch/)
})

test('users.read and Root permissions gate both desktop and mobile navigation', async () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://local.test/chat' })
  try {
    installDomGlobals(dom)
    const [{ mount }, { reactive, h }] = await Promise.all([import('@vue/test-utils'), import('vue')])
    const MainLayout = await mountedMainLayout()
    const Pass = { setup: (_, { attrs, slots }) => () => h('div', attrs, slots.default?.()) }
    const Menu = { setup: (_, { attrs, slots }) => () => h('nav', attrs, slots.default?.()) }
    const MenuItem = { props: ['index'], setup: (props, { slots }) => () => h('a', { 'data-route': props.index }, slots.default?.()) }
    const scenarios = [
      { role: 'user', permissions: [], users: false, root: false },
      { role: 'user', permissions: ['users.read'], users: true, root: false },
      { role: 'root', permissions: [], users: false, root: true },
      { role: 'root', permissions: ['users.read'], users: true, root: true },
    ]
    const rootRoutes = ['/admin/public-models', '/admin/public-pricing', '/admin/public-content', '/admin/notifications']

    for (const scenario of scenarios) {
      globalThis.__visualShell = {
        route: reactive({ path: '/chat' }), router: { push() {}, replace() {}, back() {} },
        userStore: reactive({ user: { role: scenario.role, admin_permissions: scenario.permissions }, isLoggedIn: true, identityEpoch: 'epoch-1', totalTokensUsed: 0, refreshUsage: async () => {}, logout: async () => {} }),
        settingsStore: { loadModels: async () => {} }, publicModelStore: { setMutationContext() {}, cancel() {} }, notificationsStore: { unreadCount: 0 },
      }
      let wrapper
      try {
        wrapper = mount(MainLayout, { global: { stubs: {
          ElContainer: Pass, ElHeader: Pass, ElMain: Pass, ElButton: Pass, ElDropdown: Pass,
          ElDropdownMenu: Pass, ElDropdownItem: Pass, ElAvatar: Pass, ElIcon: Pass, ElTag: Pass,
          ElMenu: Menu, ElMenuItem: MenuItem, RouterView: Pass,
        } } })
        for (const selector of ['nav.console-sidebar', 'nav.drawer-nav-menu']) {
          const routes = wrapper.get(selector).findAll('[data-route]').map(item => item.attributes('data-route'))
          assert.equal(routes.includes('/users'), scenario.users, `${selector} users.read ${scenario.permissions.length > 0}`)
          for (const route of rootRoutes) assert.equal(routes.includes(route), scenario.root, `${selector} ${route} role ${scenario.role}`)
        }
      } finally {
        wrapper?.unmount()
      }
    }
  } finally {
    delete globalThis.__visualShell
    try { restoreDomGlobals() }
    finally { dom.window.close() }
  }
})

test('navigation mount restores every JSDOM global descriptor', () => {
  for (const [key, descriptor] of originalDomDescriptors) {
    assert.deepEqual(Object.getOwnPropertyDescriptor(globalThis, key), descriptor, key)
  }
})

test('application startup preserves public/auth bootstrap and recovery boundaries', async () => {
  const [main, router] = await Promise.all([
    read('../main.js'),
    read('../router/index.js'),
  ])

  assert.match(main, /bootstrapModeForPath\(router, window\.location\.pathname\)/)
  assert.match(main, /loadAuthApp/)
  assert.match(main, /mountPublicApp:[\s\S]*createPinia\(\)/)
  assert.match(main, /createLazyLoadFailureHandler/)
  assert.match(main, /fallback:\s*\(\) => renderSafeLoadError\(\)/)
  assert.match(router, /window\.location\.assign\(path\)/)
  assert.match(router, /installBootstrapHandoff/)
  assert.match(router, /installLoadFailureRecovery/)
})

test('public and authenticated bootstraps share semantic tokens and accessible foundations', async () => {
  const [main, tokens, foundations] = await Promise.all([
    read('../main.js'),
    read('../styles/tokens.scss'),
    read('../styles/foundations.scss'),
  ])

  assert.match(main, /import ['"]\.\/styles\/tokens\.scss['"]/)
  assert.match(main, /import ['"]\.\/styles\/foundations\.scss['"]/)
  assert.match(main, /mountPublicApp:/)
  assert.match(main, /import\(['"]element-plus['"]\)/)

  for (const token of [
    '--color-brand',
    '--color-brand-hover',
    '--color-brand-soft',
    '--surface-page',
    '--surface-card',
    '--text-primary',
    '--text-secondary',
    '--text-muted',
    '--border-default',
    '--state-success',
    '--control-min-size',
    '--header-height',
    '--sidebar-width',
  ]) assert.match(tokens, new RegExp(token))
  for (const value of ['#2563eb', '#1d4ed8', '#eff6ff', '#f8fafc', '#ffffff', '#e5e7eb', '#111827', '#4b5563', '#9ca3af', '#10b981', '#0f172a', '#273449', '#334155', '#f8fafc', '#94a3b8', '#3b82f6']) {
    assert.match(tokens.toLowerCase(), new RegExp(value))
  }
  assert.match(tokens, /--control-min-size:\s*44px/)
  assert.match(tokens, /--el-color-primary:\s*var\(--color-brand\)/)
  assert.match(tokens, /--el-bg-color-page:\s*var\(--surface-page\)/)
  assert.match(tokens, /@mixin dark-theme-tokens/)
  assert.equal(tokens.match(/@include dark-theme-tokens/g)?.length, 2)

  assert.match(foundations, /:focus-visible/)
  assert.match(foundations, /\.sr-only/)
  assert.match(foundations, /prefers-reduced-motion:\s*reduce/)
  assert.match(foundations, /font-family:/)
})

test('theme toggle keeps translated tooltip, accessible label, and button behavior', async () => {
  const toggle = await read('../components/ThemeToggle.vue')
  assert.match(toggle, /<el-tooltip :content="tooltip"/)
  assert.match(toggle, /:aria-label="tooltip"/)
  assert.match(toggle, /@click="themeStore\.toggleTheme\(\)"/)
  assert.match(toggle, /t\('theme\.toLight'\)/)
  assert.match(toggle, /t\('theme\.toDark'\)/)
})

test('Task 4 builds an accessible responsive public shell from a dedicated stylesheet', async () => {
  const [layout, header, footer, state, main, shell] = await Promise.all([
    read('./PublicLayout.vue'),
    read('../components/public/PublicHeader.vue'),
    read('../components/public/PublicFooter.vue'),
    read('../components/public/PublicContentState.vue'),
    read('../main.js'),
    read('../styles/public-shell.scss'),
  ])

  assert.match(layout, /class="public-layout public-shell"/)
  assert.match(layout, /class="public-skip-link"[^>]+href="#public-content"/)
  assert.match(layout, /<main id="public-content" tabindex="-1">/)
  assert.doesNotMatch(layout, /<style/)
  assert.match(header, /class="public-nav public-nav--desktop"/)
  assert.match(header, /class="public-nav-toggle"/)
  assert.match(header, /:aria-expanded="menuOpen"/)
  assert.match(header, /:aria-controls="navId"/)
  assert.match(header, /class="public-locale"/)
  assert.match(header, /class="public-theme"/)
  assert.match(header, /class="[^"]*public-console-cta[^"]*"/)
  assert.match(footer, /<footer[^>]+class="public-footer"/)
  assert.match(state, /aria-live="polite"/)
  assert.match(main, /import ['"]\.\/styles\/public-shell\.scss['"]/)
  assert.match(shell, /height:\s*var\(--header-height\)/)
  assert.match(shell, /min-(?:width|height):\s*var\(--control-min-size\)/)
  assert.match(shell, /@media\s*\(max-width:\s*767px\)/)
  assert.match(shell, /@media\s*\(min-width:\s*768px\)/)
  assert.match(shell, /prefers-reduced-motion:\s*reduce/)
  assert.match(shell, /html\[data-theme=['"]dark['"]\]/)
})

test('public mobile navigation reports state and closes after route selection', async () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://local.test/' })
  try {
    installDomGlobals(dom)
    const [{ mount }, { nextTick }] = await Promise.all([import('@vue/test-utils'), import('vue')])
    const PublicHeader = await mountedPublicHeader()
    const wrapper = mount(PublicHeader)
    try {
      const toggle = wrapper.element.querySelector('.public-nav-toggle')
      assert.equal(toggle.getAttribute('aria-expanded'), 'false')
      assert.equal(toggle.getAttribute('aria-controls'), 'public-mobile-nav')
      toggle.click()
      await nextTick()
      assert.equal(toggle.getAttribute('aria-expanded'), 'true')
      wrapper.element.querySelector('#public-mobile-nav a[href="/pricing"]').click()
      await nextTick()
      assert.equal(toggle.getAttribute('aria-expanded'), 'false')
    } finally {
      wrapper.unmount()
    }
  } finally {
    restoreDomGlobals()
    dom.window.close()
  }
})

test('Task 3 builds one console shell around desktop, mobile, and main landmarks', async () => {
  const [mainLayout, main, sidebar] = await Promise.all([
    read('./MainLayout.vue'),
    read('../main.js'),
    read('../components/shell/ConsoleSidebar.vue'),
  ])

  assert.match(mainLayout, /class="[^"]*console-shell[^"]*"/)
  assert.match(mainLayout, /class="[^"]*console-topbar[^"]*"/)
  assert.match(mainLayout, /<ConsoleSidebar\s+:items="navigation"\s+:active-route="activeMenu"/)
  assert.match(mainLayout, /class="drawer-nav-menu"[\s\S]*v-for="item in navigation"/)
  assert.match(mainLayout, /<main[^>]+class="console-workspace"[^>]+tabindex="-1"/)
  assert.match(main, /import\(['"]\.\/styles\/console-shell\.scss['"]\)/)
  assert.match(sidebar, /aria-label=/)
  assert.match(sidebar, /aria-current=/)
})

test('Task 3 exposes a single permission-filtered navigation model with grouped Root entries', async () => {
  const mainLayout = await read('./MainLayout.vue')

  assert.equal((mainLayout.match(/const navigation = computed/g) || []).length, 1)
  assert.match(mainLayout, /visible:\s*canManageUsers\.value/)
  assert.match(mainLayout, /visible:\s*isRoot\.value/)
  assert.match(mainLayout, /group:\s*['"]root['"]/)
  assert.match(mainLayout, /\.filter\(item => item\.visible\)/)
  assert.match(mainLayout, /v-if="isRoot && item\.to === '\/admin\/notifications'"/)
})

test('Task 3 shared page primitives stay presentational and StatusBadge exposes text', async () => {
  const [pageHeader, surfaceCard, statusBadge] = await Promise.all([
    read('../components/shell/PageHeader.vue'),
    read('../components/shell/SurfaceCard.vue'),
    read('../components/shell/StatusBadge.vue'),
  ])

  assert.match(pageHeader, /name="actions"/)
  assert.match(pageHeader, /eyebrow/)
  assert.match(pageHeader, /description/)
  assert.match(surfaceCard, /<section/)
  assert.match(statusBadge, /status/)
  assert.match(statusBadge, /<span[^>]*>[\s\S]*<slot/)
  for (const source of [pageHeader, surfaceCard, statusBadge]) {
    assert.doesNotMatch(source, /useUserStore|useRouter|@\/api|fetch\(|axios/)
  }
})
