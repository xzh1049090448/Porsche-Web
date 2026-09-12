import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc'
import { JSDOM } from 'jsdom'

const encode = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`

test('mounted message list keeps sibling partial output, stable failure copy, and view-only warning separate', async () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>')
  for (const key of ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'SVGElement', 'Event', 'MouseEvent']) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: dom.window[key] })
  const [{ mount }, { reactive, defineComponent, h, nextTick }] = await Promise.all([import('@vue/test-utils'), import('vue')])
  const source = await readFile(new URL('./ChatMessageList.vue', import.meta.url), 'utf8')
  const descriptor = parse(source, { filename: 'ChatMessageList.vue' }).descriptor
  const script = compileScript(descriptor, { id: 'be06-message-list', genDefaultAs: '__sfc__' })
  const template = compileTemplate({ id: 'be06-message-list', filename: 'ChatMessageList.vue', source: descriptor.template.content, compilerOptions: { bindingMetadata: script.bindings } })
  assert.deepEqual(template.errors, [])
  const conversation = reactive({ messages: [{ localKey: 'reply', role: 'assistant', multiModel: true, models: ['a', 'b'], replies: { a: 'partial A', b: 'complete B' }, modelStates: { a: { status: 'failed', code: 'gateway_upstream_error' }, b: { status: 'completed', code: null } }, generationStatus: 'completed', viewOnly: true }] })
  let resolveRetry
  const chat = reactive({ streaming: false, activeId: '1', generationState: null, retryCalls: 0, getActive: () => conversation, retryGenerationAttempt() { this.retryCalls += 1; return new Promise(resolve => { resolveRetry = resolve }) } })
  const settings = reactive({ models: [{ id: 'a', name: 'A', icon: 'A' }, { id: 'b', name: 'B', icon: 'B' }] })
  const MarkdownContent = defineComponent({ props: { content: String }, setup: props => () => h('div', { class: 'markdown' }, props.content) })
  globalThis.__be06ListFixture = { chat, settings, MarkdownContent }
  const replacements = new Map([
    ['vue', new URL('../../../node_modules/vue/index.mjs', import.meta.url).href],
    ['@/stores/chat', encode('export const useChatStore=()=>globalThis.__be06ListFixture.chat')],
    ['@/stores/settings', encode('export const useSettingsStore=()=>globalThis.__be06ListFixture.settings')],
    ['@/composables/useI18n', encode('export const useI18n=()=>({t:key=>key})')],
    ['@/components/chat/generation-ui', new URL('./generation-ui.js', import.meta.url).href],
    ['@element-plus/icons-vue', encode('export const CopyDocument={}')],
    ['element-plus', encode('export const ElMessage={success(){}}')],
  ])
  let code = `${script.content}\n${template.code}\n__sfc__.render=render\nexport default __sfc__`
  for (const [specifier, replacement] of replacements) code = code.replaceAll(`from '${specifier}'`, `from '${replacement}'`).replaceAll(`from "${specifier}"`, `from "${replacement}"`)
  code = code.replaceAll("import MarkdownContent from '@/components/chat/MarkdownContent.vue'", 'const MarkdownContent=globalThis.__be06ListFixture.MarkdownContent')
  const List = (await import(encode(code))).default
  const wrapper = mount(List, { global: { stubs: { ElAvatar: { template: '<span><slot /></span>' }, ElButton: { template: '<button><slot /></button>' }, ElImage: true } } })
  assert.match(wrapper.text(), /partial A/)
  assert.match(wrapper.text(), /complete B/)
  assert.match(wrapper.text(), /chat\.generationErrors\.upstream/)
  assert.equal(wrapper.findAll('.reply-view-only-warning').length, 1)
  assert.match(wrapper.get('.reply-view-only-warning').text(), /chat\.viewOnlyPartial/)
  assert.doesNotMatch(wrapper.findAll('.reply-col')[1].text(), /chat\.viewOnlyPartial/, 'successful sibling must not inherit the failed model warning')
  assert.doesNotMatch(wrapper.text(), /gateway_upstream_error/)
  assert.equal(wrapper.findAll('.col-actions').length, 2, 'terminal compare replies are copyable, including visible failed partials')
  chat.streaming = true
  conversation.messages[0].generationStatus = 'receiving'
  conversation.messages[0].replies.a = ''
  await nextTick()
  assert.match(wrapper.text(), /chat\.generationErrors\.upstream/, 'an empty failed reply must not be rendered as waiting')
  assert.equal(wrapper.findAll('.col-actions').length, 0, 'no compare reply is copyable while a sibling is still generating')
  conversation.messages = [{ localKey: 'done', role: 'assistant', content: 'saved', generationStatus: 'completed', viewOnly: false }]
  chat.streaming = false
  await nextTick()
  assert.match(wrapper.text(), /saved/)
  assert.doesNotMatch(wrapper.text(), /chat\.viewOnlyPartial/)
  const attemptId = '123e4567-e89b-42d3-a456-426614174000'
  conversation.messages = [
    { localKey: 'user', role: 'user', content: 'retry me', transientAttempt: attemptId },
    { localKey: 'empty', role: 'assistant', content: '', generationStatus: 'failed', errorCode: 'timeout', viewOnly: true, transientAttempt: attemptId },
  ]
  chat.generationState = { generationId: attemptId, status: 'failed', models: [{ receivedText: '', displayedText: '' }] }
  await nextTick()
  assert.equal(wrapper.findAll('.message.assistant .bubble').length, 0, 'first-byte failure must not leave an empty assistant bubble')
  assert.match(wrapper.get('.attempt-failure').text(), /chat\.generationErrors\.timeout/)
  const retry = wrapper.get('.regenerate-button')
  await retry.trigger('click'); await retry.trigger('click'); await nextTick()
  assert.equal(chat.retryCalls, 1, 'regeneration must singleflight')
  assert.equal(retry.attributes('disabled'), '')
  resolveRetry(false); await new Promise(resolve => setTimeout(resolve, 0)); await nextTick()
  conversation.messages[1].content = 'partial'
  await nextTick()
  assert.equal(wrapper.find('.regenerate-button').exists(), false, 'partial attempts must never expose new-POST retry')
  conversation.messages[1].content = ''
  chat.generationState.generationId = 'stale-after-switch'
  await nextTick()
  assert.equal(wrapper.find('.regenerate-button').exists(), false, 'a detached or switched attempt must not expose retry')
  wrapper.unmount(); delete globalThis.__be06ListFixture
})
