import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc'
import { JSDOM } from 'jsdom'

const encode = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }

test('mounted Chat locks generation controls while checking recovery before catalog or history initialization', async () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>')
  for (const key of ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'SVGElement', 'Event', 'MouseEvent']) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: dom.window[key] })
  const [{ mount }, { reactive, defineComponent, h, nextTick }] = await Promise.all([import('@vue/test-utils'), import('vue')])
  const source = await readFile(new URL('./Chat.vue', import.meta.url), 'utf8')
  const descriptor = parse(source, { filename: 'Chat.vue' }).descriptor
  const script = compileScript(descriptor, { id: 'be06-chat-boot', genDefaultAs: '__sfc__' })
  const template = compileTemplate({ id: 'be06-chat-boot', filename: 'Chat.vue', source: descriptor.template.content, compilerOptions: { bindingMetadata: script.bindings } })
  assert.deepEqual(template.errors, [])
  const resume = deferred(), load = deferred(), order = []
  const chat = reactive({ streaming: false, sent: 0, getActive: () => null, async resumePendingGeneration() { order.push('resume'); return resume.promise }, async fetchConversations() { order.push('fetch') }, async ensureActive() { order.push('ensure') }, sendMessage() { this.sent += 1 } })
  const settings = reactive({ modelsLoaded: false, models: [], compareMode: false, selectedModelId: '', compareModelIds: [], async loadModels() { order.push('load'); await load.promise; this.models = [{ id: 'a' }]; this.selectedModelId = 'a'; this.modelsLoaded = true } })
  const ChatInput = defineComponent({ props: { disabled: Boolean }, emits: ['send'], setup(props, { emit }) { return () => h('button', { id: 'send', disabled: props.disabled, onClick: () => { if (!props.disabled) emit('send', 'hello', []) } }, 'send') } })
  const ModelPanel = defineComponent({ props: { disabled: Boolean }, setup: props => () => h('button', { class: 'model-control', disabled: props.disabled }, 'model') })
  const Empty = defineComponent({ setup: (_props, { slots }) => () => h('div', slots.default?.()) })
  globalThis.__be06BootFixture = { chat, settings, ChatInput, ModelPanel, Empty }
  const replacements = new Map([
    ['vue', new URL('../../node_modules/vue/index.mjs', import.meta.url).href],
    ['@/stores/chat', encode('export const useChatStore=()=>globalThis.__be06BootFixture.chat')],
    ['@/stores/settings', encode('export const useSettingsStore=()=>globalThis.__be06BootFixture.settings')],
    ['@/api/request', encode('export const USE_MOCK=false')],
    ['@/composables/useBreakpoint', encode('export const useBreakpoint=()=>({isTablet:false})')],
    ['@/utils/storage', encode('export const getItem=(_k,v)=>v; export const setItem=()=>{}')],
    ['@/composables/useI18n', encode('export const useI18n=()=>({t:key=>key})')],
    ['@/components/chat/generation-ui', new URL('../components/chat/generation-ui.js', import.meta.url).href],
    ['@element-plus/icons-vue', encode('const Icon=globalThis.__be06BootFixture.Empty;export const Menu=Icon;export const Setting=Icon;export const DArrowLeft=Icon;export const DArrowRight=Icon')],
  ])
  let code = `${script.content}\n${template.code}\n__sfc__.render=render\nexport default __sfc__`
  for (const [specifier, replacement] of replacements) code = code.replaceAll(`from '${specifier}'`, `from '${replacement}'`).replaceAll(`from "${specifier}"`, `from "${replacement}"`)
  for (const [name, value] of [['ChatInput', 'ChatInput'], ['ModelPanel', 'ModelPanel'], ['ChatSidebar', 'Empty'], ['ChatMessageList', 'Empty'], ['GenerationStatus', 'Empty'], ['MobileDrawer', 'Empty']]) {
    code = code.replace(new RegExp(`import ${name} from '[^']+'`), `const ${name}=globalThis.__be06BootFixture.${value}`)
  }
  const Chat = (await import(encode(code))).default
  const wrapper = mount(Chat, { global: { stubs: { ElScrollbar: Empty, ElButton: Empty, ElIcon: Empty } } })
  await nextTick()
  assert.deepEqual(order, ['resume'])
  assert.equal(wrapper.get('#send').attributes('disabled'), '')
  assert.ok(wrapper.findAll('.model-control').every(control => control.attributes('disabled') === ''))
  await wrapper.get('#send').trigger('click'); assert.equal(chat.sent, 0)
  resume.resolve(false); await new Promise(resolve => setTimeout(resolve, 0)); await nextTick()
  assert.deepEqual(order, ['resume', 'load'])
  load.resolve(); await new Promise(resolve => setTimeout(resolve, 0)); await nextTick()
  assert.deepEqual(order, ['resume', 'load', 'fetch', 'ensure'])
  assert.equal(wrapper.get('#send').attributes('disabled'), undefined)
  await wrapper.get('#send').trigger('click'); assert.equal(chat.sent, 1)
  wrapper.unmount(); delete globalThis.__be06BootFixture
})
