import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const routerSource = readFileSync(new URL('./index.js', import.meta.url), 'utf8')
const layoutSource = readFileSync(new URL('../layouts/MainLayout.vue', import.meta.url), 'utf8')

test('public routes are named, lazy, and ordered before the public 404', () => {
  assert.match(routerSource, /path: '\/',\s*component: \(\) => import\('@\/layouts\/PublicLayout\.vue'\)/)
  for (const [path, name] of [
    ["''", 'PublicHome'],
    ["'pricing'", 'PublicPricing'],
    ["'pricing\/:modelKey'", 'PublicPricingDetail'],
    ["'about'", 'PublicAbout'],
    ["'terms'", 'PublicTerms'],
    ["'privacy'", 'PublicPrivacy'],
  ]) {
    assert.match(routerSource, new RegExp(`path: ${path}, name: '${name}'`))
  }
  const home = routerSource.indexOf("name: 'PublicHome'")
  const notFound = routerSource.indexOf("name: 'PublicNotFound'")
  assert.ok(home >= 0 && notFound > home)
  assert.match(routerSource, /path: ':pathMatch\(\.\*\)\*', name: 'PublicNotFound',[\s\S]*?import\('@\/views\/PublicNotFound\.vue'\)/)
  assert.doesNotMatch(routerSource, /path: '\/:pathMatch\(\.\*\)\*',\s*redirect:/)
})

test('authenticated routes stay under lazy MainLayout with chat at /chat', () => {
  assert.match(routerSource, /path: '\/',\s*component: \(\) => import\('@\/layouts\/MainLayout\.vue'\),\s*meta: \{ requiresAuth: true \}/)
  for (const [path, name] of [
    ['chat', 'Chat'],
    ['profile', 'Profile'],
    ['billing', 'Billing'],
    ['api-keys', 'ApiKeys'],
    ['users', 'Users'],
    ['users/:guid', 'UserDetail'],
  ]) assert.match(routerSource, new RegExp(`path: '${path}', name: '${name}'`))
  assert.doesNotMatch(routerSource, /path: '', name: 'Chat'/)
})

test('auth guard keeps public 404 anonymous and uses /chat auth fallbacks', () => {
  assert.match(routerSource, /import \{ safeAuthRedirect \} from '@\/utils\/auth-redirect'/)
  assert.match(routerSource, /to\.meta\.requiresAuth && !userStore\.isLoggedIn/)
  assert.match(routerSource, /to\.meta\.guest && userStore\.isLoggedIn\) return \{ path: '\/chat' \}/)
  assert.match(routerSource, /name === 'Login'[\s\S]*?safeAuthRedirect\(to\.query\.redirect\)/)
  assert.doesNotMatch(routerSource, /PublicNotFound[\s\S]*?requiresAuth: true/)
})

test('main layout chat navigation and history fallback use /chat', () => {
  assert.equal((layoutSource.match(/index="\/chat"/g) || []).length, 2)
  assert.match(layoutSource, /route\.path !== '\/chat'/)
  assert.match(layoutSource, /router\.push\('\/chat'\)/)
})
