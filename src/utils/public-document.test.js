import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { controlledAssetSrc, createPublishedDocumentCodec, safePublishedHref, selectCuratedModels } from './public-document.js'

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
  assert.equal((value.bodyHTML.match(/<h1/g) || []).length, 0)
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

test('renders only normalized backend-approved local assets', () => {
  const html = codec.decode('![logo](/assets/logo.svg) ![nested](/assets/models/a.png) ![remote](https://evil.example/x.png) ![relative](//evil/x) ![encoded](/assets/%2e%2e/x) ![traversal](/assets/../x) ![directory](/assets/models/) ![data](data:image/png,x)').html
  assert.match(html, /src="\/assets\/logo\.svg"/)
  assert.match(html, /src="\/assets\/models\/a\.png"/)
  assert.equal((html.match(/<img/g) || []).length, 2)
  assert.equal(controlledAssetSrc('/assets/logo.svg'), true)
  for (const value of ['/assets/', '/assets/models/', '/assets/../x', '/assets/%2e%2e/x', '//assets/x', '\\assets\\x', 'https://x/assets/a']) assert.equal(controlledAssetSrc(value), false)
  for (const value of ['/assets/%61.png', '/assets/a%2epng']) assert.equal(controlledAssetSrc(value), true)
})

test('associates only controlled published model assets with stable model references', () => {
  const value = codec.decode('# 首页\n\n## 支持模型\n\n[![Alpha](/assets/models/alpha.svg)](/pricing/alpha-chat) [![Bad](https://evil/x)](/pricing/beta)')
  assert.deepEqual(value.modelAssets, { 'alpha-chat': '/assets/models/alpha.svg' })
})

test('advantages use repeated level-three CommonMark cards capped at eight', () => {
  const cards = Array.from({ length: 10 }, (_, index) => `### 优势 ${index + 1}\n\n说明 ${index + 1}`).join('\n\n')
  const value = codec.decode(`# 首页\n\n## 产品优势\n\n${cards}`)
  assert.equal(value.advantageCards.length, 8)
  assert.deepEqual(value.advantageCards.slice(0, 2).map(card => card.title), ['优势 1', '优势 2'])
  assert.match(value.advantageCards[7].html, /说明 8/)
})

test('shell links use an explicit CommonMark links section and omit absent or unsafe entries', () => {
  const present = codec.decode('# 首页\n\n## 导航链接\n\n- [文档](https://docs.example.com)\n- [服务状态](https://status.example.com)\n- [联系我们](https://contact.example.com)\n- [邮件](mailto:help@example.com)\n- [占位](#)\n- [内部管理](/users)')
  assert.deepEqual(present.shellLinks, [{ label: '文档', href: 'https://docs.example.com', placement: 'header' }, { label: '服务状态', href: 'https://status.example.com', placement: 'header' }, { label: '联系我们', href: 'https://contact.example.com', placement: 'contact' }])
  assert.deepEqual(codec.decode('# 首页\n\n正文').shellLinks, [])
})

test('sanitizer allows approved local paths, real fragments and configured external contacts only', () => {
  assert.equal(safePublishedHref('/pricing/alpha-chat'), true)
  assert.equal(safePublishedHref('/users'), false)
  assert.equal(safePublishedHref('#legal-contact'), true)
  assert.equal(safePublishedHref('#'), false)
  assert.equal(safePublishedHref('https://docs.example.com/help', ['https://docs.example.com/help']), true)
  assert.equal(safePublishedHref('mailto:support@example.com', ['mailto:support@example.com']), false)
  assert.equal(safePublishedHref('https://other.example.com', ['https://docs.example.com/help']), false)
})

test('legal CommonMark removes every contact section and maps each TOC href to its rendered heading', () => {
  const valid = codec.decode(`# 服务协议\n\n版本：v1\n\n生效日期：2026-09-10\n\n## 使用规则\n\n正文内容。\n\n## 联系方式\n\nsupport@example.com\n\n## 数据规则\n\n数据正文。\n\n## Contact\n\nbackup@example.com`)
  const legal = codec.legal(valid); assert.equal(legal.valid, true); assert.equal((legal.legalBodyHTML.match(/<h1/g) || []).length, 0); assert.doesNotMatch(legal.legalBodyHTML, /联系方式|backup@example\.com|<h2[^>]*>Contact/)
  const rendered = new JSDOM(`<article>${legal.legalBodyHTML}</article>`).window.document
  assert.deepEqual(legal.toc.map(item => item.id), ['legal-section-1', 'legal-section-2'])
  for (const item of legal.toc) assert.equal(rendered.getElementById(item.id)?.textContent.trim(), item.text)
})

test('legal CommonMark requires nonblank title version effective date body toc and contact', () => {
  for (const markdown of ['# 标题\n\n版本：v1\n\n生效日期：2026-09-10\n\n## 正文\n\n内容', '# 标题\n\n版本： \n\n生效日期：2026-09-10\n\n## 正文\n\n内容\n\n## 联系方式\n\nx', '# 标题\n\n版本：v1\n\n生效日期：2026-09-10\n\n## 正文\n\n## 联系方式\n\nx']) assert.equal(codec.legal(codec.decode(markdown)).valid, false)
})
