import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { JSDOM } from 'jsdom'

const boot = readFileSync(new URL('../../../index.html', import.meta.url), 'utf8').match(/<script>([\s\S]*?)<\/script>/)[1]
for (const [label, path, stored, systemDark, expected] of [
  ['first homepage visit defaults to light even on a dark system', '/', null, true, 'light'],
  ['saved dark preference is preserved', '/', 'dark', false, 'dark'],
  ['saved light preference is preserved', '/', 'light', true, 'light'],
  ['explicit system preference follows dark OS', '/', 'system', true, 'dark'],
  ['explicit system preference follows light OS', '/', 'system', false, 'light'],
  ['other pages keep their current system default', '/pricing', null, true, 'dark'],
]) test(label, () => {
  const dom = new JSDOM('', { url: `https://local.test${path}`, runScripts: 'outside-only' })
  dom.window.matchMedia = () => ({ matches: systemDark })
  if (stored) dom.window.localStorage.setItem('llm_platform_uiTheme', JSON.stringify(stored))
  dom.window.eval(boot)
  assert.equal(dom.window.document.documentElement.dataset.theme, expected)
  assert.equal(dom.window.localStorage.getItem('llm_platform_uiTheme'), stored ? JSON.stringify(stored) : null)
  dom.window.close()
})

for (const [path, stored, expected] of [
  ['/', null, '/nav_logo.png'], ['/', 'dark', '/dark_nav_logo.png'],
  ['/login', 'light', '/logo_refined.png'], ['/register', 'dark', '/dark_logo.png'],
]) test(`early brand preload matches the active theme at ${path} ${stored}`, () => {
  const dom = new JSDOM('', { url: `https://local.test${path}`, runScripts: 'outside-only' })
  dom.window.matchMedia = () => ({ matches: false })
  if (stored) dom.window.localStorage.setItem('llm_platform_uiTheme', JSON.stringify(stored))
  dom.window.eval(boot)
  const preload = dom.window.document.querySelector('link[rel="preload"][as="image"]')
  assert.ok(preload, 'brand asset should be discovered before client rendering')
  assert.equal(preload.getAttribute('href'), expected)
  dom.window.close()
})
