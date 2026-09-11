import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc'
import { JSDOM } from 'jsdom'

const loginSource = await readFile(new URL('./Login.vue', import.meta.url), 'utf8')

test('uncertain protected navigation keeps the real recovery control mounted on login', async () => {
  assert.match(loginSource, /<AuthStatus\s*\/>/)
  assert.match(loginSource, /import AuthStatus from '@\/components\/AuthStatus\.vue'/)

  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://local.test/chat' })
  for (const key of ['window', 'document', 'navigator', 'history', 'location', 'Node', 'Element', 'HTMLElement', 'SVGElement', 'Event']) {
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: dom.window[key] })
  }
  const [{ mount }, vue, vueRouter] = await Promise.all([import('@vue/test-utils'), import('vue'), import('vue-router')])
  const { defineComponent, h, reactive, watch } = vue
  const { createMemoryHistory, createRouter, RouterView, useRouter } = vueRouter

  const source = await readFile(new URL('../components/AuthStatus.vue', import.meta.url), 'utf8')
  const descriptor = parse(source, { filename: 'AuthStatus.vue' }).descriptor
  const script = compileScript(descriptor, { id: 'login-auth-status', genDefaultAs: '__sfc__' })
  const template = compileTemplate({ id: 'login-auth-status', filename: 'AuthStatus.vue', source: descriptor.template.content, compilerOptions: { bindingMetadata: script.bindings } })
  assert.deepEqual(template.errors, [])

  const store = reactive({ authState: 'authenticated' })
  let recoverCalls = 0
  globalThis.__loginAuthFixture = { store, recover: async () => { recoverCalls += 1; throw new Error('auth_uncertain') } }
  const storeStub = `data:text/javascript;base64,${Buffer.from('export const useUserStore = () => globalThis.__loginAuthFixture.store').toString('base64')}`
  const requestStub = `data:text/javascript;base64,${Buffer.from('export const authSession = { recover: (...args) => globalThis.__loginAuthFixture.recover(...args) }').toString('base64')}`
  let code = `${script.content}\n${template.code}\n__sfc__.render = render\nexport default __sfc__`
  for (const [specifier, replacement] of [
    ['vue', new URL('../../node_modules/vue/index.mjs', import.meta.url).href],
    ['@/stores/user', storeStub],
    ['@/api/request', requestStub],
  ]) code = code.replaceAll(`from '${specifier}'`, `from '${replacement}'`).replaceAll(`from \"${specifier}\"`, `from \"${replacement}\"`)
  const AuthStatus = (await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)).default

  const Protected = defineComponent({
    setup() {
      const router = useRouter()
      watch(() => store.authState, value => { if (value === 'uncertain') void router.replace('/login') })
      return () => h('main', 'protected')
    },
  })
  const Login = defineComponent({ setup: () => () => h('main', [h(AuthStatus)]) })
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: '/chat', component: Protected }, { path: '/login', component: Login },
  ] })
  await router.push('/chat')
  const wrapper = mount(defineComponent({ setup: () => () => h(RouterView) }), {
    global: {
      plugins: [router],
      stubs: {
        ElAlert: { template: '<section><slot /></section>' },
        ElButton: { template: '<button><slot /></button>' },
      },
    },
  })

  store.authState = 'uncertain'
  await new Promise(resolve => setTimeout(resolve, 0))
  await wrapper.vm.$nextTick()
  assert.equal(router.currentRoute.value.path, '/login')
  const recover = wrapper.get('button')
  assert.match(recover.text(), /检查恢复状态/)
  await recover.trigger('click')
  await wrapper.vm.$nextTick()
  assert.equal(recoverCalls, 1)
  assert.match(wrapper.text(), /仍无法可靠确认/)
  wrapper.unmount()
  delete globalThis.__loginAuthFixture
})
