import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc'
import { JSDOM } from 'jsdom'

const source = await readFile(new URL('./GenerationStatus.vue', import.meta.url), 'utf8').catch(() => '')

test('mounted lifecycle status is announced and cancellation is authoritative and idempotent', async () => {
  assert.ok(source, 'GenerationStatus.vue must exist')
  const dom = new JSDOM('<!doctype html><html><body></body></html>')
  for (const key of ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'SVGElement', 'Event', 'MouseEvent']) {
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: dom.window[key] })
  }
  const [{ mount }, { reactive, nextTick }] = await Promise.all([import('@vue/test-utils'), import('vue')])
  const descriptor = parse(source, { filename: 'GenerationStatus.vue' }).descriptor
  const script = compileScript(descriptor, { id: 'be06-generation-status', genDefaultAs: '__sfc__' })
  const template = compileTemplate({ id: 'be06-generation-status', filename: 'GenerationStatus.vue', source: descriptor.template.content, compilerOptions: { bindingMetadata: script.bindings } })
  assert.deepEqual(template.errors, [])
  let resolveRetry
  const store = reactive({ generationState: { status: 'disconnected', phase: 'disconnected' }, streaming: true, calls: 0, retryCalls: 0, cancelStream() { this.calls += 1; this.generationState = { status: 'cancelling', phase: 'cancelling' } }, retryPendingGeneration() { this.retryCalls += 1; this.generationState = { status: 'recovering', phase: 'recovering' }; return new Promise(resolve => { resolveRetry = resolve }) } })
  globalThis.__be06UiFixture = { store }
  const fixture = `data:text/javascript;base64,${Buffer.from('export const useChatStore=()=>globalThis.__be06UiFixture.store').toString('base64')}`
  const i18n = `data:text/javascript;base64,${Buffer.from("export const useI18n=()=>({t:key=>key})").toString('base64')}`
  const helper = new URL('./generation-ui.js', import.meta.url).href
  const vue = new URL('../../../node_modules/vue/index.mjs', import.meta.url).href
  let code = `${script.content}\n${template.code}\n__sfc__.render=render\nexport default __sfc__`
  for (const [specifier, replacement] of [['vue', vue], ['@/stores/chat', fixture], ['@/composables/useI18n', i18n], ['@/components/chat/generation-ui', helper]]) {
    code = code.replaceAll(`from '${specifier}'`, `from '${replacement}'`).replaceAll(`from "${specifier}"`, `from "${replacement}"`)
  }
  const Component = (await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)).default
  const wrapper = mount(Component)
  assert.match(wrapper.text(), /chat\.retryGeneration/)
  await wrapper.get('.retry-button').trigger('click'); await nextTick()
  assert.equal(store.retryCalls, 1)
  assert.equal(wrapper.get('.retry-button').attributes('disabled'), '')
  await wrapper.get('.retry-button').trigger('click'); await nextTick()
  assert.equal(store.retryCalls, 1)
  resolveRetry(false); await new Promise(resolve => setTimeout(resolve, 0)); await nextTick()
  store.generationState = { status: 'disconnected', phase: 'disconnected' }; await nextTick()
  for (const status of ['waiting', 'receiving', 'disconnected', 'recovering']) {
    store.generationState = { status, phase: status }; await nextTick()
    if (status === 'recovering') { await new Promise(resolve => setTimeout(resolve, 0)); await nextTick() }
    assert.equal(wrapper.get('[aria-live="polite"]').text(), `chat.generationStates.${status}`)
    assert.equal(wrapper.get('button').attributes('disabled'), undefined)
  }
  store.generationState = { status: 'draining', phase: 'streaming' }; await nextTick()
  assert.equal(wrapper.get('[aria-live="polite"]').text(), 'chat.generationStates.draining')
  assert.equal(wrapper.find('.stop-button').exists(), false)
  store.generationState = { status: 'receiving', phase: 'streaming' }; await nextTick()
  const stop = wrapper.get('.stop-button')
  await stop.trigger('click'); await nextTick()
  assert.equal(store.calls, 1)
  assert.equal(wrapper.get('button').attributes('disabled'), '')
  await wrapper.get('button').trigger('click'); await nextTick()
  assert.equal(store.calls, 1)
  assert.equal(wrapper.find('.stop-button').exists(), false)
  assert.equal(wrapper.find('.retry-button').exists(), true)
  assert.equal(wrapper.get('.retry-button').attributes('disabled'), '')
  store.generationState = { status: 'cancelling', phase: 'confirming_cancel' }; await nextTick()
  assert.equal(wrapper.get('[aria-live="polite"]').text(), 'chat.generationStates.confirming_cancel')
  assert.equal(wrapper.find('.stop-button').exists(), false)
  assert.equal(wrapper.get('.retry-button').attributes('disabled'), undefined)
  for (const status of ['completed', 'failed', 'cancelled']) {
    store.generationState = { status, phase: status }; store.streaming = false; await nextTick()
    assert.equal(wrapper.get('[aria-live="polite"]').text(), `chat.generationStates.${status}`)
    assert.equal(wrapper.find('button').exists(), false)
  }
  wrapper.unmount()
  delete globalThis.__be06UiFixture
})
