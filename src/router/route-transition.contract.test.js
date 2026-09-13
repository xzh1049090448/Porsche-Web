import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8')
const readRequired = (path, label) => {
  const url = new URL(path, import.meta.url)
  assert.equal(existsSync(url), true, `${label} must exist at ${url.pathname}`)
  return readFileSync(url, 'utf8')
}

test('shared route transition keys leaf views by fullPath and identity epoch', () => {
  const transition = readRequired('../components/shell/RouteTransition.vue', 'shared route transition component')
  assert.match(transition, /<RouterView\b[^>]*v-slot=/)
  assert.match(transition, /<Transition\b[^>]*\bmode=["']out-in["']/)
  assert.match(transition, /route\.fullPath/)
  assert.match(transition, /identityEpoch/)
  assert.match(transition, /(?:route\.fullPath[\s\S]{0,160}identityEpoch|identityEpoch[\s\S]{0,160}route\.fullPath)/, 'route key composes route.fullPath with identity epoch')
})

test('route transition is opacity-only with approved timings and immediate reduced motion', () => {
  const transition = readRequired('../components/shell/RouteTransition.vue', 'shared route transition component')
  assert.match(transition, /route-transition-enter-active[^}]*transition:\s*opacity\s+350ms(?:\s+[^,;{}]+)?\s*;/s)
  assert.match(transition, /route-transition-leave-active[^}]*transition:\s*opacity\s+200ms(?:\s+[^,;{}]+)?\s*;/s)
  assert.match(transition, /route-transition-(?:enter-from|leave-to)[^}]*opacity:\s*0\b/s)
  assert.doesNotMatch(transition, /transition(?:-property)?\s*:[^;{}]*(?:transform|filter|height|width|all)\b/i)
  assert.doesNotMatch(transition, /\btransform\s*:/i)
  assert.match(transition, /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*?(?:transition:\s*none|transition-duration:\s*0m?s)/i, 'reduced motion makes the route transition immediate')
})

test('public and authenticated shells reuse the shared transition component', () => {
  const publicLayout = read('../layouts/PublicLayout.vue')
  const authEntry = read('../bootstrap/AuthApp.vue')
  const mainLayout = read('../layouts/MainLayout.vue')
  for (const [source, label] of [[publicLayout, 'public child outlet'], [authEntry, 'authenticated top-level outlet'], [mainLayout, 'console content outlet']]) {
    assert.match(source, /@\/components\/shell\/RouteTransition\.vue/, `${label} imports the shared transition`)
    assert.match(source, /RouteTransition/, `${label} renders the shared transition`)
  }
  assert.match(publicLayout, /h\(RouteTransition/, 'public child outlet uses the shared transition in its render function')
  assert.match(authEntry, /<RouteTransition\b/, 'authenticated entry uses the shared transition')
  assert.match(mainLayout, /<RouteTransition\b[^>]*identity-epoch/i, 'console content transition receives the existing identity epoch')
})

test('router preserves guarded cross-bootstrap handoff and explicit scroll behavior', () => {
  const router = read('./index.js')
  assert.match(router, /export function installBootstrapHandoff/)
  assert.match(router, /if\s*\(!mode\s*\|\|\s*typeof handoff !== ['"]function['"]\)\s*return router/)
  assert.match(router, /if\s*\(targetMode === mode\)\s*return true/)
  assert.match(router, /handoff\(to\.fullPath\)[\s\S]{0,40}return false/)
  assert.match(router, /function\s+\w*scroll\w*\s*\(\s*to\s*,\s*from\s*,\s*savedPosition\s*\)/i, 'router defines scroll behavior for hash, pop and new routes')
  assert.match(router, /if\s*\(\s*savedPosition\s*\)\s*return\s+savedPosition/, 'pop navigation restores saved position')
  assert.match(router, /if\s*\(\s*to\.hash\s*\)[\s\S]{0,180}\bel\s*:\s*to\.hash/, 'hash navigation targets its anchor')
  assert.match(router, /(?:to\.path\s*!==\s*from\.path|to\.fullPath\s*!==\s*from\.fullPath)[\s\S]{0,180}\btop\s*:\s*0/, 'new-route navigation starts at the top')
  assert.match(router, /createRouter\(\s*\{[^}]*\bscrollBehavior\b/s, 'router installs the shared scroll behavior')
})
