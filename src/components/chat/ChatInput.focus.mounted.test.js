import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc'
import { JSDOM } from 'jsdom'

const encode = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`

test('focused textarea stays focused and readonly through generation, blocks resubmit, then becomes editable', async () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>')
  for (const key of ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'SVGElement', 'Event', 'KeyboardEvent', 'MouseEvent']) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: dom.window[key] })
  const [{ mount }, { reactive, defineComponent, h, ref, watch, nextTick }] = await Promise.all([import('@vue/test-utils'), import('vue')])
  const source = await readFile(new URL('./ChatInput.vue', import.meta.url), 'utf8')
  const descriptor = parse(source, { filename: 'ChatInput.vue' }).descriptor
  const script = compileScript(descriptor, { id: 'be06-chat-input-focus', genDefaultAs: '__sfc__' })
  const template = compileTemplate({ id: 'be06-chat-input-focus', filename: 'ChatInput.vue', source: descriptor.template.content, compilerOptions: { bindingMetadata: script.bindings } })
  assert.deepEqual(template.errors, [])
  const chat = reactive({ streaming: false, generationState: null })
  const settings = reactive({ modelsLoaded: true, models: [{ id: 'a' }], compareMode: false, selectedModelId: 'a', compareModelIds: [], currentModel: () => ({ multimodal: false }) })
  globalThis.__be06InputFocus = { chat, settings }
  const replacements = new Map([
    ['vue', new URL('../../../node_modules/vue/index.mjs', import.meta.url).href],
    ['@/stores/chat', encode('export const useChatStore=()=>globalThis.__be06InputFocus.chat')],
    ['@/stores/settings', encode('export const useSettingsStore=()=>globalThis.__be06InputFocus.settings')],
    ['@/composables/useI18n', encode('export const useI18n=()=>({t:key=>key})')],
    ['@/components/chat/generation-ui', new URL('./generation-ui.js', import.meta.url).href],
    ['@element-plus/icons-vue', encode('export const Picture={};export const Promotion={};export const Close={}')],
    ['element-plus', encode('export const ElMessage={warning(){}}')],
  ])
  let code = `${script.content}\n${template.code}\n__sfc__.render=render\nexport default __sfc__`
  for (const [specifier, replacement] of replacements) code = code.replaceAll(`from '${specifier}'`, `from '${replacement}'`).replaceAll(`from "${specifier}"`, `from "${replacement}"`)
  const Input = (await import(encode(code))).default
  const Textarea = defineComponent({
    inheritAttrs: false,
    props: { modelValue: String, readonly: Boolean, disabled: Boolean },
    emits: ['update:modelValue', 'keydown'],
    setup(props, { attrs, emit }) {
      const element = ref()
      watch(() => props.disabled, value => { if (value) element.value?.blur() })
      return () => h('textarea', {
        ...attrs, ref: element, value: props.modelValue, readonly: props.readonly, disabled: props.disabled,
        onInput: event => { if (!props.readonly && !props.disabled) emit('update:modelValue', event.target.value) },
        onKeydown: event => emit('keydown', event),
      })
    },
  })
  const Button = defineComponent({ inheritAttrs: false, props: { disabled: Boolean }, setup: (props, { attrs }) => () => h('button', { ...attrs, disabled: props.disabled }) })
  const wrapper = mount(Input, { props: { disabled: true }, attachTo: document.body, global: { stubs: { ElInput: Textarea, ElButton: Button, ElUpload: true, ElImage: true, ElIcon: true } } })
  const textarea = wrapper.get('textarea')
  assert.notEqual(document.activeElement, textarea.element, 'boot must not steal focus')
  assert.equal(textarea.attributes('disabled'), undefined)
  assert.equal(textarea.attributes('readonly'), '')
  assert.equal(textarea.attributes('aria-disabled'), 'true')
  await wrapper.setProps({ disabled: false }); await nextTick()
  textarea.element.focus()
  assert.equal(document.activeElement, textarea.element)

  await textarea.setValue('拼音草稿')
  const composingEnter = new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, isComposing: true, bubbles: true, cancelable: true })
  textarea.element.dispatchEvent(composingEnter); await nextTick()
  assert.equal(wrapper.emitted('send'), undefined, 'IME candidate confirmation must not send')
  assert.equal(composingEnter.defaultPrevented, false, 'IME candidate confirmation must retain browser default')
  assert.equal(textarea.element.value, '拼音草稿')
  const legacyComposingEnter = new KeyboardEvent('keydown', { key: 'Enter', keyCode: 229, bubbles: true, cancelable: true })
  textarea.element.dispatchEvent(legacyComposingEnter); await nextTick()
  assert.equal(wrapper.emitted('send'), undefined, 'legacy IME keyCode must not send')
  assert.equal(legacyComposingEnter.defaultPrevented, false)
  assert.equal(textarea.element.value, '拼音草稿')

  const compositionEndedEnter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
  textarea.element.dispatchEvent(compositionEndedEnter); await nextTick()
  assert.equal(wrapper.emitted('send')?.length, 1, 'ordinary Enter after compositionend sends once')
  assert.equal(compositionEndedEnter.defaultPrevented, true)
  assert.equal(textarea.element.value, '')
  await textarea.setValue('换行草稿')
  const shiftEnter = new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true, cancelable: true })
  textarea.element.dispatchEvent(shiftEnter); await nextTick()
  assert.equal(wrapper.emitted('send')?.length, 1, 'Shift+Enter must not send')
  assert.equal(shiftEnter.defaultPrevented, false)
  assert.equal(textarea.element.value, '换行草稿')

  await textarea.setValue('first request')
  await textarea.trigger('keydown', { key: 'Enter', shiftKey: false })
  assert.equal(wrapper.emitted('send')?.length, 2)
  for (const [status, phase] of [['waiting', 'starting'], ['receiving', 'streaming'], ['draining', 'streaming']]) {
    chat.streaming = true; chat.generationState = { status, phase }; await nextTick()
    assert.equal(document.activeElement, textarea.element, status)
    assert.equal(textarea.attributes('disabled'), undefined, status)
    assert.equal(textarea.attributes('readonly'), '', status)
    assert.equal(textarea.attributes('aria-busy'), 'true', status)
    if (status === 'waiting') {
      const lockedComposingEnter = new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true, cancelable: true })
      textarea.element.dispatchEvent(lockedComposingEnter); await nextTick()
      assert.equal(lockedComposingEnter.defaultPrevented, false, 'locked input must not disrupt IME candidate confirmation')
      assert.equal(wrapper.emitted('send')?.length, 2)
    }
    await textarea.trigger('keydown', { key: 'Enter', shiftKey: false })
    assert.equal(wrapper.emitted('send')?.length, 2, `${status} must block Enter resubmit`)
  }
  chat.streaming = false; chat.generationState = { status: 'completed', phase: 'completed' }; await nextTick()
  assert.equal(document.activeElement, textarea.element)
  assert.equal(textarea.attributes('readonly'), undefined)
  assert.equal(textarea.attributes('aria-disabled'), 'false')
  await textarea.setValue('next request')
  assert.equal(textarea.element.value, 'next request')
  wrapper.unmount(); delete globalThis.__be06InputFocus
})
