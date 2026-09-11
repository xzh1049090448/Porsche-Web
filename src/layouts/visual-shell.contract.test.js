import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc'
import { JSDOM } from 'jsdom'

const read = path => readFile(new URL(path, import.meta.url), 'utf8')
const dataModule = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`

async function mountedMainLayout() {
  const source = await read('./MainLayout.vue')
  const descriptor = parse(source, { filename: 'MainLayout.vue' }).descriptor
  const script = compileScript(descriptor, { id: 'visual-shell-navigation', genDefaultAs: '__sfc__' })
  const template = compileTemplate({ id: 'visual-shell-navigation', filename: 'MainLayout.vue', source: descriptor.template.content, compilerOptions: { bindingMetadata: script.bindings } })
  assert.deepEqual(template.errors, [])

  const vueURL = new URL('../../node_modules/vue/index.mjs', import.meta.url).href
  const componentStub = dataModule(`import{h}from'${vueURL}';export default{setup(_,ctx){return()=>h('span',ctx.slots.default?.())}}`)
  const drawerStub = dataModule(`import{h}from'${vueURL}';export default{props:['show'],emits:['update:show'],setup(_,ctx){return()=>h('aside',{'data-mobile-drawer':''},ctx.slots.default?.())}}`)
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

test('current public and authenticated layouts keep stable accessible landmarks', async () => {
  const [publicLayout, mainLayout] = await Promise.all([
    read('./PublicLayout.vue'),
    read('./MainLayout.vue'),
  ])

  assert.match(publicLayout, /class="public-layout"/)
  assert.match(publicLayout, /class="public-skip-link"[^>]+href="#public-content"/)
  assert.match(publicLayout, /<main id="public-content" tabindex="-1">/)
  assert.match(publicLayout, /<PublicHeader/)
  assert.match(publicLayout, /<PublicFooter/)

  assert.match(mainLayout, /class="main-layout"/)
  assert.match(mainLayout, /<AuthStatus/)
  assert.match(mainLayout, /class="app-header"/)
  assert.match(mainLayout, /class="header-menu desktop-only"/)
  assert.match(mainLayout, /<MobileDrawer/)
  assert.match(mainLayout, /<el-main class="app-main">/)
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
  for (const key of ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'SVGElement', 'Event', 'MouseEvent']) {
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: dom.window[key] })
  }
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
    const wrapper = mount(MainLayout, { global: { stubs: {
      ElContainer: Pass, ElHeader: Pass, ElMain: Pass, ElButton: Pass, ElDropdown: Pass,
      ElDropdownMenu: Pass, ElDropdownItem: Pass, ElAvatar: Pass, ElIcon: Pass, ElTag: Pass,
      ElMenu: Menu, ElMenuItem: MenuItem, RouterView: Pass,
    } } })
    for (const selector of ['nav.header-menu', 'nav.drawer-nav-menu']) {
      const routes = wrapper.get(selector).findAll('[data-route]').map(item => item.attributes('data-route'))
      assert.equal(routes.includes('/users'), scenario.users, `${selector} users.read ${scenario.permissions.length > 0}`)
      for (const route of rootRoutes) assert.equal(routes.includes(route), scenario.root, `${selector} ${route} role ${scenario.role}`)
    }
    wrapper.unmount()
  }
  delete globalThis.__visualShell
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

test.todo('Task 4 replaces the current public-layout marker with public-shell')
test.todo('Task 3 replaces the current authenticated layout with console-shell and console-sidebar landmarks')
