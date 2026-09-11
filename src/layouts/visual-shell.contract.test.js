import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const read = path => readFile(new URL(path, import.meta.url), 'utf8')

test('current public and authenticated layouts keep stable accessible landmarks', async () => {
  const [publicLayout, mainLayout] = await Promise.all([
    read('./PublicLayout.vue'),
    read('./MainLayout.vue'),
  ])

  assert.match(publicLayout, /class="public-layout"/)
  assert.match(publicLayout, /class="public-skip-link"[^>]+href="#public-content"/)
  assert.match(publicLayout, /<main id="public-content" tabindex="-1">/)
  assert.match(publicLayout, /<PublicHeader/)
  assert.match(publicLayout, /<PublicFooter/)

  assert.match(mainLayout, /class="main-layout"/)
  assert.match(mainLayout, /<AuthStatus/)
  assert.match(mainLayout, /class="app-header"/)
  assert.match(mainLayout, /class="header-menu desktop-only"/)
  assert.match(mainLayout, /<MobileDrawer/)
  assert.match(mainLayout, /<el-main class="app-main">/)
})

test('authenticated navigation keeps users.read and Root visibility semantics', async () => {
  const mainLayout = await read('./MainLayout.vue')

  assert.match(mainLayout, /admin_permissions\?\.includes\(['"]users\.read['"]\) === true/)
  assert.match(mainLayout, /user\.value\?\.role === ['"]root['"]/)
  for (const path of [
    '/users',
    '/admin/public-models',
    '/admin/public-pricing',
    '/admin/public-content',
    '/admin/notifications',
  ]) assert.match(mainLayout, new RegExp(path.replaceAll('/', '\\/')))
  assert.match(mainLayout, /<router-view :key="userStore\.identityEpoch"/)

  const userStore = await read('../stores/user.js')
  assert.match(userStore, /const identityEpoch = ref\(authSession\.capture\(\)\.epoch\)/)
  assert.match(userStore, /identityEpoch\.value = next\.epoch/)
  assert.match(userStore, /return \{[^}]*identityEpoch/)
})

test('application startup preserves public/auth bootstrap and recovery boundaries', async () => {
  const [main, router] = await Promise.all([
    read('../main.js'),
    read('../router/index.js'),
  ])

  assert.match(main, /bootstrapModeForPath\(router, window\.location\.pathname\)/)
  assert.match(main, /loadAuthApp/)
  assert.match(main, /mountPublicApp:[\s\S]*createPinia\(\)/)
  assert.match(main, /createLazyLoadFailureHandler/)
  assert.match(main, /fallback:\s*\(\) => renderSafeLoadError\(\)/)
  assert.match(router, /window\.location\.assign\(path\)/)
  assert.match(router, /installBootstrapHandoff/)
  assert.match(router, /installLoadFailureRecovery/)
})

test.todo('Task 4 replaces the current public-layout marker with public-shell')
test.todo('Task 3 replaces the current authenticated layout with console-shell and console-sidebar landmarks')
