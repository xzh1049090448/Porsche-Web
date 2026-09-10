import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { bootstrapApplication } from '../bootstrap-app.js'
import { createLazyLoadFailureHandler, renderSafeLoadError } from '../router/index.js'

test('rejected auth bootstrap import reloads once then renders fallback without an unhandled rejection', async () => {
  const values = new Map()
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) }
  let reloads = 0
  let fallbacks = 0
  const recover = createLazyLoadFailureHandler({ storage, reload: () => { reloads += 1 }, fallback: () => { fallbacks += 1 } })
  const loadAuthApp = async () => { throw new TypeError('Failed to fetch dynamically imported module: /assets/AuthApp-old.js') }

  assert.equal(await bootstrapApplication({ mode: 'auth', loadAuthApp, recover }), false)
  assert.equal(reloads, 1)
  assert.equal(fallbacks, 0)
  assert.equal(await bootstrapApplication({ mode: 'auth', loadAuthApp, recover }), false)
  assert.equal(reloads, 1)
  assert.equal(fallbacks, 1)
  assert.equal(await bootstrapApplication({ mode: 'auth', loadAuthApp, recover }), false)
  assert.equal(reloads, 1)
  assert.equal(fallbacks, 2)
})

test('safe bootstrap fallback is accessible and offers an explicit retry', () => {
  const dom = new JSDOM('<div id="app"></div>')
  const previousDocument = globalThis.document
  globalThis.document = dom.window.document
  let retries = 0
  try {
    renderSafeLoadError(() => { retries += 1 })
    assert.equal(document.querySelector('main h1').textContent, '页面暂时无法加载')
    assert.equal(document.querySelector('a').getAttribute('href'), '/')
    const retry = document.querySelector('button[type="button"]')
    assert.equal(retry.textContent, '重试')
    retry.click()
    assert.equal(retries, 1)
  } finally {
    globalThis.document = previousDocument
    dom.window.close()
  }
})
