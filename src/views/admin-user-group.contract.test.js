import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { parse as parseSFC } from '@vue/compiler-sfc'
import { parse as parseTemplate } from '@vue/compiler-dom'

function walk(node, visit) {
  if (!node || typeof node !== 'object') return
  visit(node)
  for (const [key, value] of Object.entries(node)) {
    if (key === 'loc') continue
    if (Array.isArray(value)) value.forEach(item => walk(item, visit))
    else if (value && typeof value === 'object') walk(value, visit)
  }
}

function rendersPersistedGroup(ast, tag) {
  let found = false
  walk(ast, node => {
    if (node.type !== 1 || node.tag !== tag) return
    const label = node.props.find(prop => prop.type === 6 && prop.name === 'label')
    if (label?.value?.content !== '分组') return
    walk(node, child => {
      if (child.type === 5 && child.content?.content === 'store.selected.group') found = true
      if (child.type === 5 && child.content?.content === 'row.group') found = true
    })
  })
  return found
}

test('list and detail render the persisted business group', async () => {
  const [listSource, detailSource] = await Promise.all([
    readFile(new URL('./Users.vue', import.meta.url), 'utf8'),
    readFile(new URL('./UserDetail.vue', import.meta.url), 'utf8'),
  ])
  const list = parseTemplate(parseSFC(listSource, { filename: 'Users.vue' }).descriptor.template.content)
  const detail = parseTemplate(parseSFC(detailSource, { filename: 'UserDetail.vue' }).descriptor.template.content)
  assert.equal(rendersPersistedGroup(list, 'el-table-column'), true)
  assert.equal(rendersPersistedGroup(detail, 'el-descriptions-item'), true)
})
