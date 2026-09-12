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
  const notifications = []
  let copyCalls = 0
  let resolveCopy
  const copySignals = []
  const chat = reactive({ streaming: false, activeId: '1', generationState: null, retryCalls: 0, getActive: () => conversation, retryGenerationAttempt() { this.retryCalls += 1; return new Promise(resolve => { resolveRetry = resolve }) } })
  const settings = reactive({ models: [{ id: 'a', name: 'A', icon: 'A' }, { id: 'b', name: 'B', icon: 'B' }] })
  const MarkdownContent = defineComponent({ props: { content: String }, setup: props => () => h('div', { class: 'markdown' }, props.content) })
  globalThis.__be06ListFixture = {
    chat,
    settings,
    MarkdownContent,
    notifications,
    copyText(_text, environment) { copyCalls += 1; copySignals.push(environment?.signal); return new Promise(resolve => { resolveCopy = resolve }) },
  }
  const replacements = new Map([
    ['vue', new URL('../../../node_modules/vue/index.mjs', import.meta.url).href],
    ['@/stores/chat', encode('export const useChatStore=()=>globalThis.__be06ListFixture.chat')],
    ['@/stores/settings', encode('export const useSettingsStore=()=>globalThis.__be06ListFixture.settings')],
    ['@/composables/useI18n', encode('export const useI18n=()=>({t:key=>key})')],
    ['@/components/chat/generation-ui', new URL('./generation-ui.js', import.meta.url).href],
    ['@/utils/clipboard', encode('export const copyText=(text,environment)=>globalThis.__be06ListFixture.copyText(text,environment)')],
    ['@element-plus/icons-vue', encode('export const CopyDocument={}')],
    ['element-plus', encode('export const ElMessage={success:value=>globalThis.__be06ListFixture.notifications.push(["success",value]),warning:value=>globalThis.__be06ListFixture.notifications.push(["warning",value])}')],
  ])
  let code = `${script.content}\n${template.code}\n__sfc__.render=render\nexport default __sfc__`
  for (const [specifier, replacement] of replacements) code = code.replaceAll(`from '${specifier}'`, `from '${replacement}'`).replaceAll(`from "${specifier}"`, `from "${replacement}"`)
  code = code.replaceAll("import MarkdownContent from '@/components/chat/MarkdownContent.vue'", 'const MarkdownContent=globalThis.__be06ListFixture.MarkdownContent')
  const List = (await import(encode(code))).default
  const wrapper = mount(List, { attachTo: document.body, global: { stubs: { ElAvatar: { template: '<span><slot /></span>' }, ElButton: { template: '<button><slot /></button>' }, ElImage: true } } })
  assert.match(wrapper.text(), /partial A/)
  assert.match(wrapper.text(), /complete B/)
  assert.match(wrapper.text(), /chat\.generationErrors\.upstream/)
  assert.equal(wrapper.findAll('.reply-view-only-warning').length, 1)
  assert.match(wrapper.get('.reply-view-only-warning').text(), /chat\.viewOnlyPartial/)
  assert.doesNotMatch(wrapper.findAll('.reply-col')[1].text(), /chat\.viewOnlyPartial/, 'successful sibling must not inherit the failed model warning')
  assert.doesNotMatch(wrapper.text(), /gateway_upstream_error/)
  assert.equal(wrapper.findAll('.col-actions').length, 2, 'terminal compare replies are copyable, including visible failed partials')
  const copyButton = wrapper.findAll('.col-actions button')[0]
  await copyButton.trigger('click'); await copyButton.trigger('click'); await nextTick()
  assert.equal(copyCalls, 1, 'copy must be singleflight while clipboard permission is pending')
  assert.ok(copySignals[0] instanceof AbortSignal)
  assert.equal(copyButton.attributes('disabled'), '')
  assert.deepEqual(notifications, [], 'copy success must wait for the clipboard result')
  resolveCopy(false); await new Promise(resolve => setTimeout(resolve, 0)); await nextTick()
  assert.deepEqual(notifications, [['warning', 'chat.copyFailed']])
  globalThis.__be06ListFixture.copyText = async () => { copyCalls += 1; throw new Error('permission denied') }
  await copyButton.trigger('click'); await new Promise(resolve => setTimeout(resolve, 0)); await nextTick()
  assert.deepEqual(notifications.at(-1), ['warning', 'chat.copyFailed'], 'clipboard rejection is handled with safe localized feedback')
  globalThis.__be06ListFixture.copyText = async () => { copyCalls += 1; return true }
  await copyButton.trigger('click'); await new Promise(resolve => setTimeout(resolve, 0)); await nextTick()
  assert.deepEqual(notifications.at(-1), ['success', 'chat.copied'], 'success is announced only after a confirmed copy')
  const queuedCopies = []
  globalThis.__be06ListFixture.copyText = (_text, environment) => {
    copyCalls += 1
    let resolve
    const promise = new Promise(done => { resolve = done })
    queuedCopies.push({ resolve, signal: environment.signal })
    return promise
  }
  const copyButtons = wrapper.findAll('.col-actions button')
  const beforeReplacement = copyCalls
  await copyButtons[0].trigger('click'); await copyButtons[0].trigger('click'); await copyButtons[1].trigger('click'); await nextTick()
  assert.equal(copyCalls, beforeReplacement + 1, 'A pending then B click must retain one global native write')
  assert.ok(copyButtons.every(button => button.attributes('disabled') === ''), 'every copy target is disabled during the global singleflight')
  assert.equal(queuedCopies[0].signal.aborted, false, 'a competing copy target must not abort the in-flight native write')
  queuedCopies[0].resolve(true); await new Promise(resolve => setTimeout(resolve, 0)); await nextTick()
  assert.deepEqual(notifications.at(-1), ['success', 'chat.copied'])
  assert.ok(wrapper.findAll('.col-actions button').every(button => button.attributes('disabled') === undefined))
  await wrapper.findAll('.col-actions button')[1].trigger('click'); await nextTick()
  assert.equal(copyCalls, beforeReplacement + 2, 'B may start only after A settles')
  queuedCopies[1].resolve(true); await new Promise(resolve => setTimeout(resolve, 0)); await nextTick()
  assert.deepEqual(notifications.at(-1), ['success', 'chat.copied'])
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
  conversation.messages = [{ localKey: 'unmount-copy', role: 'assistant', content: 'copy then leave', generationStatus: 'completed' }]
  chat.streaming = false
  const unmountCopy = {}
  globalThis.__be06ListFixture.copyText = (_text, environment) => {
    unmountCopy.signal = environment.signal
    return new Promise((_resolve, reject) => { unmountCopy.reject = reject })
  }
  await nextTick()
  chat.streaming = true
  await nextTick()
  const list = wrapper.get('.message-list')
  let scrollHeight = 1000
  Object.defineProperties(list.element, {
    scrollHeight: { configurable: true, get: () => scrollHeight },
    clientHeight: { configurable: true, get: () => 200 },
    scrollTop: { configurable: true, writable: true, value: 800 },
  })
  await list.trigger('scroll'); await nextTick()
  assert.equal(wrapper.find('.back-to-latest').exists(), false)
  list.element.scrollTop = 400
  await list.trigger('scroll'); await nextTick()
  const backToLatest = wrapper.get('.back-to-latest')
  assert.equal(backToLatest.attributes('type'), 'button')
  assert.match(backToLatest.text(), /chat\.backToLatest/)
  backToLatest.element.focus()
  assert.equal(document.activeElement, backToLatest.element, 'return-to-latest control must be keyboard focusable')
  conversation.messages[0].content = 'copy then leave, increment while reading'
  await nextTick(); await nextTick()
  assert.equal(list.element.scrollTop, 400, 'incremental DOM updates must not steal scroll while the user is reading above')
  await backToLatest.trigger('click'); await nextTick(); await nextTick()
  assert.equal(list.element.scrollTop, 1000)
  assert.equal(wrapper.find('.back-to-latest').exists(), false)
  scrollHeight = 1200
  conversation.messages[0].content = 'copy then leave, next incremental chunk'
  await nextTick(); await nextTick()
  assert.equal(list.element.scrollTop, 1200, 'manual return must restore following for later incremental DOM updates')

  chat.streaming = false
  await nextTick()
  await wrapper.get('.msg-actions button').trigger('click'); await nextTick()
  const noticesBeforeUnmount = notifications.length
  wrapper.unmount()
  assert.equal(unmountCopy.signal.aborted, true)
  unmountCopy.reject(new Error('late clipboard rejection'))
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(notifications.length, noticesBeforeUnmount, 'late clipboard settlement after unmount must not toast')
  delete globalThis.__be06ListFixture
})
