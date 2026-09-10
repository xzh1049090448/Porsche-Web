import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { createPublishedDocumentCodec, safePublishedHref, selectCuratedModels } from './public-document.js'

const dom = new JSDOM('<!doctype html><html><body></body></html>')
const codec = createPublishedDocumentCodec({ window: dom.window })

test('renders CommonMark and derives ordered deduplicated curated model keys', () => {
  const value = codec.decode(`# 已发布首页\n\n介绍。\n\n## 演示\n\n此处为演示。\n\n## 产品优势\n\n- 安全\n\n## 支持模型\n\n[甲](/pricing/alpha-chat) [重复](/pricing/alpha-chat) [乙](/pricing/beta_2)\n\n## 公告\n\n维护通知\n\n## 常见问题\n\n### 如何使用\n\n请进入控制台。\n\n## 开始使用\n\n立即开始。`)
  assert.equal(value.title, '已发布首页')
  assert.deepEqual(value.modelKeys, ['alpha-chat', 'beta_2'])
  assert.equal(value.sections.advantages.length > 0, true)
  assert.equal(value.sections.demo.length, 1)
  assert.equal(value.sections.announcements.length > 0, true)
  assert.equal(value.sections.faq.length > 0, true)
  assert.equal(value.sections.cta.length > 0, true)
})

test('curated model wall preserves reference order and intersects the published catalog', () => {
  const catalog = [{ modelKey: 'beta_2' }, { modelKey: 'alpha-chat' }, { modelKey: 'unreferenced' }]
  assert.deepEqual(selectCuratedModels(['alpha-chat', 'missing', 'beta_2', 'alpha-chat'], catalog).map(item => item.modelKey), ['alpha-chat', 'beta_2'])
})

test('announcement validity follows the atomic published CommonMark representation without invented scheduling fields', () => {
  const value = codec.decode('# 首页\n\n## 公告\n\n当前发布公告。')
  assert.equal(value.sections.announcements.length, 1)
  assert.equal(Object.hasOwn(value, 'effectiveAt'), false)
  assert.equal(Object.hasOwn(value, 'expiresAt'), false)
  assert.equal(Object.hasOwn(value, 'active'), false)
})

test('sanitizer blocks executable and bypass URLs, handlers, remote media and embeds', () => {
  const attacks = '[a](//evil.example) [b](\\\\evil.example) [c](javascript:alert(1)) [d](data:text/html,x) [e](vbscript:x) [f](%2f%2fevil.example)\n\n<img src="https://evil.example/x" onerror="alert(1)"><iframe src="/x"></iframe><a href="https://evil.example" onclick="x()">x</a>'
  const html = codec.decode(attacks).html
  assert.doesNotMatch(html, /evil\.example|javascript:|data:|vbscript:|onerror|onclick|iframe|<img/i)
})

test('sanitizer allows approved local paths, real fragments and configured external contacts only', () => {
  assert.equal(safePublishedHref('/pricing/alpha-chat'), true)
  assert.equal(safePublishedHref('/users'), false)
  assert.equal(safePublishedHref('#legal-contact'), true)
  assert.equal(safePublishedHref('#'), false)
  assert.equal(safePublishedHref('https://docs.example.com/help', ['https://docs.example.com/help']), true)
  assert.equal(safePublishedHref('mailto:support@example.com', ['mailto:support@example.com']), true)
  assert.equal(safePublishedHref('https://other.example.com', ['https://docs.example.com/help']), false)
})

test('legal CommonMark requires nonblank title version effective date body toc and contact', () => {
  const valid = codec.decode(`# 服务协议\n\n版本：v1\n\n生效日期：2026-09-10\n\n## 使用规则\n\n正文内容。\n\n## 联系方式\n\n[support@example.com](mailto:support@example.com)`)
  assert.equal(codec.legal(valid).valid, true)
  for (const markdown of ['# 标题\n\n版本：v1\n\n生效日期：2026-09-10\n\n## 正文\n\n内容', '# 标题\n\n版本： \n\n生效日期：2026-09-10\n\n## 正文\n\n内容\n\n## 联系方式\n\nx', '# 标题\n\n版本：v1\n\n生效日期：2026-09-10\n\n## 正文\n\n## 联系方式\n\nx']) assert.equal(codec.legal(codec.decode(markdown)).valid, false)
})
