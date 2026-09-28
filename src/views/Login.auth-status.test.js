import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc'
import { JSDOM } from 'jsdom'

const vueUrl = new URL('../../node_modules/vue/index.mjs', import.meta.url).href
const vueRouterUrl = new URL('../../node_modules/vue-router/dist/vue-router.mjs', import.meta.url).href
const safeRedirectUrl = new URL('../utils/auth-redirect.js', import.meta.url).href
let moduleId = 0

const dataModule = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
const replaceImports = (code, replacements) => {
  for (const [specifier, replacement] of replacements) {
    code = code.replaceAll(`from '${specifier}'`, `from '${replacement}'`)
      .replaceAll(`from "${specifier}"`, `from "${replacement}"`)
  }
  return code
}

async function compileComponent(relativePath, replacements) {
  const filename = relativePath.split('/').at(-1)
  const source = await readFile(new URL(relativePath, import.meta.url), 'utf8')
  const descriptor = parse(source, { filename }).descriptor
  const id = `auth-recovery-${++moduleId}`
  const script = compileScript(descriptor, { id, genDefaultAs: '__sfc__' })
  const template = compileTemplate({
    id,
    filename,
    source: descriptor.template.content,
    compilerOptions: { bindingMetadata: script.bindings },
  })
  assert.deepEqual(template.errors, [])
  let code = `${script.content}\n${template.code}\n__sfc__.render = render\nexport default __sfc__`
  code = replaceImports(code, [['vue', vueUrl], ...replacements])
  return (await import(`${dataModule(code)}#${id}`)).default
}

function deferred() {
  let resolve
  let reject
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

async function flush(wrapper) {
  await Promise.resolve()
  await new Promise(resolve => setTimeout(resolve, 0))
  await wrapper.vm.$nextTick()
}

function installDom() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://local.test/login' })
  for (const key of ['window', 'document', 'navigator', 'history', 'location', 'Node', 'Element', 'HTMLElement', 'SVGElement', 'Event', 'XMLSerializer']) {
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: dom.window[key] })
  }
}
installDom()
const testLibraries = Promise.all([import('@vue/test-utils'), import('vue'), import('vue-router')])
const setupDom = () => testLibraries

const elementStubs = {
  ElAlert: { props: ['title'], template: '<section role="alert"><h2>{{ title }}</h2><slot /></section>' },
  ElButton: { props: ['disabled', 'loading'], template: '<button :disabled="disabled" :data-loading="String(Boolean(loading))"><slot /></button>' },
  ElForm: { template: '<form><slot /></form>' },
  ElFormItem: { template: '<label><slot /></label>' },
  ElInput: { template: '<input />' },
}

async function mountAuthStatus({ issue = 'auth_uncertain', recover }) {
  const [{ mount }, { reactive }] = await setupDom()
  const store = reactive({ authState: 'uncertain', authIssue: issue })
  globalThis.__authRecoveryFixture = { store, recover }
  const storeStub = dataModule('export const useUserStore = () => globalThis.__authRecoveryFixture.store')
  const requestStub = dataModule('export const authSession = { recover: (...args) => globalThis.__authRecoveryFixture.recover(...args) }')
  const component = await compileComponent('../components/AuthStatus.vue', [
    ['@/stores/user', storeStub],
    ['@/api/request', requestStub],
  ])
  const wrapper = mount(component, { global: { stubs: elementStubs } })
  return { wrapper, store }
}

test('AuthStatus shows fixed capability guidance without raw server text', async () => {
  const cases = [
    ['auth_capability_unavailable', /当前浏览器环境不支持安全认证/],
    ['auth_insecure_context', /HTTPS|安全上下文/],
    ['auth_web_locks_unavailable', /Web Locks/],
    ['auth_broadcast_channel_unavailable', /BroadcastChannel/],
    ['auth_storage_unavailable', /站点存储/],
  ]
  const { wrapper, store } = await mountAuthStatus({ issue: cases[0][0], recover: async () => ({ state: 'anonymous' }) })
  for (const [issue, expected] of cases) {
    store.authIssue = issue
    await flush(wrapper)
    assert.match(wrapper.text(), /当前浏览器环境不支持安全认证/)
    assert.match(wrapper.text(), expected)
    assert.doesNotMatch(wrapper.text(), /database exploded|stack trace|refresh_token/)
  }
  wrapper.unmount()
  delete globalThis.__authRecoveryFixture
})

test('AuthStatus coalesces clicks, disables checking, emits only success, and hides after anonymous convergence', async () => {
  const wait = deferred()
  let calls = 0
  const { wrapper, store } = await mountAuthStatus({
    recover: async () => {
      calls++
      const result = await wait.promise
      store.authState = result.state
      store.authIssue = null
      return result
    },
  })
  assert.match(wrapper.text(), /上一次认证请求结果尚未确认/)
  const button = wrapper.get('button')
  await button.trigger('click')
  await button.trigger('click')
  assert.equal(calls, 1)
  assert.equal(button.attributes('disabled') !== undefined, true)
  assert.equal(button.attributes('data-loading'), 'true')
  wait.resolve({ state: 'anonymous' })
  await flush(wrapper)
  assert.equal(wrapper.find('[role="alert"]').exists(), false)
  assert.deepEqual(wrapper.emitted('recovered'), [[{ state: 'anonymous' }]])
  wrapper.unmount()
  delete globalThis.__authRecoveryFixture
})

test('AuthStatus keeps safe unsupported and retryable failures visible', async () => {
  const raw = 'database exploded: refresh_token=secret stack trace'
  const { wrapper } = await mountAuthStatus({
    recover: async () => { throw Object.assign(new Error(raw), { code: 'auth_recovery_unsupported', response: { data: raw } }) },
  })
  await wrapper.get('button').trigger('click')
  await flush(wrapper)
  assert.match(wrapper.text(), /无法自动判断|人工核对/)
  assert.doesNotMatch(wrapper.text(), /database exploded|refresh_token|stack trace/)
  assert.equal(wrapper.emitted('recovered'), undefined)

  globalThis.__authRecoveryFixture.recover = async () => { throw Object.assign(new Error(raw), { code: 'auth_recovery_coalesced' }) }
  await wrapper.get('button').trigger('click')
  await flush(wrapper)
  assert.match(wrapper.text(), /仍未解决|网络恢复后重试/)
  assert.doesNotMatch(wrapper.text(), /database exploded|refresh_token|stack trace/)

  globalThis.__authRecoveryFixture.recover = async () => { throw Object.assign(new Error(raw), { code: 'server_private_failure' }) }
  await wrapper.get('button').trigger('click')
  await flush(wrapper)
  assert.match(wrapper.text(), /仍未解决|网络恢复后重试/)
  assert.doesNotMatch(wrapper.text(), /database exploded|refresh_token|stack trace/)
  wrapper.unmount()
  delete globalThis.__authRecoveryFixture
})

async function mountLogin({ authIssue = 'auth_uncertain', recover, redirect = '/billing?period=month' }) {
  const [{ mount }, { reactive }, { createMemoryHistory, createRouter }] = await setupDom()
  const store = reactive({
    authState: 'uncertain',
    authIssue,
    loginCalls: 0,
    async loginUsername() { this.loginCalls++ },
  })
  globalThis.__authRecoveryFixture = {
    store,
    recover: async () => {
      const result = await recover()
      store.authState = result.state
      store.authIssue = null
      return result
    },
  }
  const storeStub = dataModule('export const useUserStore = () => globalThis.__authRecoveryFixture.store')
  const requestStub = dataModule('export const authSession = { recover: (...args) => globalThis.__authRecoveryFixture.recover(...args) }')
  const authStatus = await compileComponent('../components/AuthStatus.vue', [
    ['@/stores/user', storeStub],
    ['@/api/request', requestStub],
  ])
  globalThis.__authRecoveryFixture.AuthStatus = authStatus
  const componentStub = dataModule('export default { template: `<span />` }')
  const elementPlusStub = dataModule('export const ElMessage = { success() {}, error() {} }')
  const iconsStub = dataModule('export const User = {}; export const Lock = {}')
  const authErrorsStub = dataModule("export const authErrorMessage = () => 'safe error'")
  const i18nStub = dataModule("export const useI18n = () => ({ t: key => key })")
  const Login = await compileComponent('./Login.vue', [
    ['vue-router', vueRouterUrl],
    ['@element-plus/icons-vue', iconsStub],
    ['element-plus', elementPlusStub],
    ['@/api/auth-errors', authErrorsStub],
    ['@/stores/user', storeStub],
    ['@/utils/auth-redirect', safeRedirectUrl],
    ['@/components/ThemeToggle.vue', componentStub],
    ['@/components/LocaleToggle.vue', componentStub],
    ['@/components/AuthStatus.vue', dataModule('export default globalThis.__authRecoveryFixture.AuthStatus')],
    ['@/composables/useI18n', i18nStub],
  ])
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/login', component: Login },
      { path: '/register', component: { template: '<main>register</main>' } },
      { path: '/billing', component: { template: '<main>billing</main>' } },
      { path: '/chat', component: { template: '<main>chat</main>' } },
    ],
  })
  await router.push({ path: '/login', query: { redirect } })
  let replaces = 0
  const replace = router.replace.bind(router)
  router.replace = (...args) => { replaces++; return replace(...args) }
  const wrapper = mount(Login, { global: { plugins: [router], stubs: elementStubs } })
  return { wrapper, router, store, replaces: () => replaces }
}

test('Login blocks login and registration while uncertain, then anonymous recovery unlocks without navigation', async () => {
  const { wrapper, router, store, replaces } = await mountLogin({ recover: async () => ({ state: 'anonymous' }) })
  const buttons = wrapper.findAll('button')
  const submit = buttons.find(button => button.text() === 'login.submit')
  const register = buttons.find(button => button.text() === 'login.register')
  assert.ok(submit, wrapper.html())
  assert.ok(register, wrapper.html())
  assert.equal(submit.attributes('disabled') !== undefined, true)
  assert.equal(register.attributes('disabled') !== undefined, true)
  await submit.trigger('click')
  await register.trigger('click')
  assert.equal(store.loginCalls, 0)
  assert.equal(router.currentRoute.value.path, '/login')

  const recoverButton = buttons.find(button => /检查恢复状态/.test(button.text()))
  await recoverButton.trigger('click')
  await flush(wrapper)
  assert.equal(store.authState, 'anonymous')
  assert.equal(wrapper.find('[role="alert"]').exists(), false)
  assert.equal(submit.attributes('disabled'), undefined)
  assert.equal(register.attributes('disabled'), undefined)
  assert.equal(router.currentRoute.value.path, '/login')
  assert.equal(replaces(), 0)
  wrapper.unmount()
  delete globalThis.__authRecoveryFixture
})

test('Login redirects one authenticated recovery through safeAuthRedirect', async () => {
  const { wrapper, router, replaces } = await mountLogin({ recover: async () => ({ state: 'authenticated' }) })
  const recoverButton = wrapper.findAll('button').find(button => /检查恢复状态/.test(button.text()))
  await recoverButton.trigger('click')
  await flush(wrapper)
  assert.equal(router.currentRoute.value.fullPath, '/billing?period=month')
  assert.equal(replaces(), 1)
  wrapper.unmount()
  delete globalThis.__authRecoveryFixture
})

test('store and Login source expose the manager issue and guarded recovery handoff', async () => {
  const [storeSource, loginSource] = await Promise.all([
    readFile(new URL('../stores/user.js', import.meta.url), 'utf8'),
    readFile(new URL('./Login.vue', import.meta.url), 'utf8'),
  ])
  assert.match(storeSource, /authIssue\s*=\s*ref\(authSession\.authIssue\(\)\)/)
  assert.match(storeSource, /authIssue\.value\s*=\s*next\.issue/)
  assert.match(loginSource, /<AuthStatus\s+@recovered="handleRecovered"\s*\/?>/)
  assert.match(loginSource, /const authBlocked = computed\(/)
})
