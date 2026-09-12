import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc'
import { JSDOM } from 'jsdom'

const encode = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`

test('mounted compare selector accepts only ordered distinct selections of two or three', async () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>')
  for (const key of ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'SVGElement', 'Event', 'MouseEvent']) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: dom.window[key] })
  const [{ mount }, { reactive, defineComponent, h, nextTick }] = await Promise.all([import('@vue/test-utils'), import('vue')])
  const source = await readFile(new URL('./ModelPanel.vue', import.meta.url), 'utf8')
  const descriptor = parse(source, { filename: 'ModelPanel.vue' }).descriptor
  const script = compileScript(descriptor, { id: 'be06-model-panel', genDefaultAs: '__sfc__' })
  const template = compileTemplate({ id: 'be06-model-panel', filename: 'ModelPanel.vue', source: descriptor.template.content, compilerOptions: { bindingMetadata: script.bindings } })
  assert.deepEqual(template.errors, [])
  const calls = []
  const settings = reactive({
    models: ['a', 'b', 'c', 'd'].map(id => ({ id, name: id.toUpperCase(), icon: id, type: 'chat' })), modelsLoaded: true, modelLoadError: false, catalogStale: false,
    compareMode: true, compareModelIds: ['c', 'a'], selectedModelId: 'a', selectedScenarioId: 'policy',
    setCompareModelIds(ids) { calls.push([...ids]); this.compareModelIds = [...ids] }, setCompareMode: value => { settings.compareMode = value }, setModel() {}, setScenario() {},
  })
  const chat = reactive({ streaming: false })
  globalThis.__be06PanelFixture = { settings, chat, warnings: [] }
  const replacements = new Map([
    ['vue', new URL('../../../node_modules/vue/index.mjs', import.meta.url).href],
    ['@/stores/settings', encode('export const useSettingsStore=()=>globalThis.__be06PanelFixture.settings')],
    ['@/stores/chat', encode('export const useChatStore=()=>globalThis.__be06PanelFixture.chat')],
    ['@/constants/scenario-presets', encode("export const SCENARIO_PRESETS=[{id:'policy'}]")],
    ['@/composables/useI18n', encode('export const useI18n=()=>({t:(key,args)=>args?.count?`${key}:${args.count}`:key})')],
    ['@/utils/model-search', encode('export const filterModels=models=>models')],
    ['@/components/chat/generation-ui', new URL('./generation-ui.js', import.meta.url).href],
    ['@element-plus/icons-vue', encode('export const Cpu={}')],
    ['element-plus', encode('export const ElMessage={warning:value=>globalThis.__be06PanelFixture.warnings.push(value)}')],
  ])
  let code = `${script.content}\n${template.code}\n__sfc__.render=render\nexport default __sfc__`
  for (const [specifier, replacement] of replacements) code = code.replaceAll(`from '${specifier}'`, `from '${replacement}'`).replaceAll(`from "${specifier}"`, `from "${replacement}"`)
  const Panel = (await import(encode(code))).default
  const Switch = defineComponent({ props: { modelValue: Boolean, disabled: Boolean }, emits: ['change'], setup(props, { emit }) { return () => h('button', { id: 'compare-toggle', disabled: props.disabled, onClick: () => emit('change', !props.modelValue) }, 'toggle') } })
  const Group = defineComponent({ emits: ['change'], setup(_props, { emit }) { return () => h('div', { id: 'group' }, [
    h('button', { id: 'one', onClick: () => emit('change', ['a']) }, 'one'),
    h('button', { id: 'two', onClick: () => emit('change', ['c', 'a']) }, 'two'),
    h('button', { id: 'three', onClick: () => emit('change', ['c', 'a', 'b']) }, 'three'),
    h('button', { id: 'four', onClick: () => emit('change', ['a', 'b', 'c', 'd']) }, 'four'),
    h('button', { id: 'duplicate', onClick: () => emit('change', ['a', 'a']) }, 'duplicate'),
  ]) } })
  const wrapper = mount(Panel, { global: { stubs: { ElInput: true, ElEmpty: true, ElDivider: true, ElSwitch: Switch, ElCheckboxGroup: Group, ElCheckbox: true, ElIcon: true } } })
  assert.match(wrapper.text(), /model\.compareValid:2/)
  await wrapper.get('#one').trigger('click'); await wrapper.get('#four').trigger('click'); await wrapper.get('#duplicate').trigger('click')
  assert.deepEqual(calls, [])
  assert.equal(globalThis.__be06PanelFixture.warnings.length, 3)
  await wrapper.get('#three').trigger('click'); await nextTick()
  assert.deepEqual(calls, [['c', 'a', 'b']])
  assert.deepEqual(settings.compareModelIds, ['c', 'a', 'b'])
  settings.compareModelIds = ['a', 'unknown']; await nextTick()
  assert.match(wrapper.text(), /model\.invalidModel/)
  assert.doesNotMatch(wrapper.get('#compare-model-validation').text(), /model\.compareCardinality/)
  settings.models = [settings.models[0]]; settings.compareMode = true; settings.compareModelIds = ['a']; await nextTick()
  assert.equal(wrapper.find('#compare-toggle').exists(), true)
  await wrapper.get('#compare-toggle').trigger('click'); await nextTick()
  assert.equal(settings.compareMode, false)
  chat.streaming = true; await nextTick()
  assert.ok(wrapper.findAll('.model-item').every(item => item.attributes('disabled') === ''))
  assert.ok(wrapper.findAll('.scenario-btn').every(item => item.attributes('disabled') === ''))
  wrapper.unmount(); delete globalThis.__be06PanelFixture
})
