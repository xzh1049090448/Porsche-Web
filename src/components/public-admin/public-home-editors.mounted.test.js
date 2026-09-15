import test, { afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc'
import { JSDOM } from 'jsdom'

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://local.test/admin/public-content' })
for (const key of ['window','document','Document','navigator','Node','Element','HTMLElement','HTMLDialogElement','HTMLInputElement','SVGElement','Event','MouseEvent','KeyboardEvent','MutationObserver']) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: dom.window[key] })
HTMLDialogElement.prototype.showModal = function () { this.open = true }
HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new Event('close')) }
const [{ mount }, { nextTick }] = await Promise.all([import('@vue/test-utils'), import('vue')])
const data = code => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`

afterEach(() => document.body.replaceChildren())

async function component(name) {
  const filename = `${name}.vue`
  const source = await editorSource(name)
  const descriptor = parse(source, { filename }).descriptor
  const script = compileScript(descriptor, { id: `task10-${name}`, genDefaultAs: '__sfc__' })
  const template = compileTemplate({ id: `task10-${name}`, filename, source: descriptor.template.content, compilerOptions: { bindingMetadata: script.bindings } })
  assert.deepEqual(template.errors, [])
  const vueURL = new URL('../../../node_modules/vue/index.mjs', import.meta.url).href
  const code = `${script.content}\n${template.code}\n__sfc__.render=render\nexport default __sfc__`
    .replaceAll("from 'vue'", `from '${vueURL}'`)
    .replaceAll('from "vue"', `from '${vueURL}'`)
  return (await import(data(code))).default
}

const labels = {
  title: 'Title', itemTitle: 'Item title', body: 'Body', effectiveAt: 'Effective at', timePlaceholder: 'UTC seconds',
  sortOrder: 'Sort order', visible: 'Visible', hidden: 'Hidden', add: 'Add', limit: 'Limit', moveUp: 'Move up',
  moveDown: 'Move down', hide: 'Hide', show: 'Show', remove: 'Remove', confirmTitle: 'Confirm deletion',
  confirm: 'Confirm', cancel: 'Cancel', question: 'Question', answer: 'Answer', search: 'Search', searching: 'Searching',
  edit: 'Edit', editItem: 'Edit item', saveEdit: 'Save changes', cancelEdit: 'Cancel editing',
}

const announcement = (guid, sortOrder = Number(guid)) => ({ guid, title: `Announcement ${guid}`, bodyMarkdown: 'Body', effectiveAt: null, isVisible: true, sortOrder })
const faq = (guid, sortOrder = Number(guid)) => ({ guid, question: `Question ${guid}`, answerMarkdown: 'Answer', isVisible: true, sortOrder })

const editorSource = async name => readFile(new URL(`./${name}.vue`, import.meta.url), 'utf8').catch(() => '')

test('structured home editors exist as separate pure props and emits surfaces', async () => {
  const [announcements, faqs, featured] = await Promise.all([
    editorSource('AnnouncementEditor'),
    editorSource('FaqEditor'),
    editorSource('FeaturedModelSelector'),
  ])
  for (const [source, marker] of [[announcements, 'announcement'], [faqs, 'faq'], [featured, 'featured-models']]) {
    assert.notEqual(source, '', `${marker} editor must exist`)
    assert.match(source, new RegExp(`data-editor=["']${marker}["']`))
    assert.match(source, /defineProps/)
    assert.match(source, /defineEmits/)
    assert.doesNotMatch(source, /publicHomeContentAdminApi|publicModelAdminApi|localStorage|sessionStorage/)
  }
})

test('editor contracts enforce limits validation ordering and explicit deletion', async () => {
  const [announcements, faqs, featured] = await Promise.all([
    editorSource('AnnouncementEditor'),
    editorSource('FaqEditor'),
    editorSource('FeaturedModelSelector'),
  ])
  assert.match(announcements, /MAX_ANNOUNCEMENTS\s*=\s*20/)
  assert.match(announcements, /16384/)
  assert.match(announcements, /1000000/)
  assert.doesNotMatch(announcements, /maxlength=["']120["']/)
  assert.match(announcements, /showModal/)
  assert.match(announcements, /aria-label=.*moveUp/)
  assert.match(faqs, /MAX_FAQS\s*=\s*50/)
  assert.match(faqs, /16384/)
  assert.doesNotMatch(faqs, /maxlength=["']200["']/)
  assert.match(faqs, /showModal/)
  assert.match(featured, /MAX_FEATURED\s*=\s*12/)
  assert.match(featured, /new Set/)
  assert.match(featured, /status\s*===\s*['"]active['"]/)
  assert.match(featured, /upstreamState\s*===\s*['"]present['"]/)
  assert.match(featured, /completeness\s*===\s*['"]complete['"]/)
  for (const source of [announcements, faqs, featured]) assert.doesNotMatch(source, /deleted(_at)?|includeDeleted/)
})

test('announcement editor enforces limits, Unicode byte/time validation and accessible ordering', async () => {
  const AnnouncementEditor = await component('AnnouncementEditor')
  const limited = mount(AnnouncementEditor, { props: { items: Array.from({ length: 20 }, (_, index) => announcement(String(index + 1))), labels }, attachTo: document.body })
  assert.equal(limited.get('button[type="submit"]').attributes('disabled'), '')
  assert.equal(limited.get('[role="status"]').text(), 'Limit')
  limited.unmount()

  const wrapper = mount(AnnouncementEditor, { props: { items: [announcement('1'), announcement('2')], labels }, attachTo: document.body })
  const inputs = wrapper.findAll('.editor-form input')
  await inputs[0].setValue('🙂'.repeat(120))
  await wrapper.get('.editor-form textarea').setValue('正文\n')
  await inputs[1].setValue('2026-09-15T10:00:00.123Z')
  assert.equal(wrapper.get('button[type="submit"]').attributes('disabled'), '')
  await inputs[1].setValue('2026-09-15T10:00:00Z')
  assert.equal(wrapper.get('button[type="submit"]').attributes('disabled'), undefined)
  await wrapper.get('.editor-form').trigger('submit')
  assert.equal(wrapper.emitted('create').length, 1)
  assert.equal(wrapper.emitted('create')[0][0].effectiveAt, '2026-09-15T10:00:00Z')
  await inputs[0].setValue('🙂'.repeat(121))
  assert.equal(wrapper.get('button[type="submit"]').attributes('disabled'), '')
  await wrapper.get('.editor-form textarea').setValue('🙂'.repeat(4097))
  assert.equal(wrapper.get('button[type="submit"]').attributes('disabled'), '')
  const orderButtons = wrapper.findAll('.editor-order-actions button')
  assert.equal(orderButtons[0].attributes('aria-label'), 'Move up')
  assert.equal(orderButtons[0].attributes('disabled'), '')
  assert.equal(orderButtons[1].attributes('disabled'), undefined)
  await orderButtons[1].trigger('click')
  assert.deepEqual(wrapper.emitted('move')[0][0], { guid: '1', direction: 1 })
  wrapper.unmount()
})

test('announcement editor updates every field, while cancel and list replacement clear local edits', async () => {
  const AnnouncementEditor = await component('AnnouncementEditor')
  const original = announcement('1', 10)
  const wrapper = mount(AnnouncementEditor, { props: { items: [original, announcement('2', 20)], labels }, attachTo: document.body })
  await wrapper.get('[data-action="edit"]').trigger('click')
  let form = wrapper.get('[data-edit-form="announcement"]')
  let inputs = form.findAll('input')
  await inputs[0].setValue('🙂'.repeat(121))
  assert.equal(form.get('[data-action="save-edit"]').attributes('disabled'), '')
  await inputs[0].setValue('🙂'.repeat(120))
  await form.get('textarea').setValue('Updated body\n')
  await inputs[1].setValue('2026-09-15T11:00:00Z')
  await inputs[2].setValue('15')
  await inputs[3].setValue(false)
  await form.get('[data-action="save-edit"]').trigger('click')
  assert.deepEqual(wrapper.emitted('update')[0][0], { guid: '1', title: '🙂'.repeat(120), bodyMarkdown: 'Updated body\n', effectiveAt: '2026-09-15T11:00:00Z', isVisible: false, sortOrder: 15 })

  await wrapper.findAll('[data-action="edit"]')[1].trigger('click')
  form = wrapper.get('[data-edit-form="announcement"]')
  await form.findAll('input')[0].setValue('Unsaved sensitive draft')
  await form.get('[data-action="cancel-edit"]').trigger('click')
  assert.equal(wrapper.find('[data-edit-form="announcement"]').exists(), false)
  assert.equal(wrapper.emitted('update').length, 1)

  await wrapper.findAll('[data-action="edit"]')[0].trigger('click')
  await wrapper.setProps({ items: [{ ...original, title: 'Server replacement' }, announcement('2', 20)] })
  await nextTick()
  assert.equal(wrapper.find('[data-edit-form="announcement"]').exists(), false)
  wrapper.unmount()
})

test('announcement delete is explicit, traps focus, and restores its trigger', async () => {
  const AnnouncementEditor = await component('AnnouncementEditor')
  const wrapper = mount(AnnouncementEditor, { props: { items: [announcement('1')], labels }, attachTo: document.body })
  const trigger = wrapper.get('.editor-item > button:last-child')
  await trigger.trigger('click'); await nextTick()
  const dialog = wrapper.get('dialog')
  const confirm = dialog.findAll('button')[0], cancel = dialog.findAll('button')[1]
  assert.equal(dialog.element.open, true)
  assert.equal(document.activeElement, confirm.element)
  await confirm.trigger('keydown', { key: 'Tab', shiftKey: true })
  assert.equal(document.activeElement, cancel.element)
  await dialog.trigger('cancel'); await nextTick(); await nextTick()
  assert.equal(wrapper.emitted('remove'), undefined)
  assert.equal(document.activeElement, trigger.element)
  await trigger.trigger('click'); await nextTick(); await confirm.trigger('click'); await nextTick(); await nextTick()
  assert.deepEqual(wrapper.emitted('remove')[0], ['1'])
  assert.equal(document.activeElement, trigger.element)
  wrapper.unmount()
})

test('FAQ editor enforces the 50 item and UTF-8 body limits', async () => {
  const FaqEditor = await component('FaqEditor')
  const limited = mount(FaqEditor, { props: { items: Array.from({ length: 50 }, (_, index) => faq(String(index + 1))), labels }, attachTo: document.body })
  assert.equal(limited.get('button[type="submit"]').attributes('disabled'), '')
  limited.unmount()
  const wrapper = mount(FaqEditor, { props: { items: [], labels }, attachTo: document.body })
  const inputs = wrapper.findAll('.editor-form input')
  await inputs[0].setValue('🙂'.repeat(200))
  await wrapper.get('.editor-form textarea').setValue('答案')
  assert.equal(wrapper.get('button[type="submit"]').attributes('disabled'), undefined)
  await inputs[0].setValue('🙂'.repeat(201))
  assert.equal(wrapper.get('button[type="submit"]').attributes('disabled'), '')
  await inputs[0].setValue('🙂'.repeat(200))
  await wrapper.get('.editor-form textarea').setValue('🙂'.repeat(4097))
  assert.equal(wrapper.get('button[type="submit"]').attributes('disabled'), '')
  wrapper.unmount()
})

test('FAQ editor updates every field and cancel emits no update', async () => {
  const FaqEditor = await component('FaqEditor')
  const wrapper = mount(FaqEditor, { props: { items: [faq('1', 10)], labels }, attachTo: document.body })
  await wrapper.get('[data-action="edit"]').trigger('click')
  const form = wrapper.get('[data-edit-form="faq"]')
  const inputs = form.findAll('input')
  await inputs[0].setValue('Updated question')
  await form.get('textarea').setValue('Updated answer')
  await inputs[1].setValue('18')
  await inputs[2].setValue(false)
  await inputs[0].setValue('🙂'.repeat(201))
  assert.equal(form.get('[data-action="save-edit"]').attributes('disabled'), '')
  await inputs[0].setValue('Updated question')
  await form.get('[data-action="save-edit"]').trigger('click')
  assert.deepEqual(wrapper.emitted('update')[0][0], { guid: '1', question: 'Updated question', answerMarkdown: 'Updated answer', isVisible: false, sortOrder: 18 })
  await wrapper.get('[data-action="edit"]').trigger('click')
  await wrapper.get('[data-action="cancel-edit"]').trigger('click')
  assert.equal(wrapper.emitted('update').length, 1)
  wrapper.unmount()
})

test('featured model selector allows only active present complete unique models and preserves order', async () => {
  const FeaturedModelSelector = await component('FeaturedModelSelector')
  const wrapper = mount(FeaturedModelSelector, { props: {
    selected: ['model-a'], labels,
    results: [
      { guid: '1', modelKey: 'model-a', displayName: 'A', status: 'active', upstreamState: 'present', completeness: 'complete' },
      { guid: '2', modelKey: 'model-b', displayName: 'B', status: 'active', upstreamState: 'present', completeness: 'complete' },
      { guid: '3', modelKey: 'model-c', displayName: 'C', status: 'inactive', upstreamState: 'present', completeness: 'complete' },
    ],
  }, attachTo: document.body })
  const results = wrapper.findAll('.model-search-results li')
  assert.equal(results.length, 2)
  assert.equal(results[0].get('button').attributes('disabled'), '')
  await results[1].get('button').trigger('click')
  assert.deepEqual(wrapper.emitted('save')[0][0], ['model-a', 'model-b'])
  const orderButtons = wrapper.findAll('.editor-order-actions button')
  assert.equal(orderButtons[0].attributes('disabled'), '')
  assert.equal(orderButtons[1].attributes('disabled'), '')
  wrapper.unmount()

  const limited = mount(FeaturedModelSelector, { props: {
    selected: Array.from({ length: 12 }, (_, index) => `model-${index}`), labels,
    results: [{ guid: '9', modelKey: 'model-extra', displayName: 'Extra', status: 'active', upstreamState: 'present', completeness: 'complete' }],
  } })
  assert.equal(limited.get('.model-search-results button').attributes('disabled'), '')
  limited.unmount()
})
