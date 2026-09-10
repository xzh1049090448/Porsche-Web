import test from 'node:test'
import assert from 'node:assert/strict'
import { publicText } from './public-runtime.js'
test('public runtime exposes every shell and state label in Chinese and English', () => {
  for (const locale of ['zh', 'en']) for (const key of ['home', 'advantages', 'models', 'announcements', 'faq', 'cta', 'console', 'pricing', 'about', 'terms', 'privacy', 'loading', 'preparing', 'empty', 'error', 'retry', 'demo', 'menu', 'toc', 'version', 'effectiveDate', 'contact', 'acknowledge', 'language']) assert.notEqual(publicText(locale, key), `publicSite.${key}`)
  assert.notEqual(publicText('zh', 'retry'), publicText('en', 'retry'))
})
