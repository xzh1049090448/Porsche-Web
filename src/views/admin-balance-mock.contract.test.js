import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { parse, compileTemplate } from '@vue/compiler-sfc'

const [router, component, list, detail, packageJson] = await Promise.all([
  readFile(new URL('../router/index.js', import.meta.url), 'utf8'),
  readFile(new URL('./AdminBalanceMockDemo.vue', import.meta.url), 'utf8'),
  readFile(new URL('./Users.vue', import.meta.url), 'utf8'),
  readFile(new URL('./UserDetail.vue', import.meta.url), 'utf8'),
  readFile(new URL('../../package.json', import.meta.url), 'utf8'),
])

test('A09/A10 demo is a development-only lazy route backed only by the in-memory fixture', () => {
  assert.match(router, /import\.meta\.env\.DEV\s*\?\s*\[/)
  assert.match(router, /path:\s*['"]demo\/admin\/balance['"]/)
  assert.match(router, /\(\)\s*=>\s*import\(['"]@\/views\/AdminBalanceMockDemo\.vue['"]\)/)
  assert.match(component, /createAdminBalanceMockFixture/)
  for (const forbidden of ['@/api/', 'localStorage', 'sessionStorage', 'current_password', 'users.quota.adjust']) assert.equal(component.includes(forbidden), false)
})

test('compiled demo presents balance, used amount, CNY, before/after, all scenarios, and persistent Mock labels', () => {
  const descriptor = parse(component, { filename: 'AdminBalanceMockDemo.vue' }).descriptor
  const result = compileTemplate({ id: 'a09-balance-mock', filename: 'AdminBalanceMockDemo.vue', source: descriptor.template.content })
  assert.deepEqual(result.errors, [])
  for (const text of ['可用余额', '累计已用', 'CNY', '调整前', '调整后', '成功', '失败', '超时', '版本冲突', 'Mock', '未接入']) assert.equal(component.includes(text), true, text)
})

test('A11 keeps real detail unavailable and extends production build with artifact isolation scan', () => {
  assert.match(list, /<el-table-column label="金额额度"[^>]*>未接入<\/el-table-column>/)
  assert.match(detail, /<el-descriptions-item label="金额额度">未接入<\/el-descriptions-item>/)
  assert.match(JSON.parse(packageJson).scripts.build, /check-production-bundle\.mjs/)
})
