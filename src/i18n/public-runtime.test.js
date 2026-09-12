import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { messages } from './messages.js'
import { publicMessages } from './public-messages.js'
import { applyPublicLocale, persistPublicLocale, publicText, readPublicLocale } from './public-runtime.js'

test('public runtime imports only the dedicated public message catalog', () => {
  const source = readFileSync(new URL('./public-runtime.js', import.meta.url), 'utf8')
  assert.match(source, /from ['"]\.\/public-messages\.js['"]/)
  assert.doesNotMatch(source, /from ['"]\.\/(?:index|messages)\.js['"]/)
})

test('dedicated public messages stay identical to the authenticated catalog', () => {
  for (const locale of ['zh', 'en']) {
    assert.deepEqual(publicMessages[locale], {
      app: { title: messages[locale].app.title },
      publicSite: messages[locale].publicSite,
    })
  }
})
test('public runtime exposes every shell and state label in Chinese and English', () => {
  for (const locale of ['zh', 'en']) for (const key of ['skip', 'home', 'advantages', 'models', 'announcements', 'faq', 'cta', 'console', 'pricing', 'about', 'terms', 'privacy', 'loading', 'preparing', 'empty', 'error', 'retry', 'demo', 'menu', 'toc', 'version', 'effectiveDate', 'contact', 'acknowledge', 'language']) assert.notEqual(publicText(locale, key), `publicSite.${key}`)
  assert.notEqual(publicText('zh', 'retry'), publicText('en', 'retry'))
})

test('public locale uses the shared JSON storage contract across public and authenticated reloads', () => {
  const values = new Map(); const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) }
  const target = { documentElement: { lang: '' }, title: '' }
  assert.equal(persistPublicLocale('en', storage, target), 'en')
  assert.equal(values.has('uiLocale'), false)
  assert.equal(values.get('llm_platform_uiLocale'), JSON.stringify('en'))
  assert.equal(readPublicLocale(storage), 'en')
  assert.equal(target.documentElement.lang, 'en')
  assert.equal(target.title, 'China LLM Hub')
  applyPublicLocale('zh', target)
  assert.equal(target.documentElement.lang, 'zh-CN')
  assert.equal(target.title, '中国大模型聚合平台')
})

test('public runtime loads and falls back without escaping a blocked localStorage getter', async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get() { throw new DOMException('storage blocked', 'SecurityError') },
  })
  try {
    const runtime = await import('./public-runtime.js?blocked-storage')
    assert.doesNotThrow(() => runtime.readPublicLocale())
    assert.equal(runtime.readPublicLocale(), 'zh')
    const target = { documentElement: { lang: '' }, title: '' }
    assert.doesNotThrow(() => runtime.persistPublicLocale('en', undefined, target))
    assert.equal(target.documentElement.lang, 'en')
    assert.equal(target.title, 'China LLM Hub')
  } finally {
    if (original) Object.defineProperty(globalThis, 'localStorage', original)
    else delete globalThis.localStorage
  }
})
