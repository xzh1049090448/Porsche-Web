import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc'
import { JSDOM } from 'jsdom'

import { ADMIN_CAPABILITY_DEFINITIONS } from '../../api/admin-users.js'

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://local.test/users/9', pretendToBeVisual: true })
for (const key of ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'HTMLInputElement', 'SVGElement', 'Event', 'CustomEvent', 'KeyboardEvent', 'MouseEvent', 'FocusEvent', 'MutationObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame']) {
  const value = ['getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame'].includes(key) ? dom.window[key].bind(dom.window) : dom.window[key]
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
}
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
globalThis.CSS ||= { supports: () => false }

const [{ mount }, { nextTick }, { default: ElementPlus }] = await Promise.all([
  import('@vue/test-utils'), import('vue'), import('element-plus'),
])
async function loadEditor() {
  const source = await readFile(new URL('./UserPermissionEditor.vue', import.meta.url), 'utf8')
  const descriptor = parse(source, { filename: 'UserPermissionEditor.vue' }).descriptor
  const script = compileScript(descriptor, { id: 'permission-editor-element-plus', genDefaultAs: '__sfc__' })
  const template = compileTemplate({ id: 'permission-editor-element-plus', filename: 'UserPermissionEditor.vue', source: descriptor.template.content, compilerOptions: { bindingMetadata: script.bindings } })
  assert.deepEqual(template.errors, [])
  let code = `${script.content}\n${template.code}\n__sfc__.render = render\nexport default __sfc__`
  const replacements = new Map([
    ['vue', new URL('../../../node_modules/vue/index.mjs', import.meta.url).href],
    ['../../api/admin-users.js', new URL('../../api/admin-users.js', import.meta.url).href],
  ])
  for (const [specifier, replacement] of replacements) {
    code = code.replaceAll(`from '${specifier}'`, `from '${replacement}'`).replaceAll(`from "${specifier}"`, `from "${replacement}"`)
  }
  return (await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)).default
}
const Editor = await loadEditor()

const catalog = {
  catalog_version: 1,
  override_effects: ['inherit', 'allow', 'deny'],
  capabilities: ADMIN_CAPABILITY_DEFINITIONS.map(item => ({
    name: item.name, admin_default: item.baseline, grantable: item.grantable,
    root_only: item.rootOnly, available: item.available,
  })),
}
const policy = {
  user_guid: '9', role: 'admin', status: 'active', catalog_version: 1, permissions_version: '3',
  capabilities: ADMIN_CAPABILITY_DEFINITIONS.map(definition => ({
    name: definition.name, baseline: definition.baseline, override: 'inherit',
    policy_effective: definition.available && !definition.rootOnly && definition.baseline,
    effective: definition.available && !definition.rootOnly && definition.baseline,
  })),
}
const flush = async () => { for (let index = 0; index < 5; index++) await nextTick() }

test('real Element Plus radios expose labels, keyboard selection, and fresh canonical emissions', async () => {
  const originalCatalog = structuredClone(catalog)
  const originalPolicy = structuredClone(policy)
  const modelValue = [{ capability: 'groups.read', effect: 'deny' }]
  const originalModel = structuredClone(modelValue)
  const wrapper = mount(Editor, { attachTo: document.body, props: { catalog, policy, modelValue }, global: { plugins: [ElementPlus] } })
  try {
    await flush()
    assert.equal(wrapper.findAll('[role="radiogroup"]').length, 24)
    assert.equal(wrapper.findAll('input[type="radio"]').length, 72)
    assert.equal(wrapper.findAll('section').length, 3)
    for (const group of wrapper.findAll('[role="radiogroup"]')) {
      assert.ok(group.attributes('aria-label'))
      assert.ok(document.getElementById(group.attributes('aria-describedby')))
    }
    const first = wrapper.find('[data-capability="users.read"]')
    const radios = first.findAll('input[type="radio"]')
    assert.equal(radios.every(radio => radio.element.labels.length === 1), true)
    assert.equal(radios[0].element.tabIndex, 0)
    assert.ok(radios[0].attributes('name'))
    assert.equal(new Set(radios.map(radio => radio.attributes('name'))).size, 1)
    radios[0].element.focus()
    assert.equal(document.activeElement, radios[0].element)
    await radios[1].trigger('click')
    await flush()
    const emissions = wrapper.emitted('update:modelValue')
    assert.ok(emissions?.length)
    const emitted = emissions.at(-1)[0]
    assert.deepEqual(emitted, [
      { capability: 'users.read', effect: 'allow' },
      { capability: 'groups.read', effect: 'deny' },
    ])
    assert.notEqual(emitted, modelValue)
    assert.notEqual(emitted[1], modelValue[0])
    assert.deepEqual(catalog, originalCatalog)
    assert.deepEqual(policy, originalPolicy)
    assert.deepEqual(modelValue, originalModel)
  } finally { wrapper.unmount(); document.body.innerHTML = '' }
})

test('inherit is UI-only, locked rows are disabled, and every emission is newly allocated', async () => {
  const wrapper = mount(Editor, { attachTo: document.body, props: { catalog, policy, modelValue: [{ capability: 'users.read', effect: 'deny' }] }, global: { plugins: [ElementPlus] } })
  try {
    await flush()
    for (const name of ['users.quota.adjust', 'users.promote', 'users.demote', 'users.permissions.write', 'groups.write']) {
      const inputs = wrapper.find(`[data-capability="${name}"]`).findAll('input[type="radio"]')
      assert.equal(inputs.length, 3)
      assert.equal(inputs.every(input => input.attributes('disabled') !== undefined), true)
    }
    const inherit = wrapper.find('[data-capability="users.read"] input[value="inherit"]')
    await inherit.trigger('change')
    await flush()
    const first = wrapper.emitted('update:modelValue').at(-1)[0]
    assert.deepEqual(first, [])
    const allow = wrapper.find('[data-capability="users.read"] input[value="allow"]')
    await allow.trigger('change')
    await flush()
    const second = wrapper.emitted('update:modelValue').at(-1)[0]
    assert.deepEqual(second, [{ capability: 'users.read', effect: 'allow' }])
    assert.notEqual(first, second)
  } finally { wrapper.unmount(); document.body.innerHTML = '' }
})

test('invalid catalog or policy renders an accessible fail-closed alert with no controls', async () => {
  const wrapper = mount(Editor, { attachTo: document.body, props: { catalog, policy: { ...policy, capabilities: policy.capabilities.slice(1) }, modelValue: [] }, global: { plugins: [ElementPlus] } })
  try {
    await flush()
    assert.equal(wrapper.find('[role="alert"]').exists(), true)
    assert.equal(wrapper.findAll('input[type="radio"]').length, 0)
    assert.deepEqual(wrapper.emitted('update:modelValue'), undefined)
  } finally { wrapper.unmount(); document.body.innerHTML = '' }
})
