import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'vite'
import { createPinia, setActivePinia } from 'pinia'

const vite = await createServer({
  root: new URL('../../', import.meta.url).pathname,
  logLevel: 'silent',
  server: { middlewareMode: true },
  appType: 'custom',
})
after(() => vite.close())

const themeModule = await vite.ssrLoadModule('/src/stores/theme.js')
const { THEME_STORAGE_KEY, applyTheme, readStoredTheme, useThemeStore } = themeModule
const STORAGE_KEY = `llm_platform_${THEME_STORAGE_KEY}`
const GLOBAL_KEYS = ['document', 'localStorage', 'matchMedia']
const originalDescriptors = new Map(GLOBAL_KEYS.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))

function setGlobal(key, value) {
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
}

function restoreGlobals() {
  for (const [key, descriptor] of originalDescriptors) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor)
    else delete globalThis[key]
  }
}

function memoryStorage(initialTheme) {
  const values = new Map()
  if (initialTheme !== undefined) values.set(STORAGE_KEY, JSON.stringify(initialTheme))
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key),
  }
}

function installEnvironment({ stored, systemDark = false, withMatchMedia = true, withDocument = true } = {}) {
  const storage = memoryStorage(stored)
  setGlobal('localStorage', storage)
  if (withMatchMedia) setGlobal('matchMedia', query => ({ matches: query === '(prefers-color-scheme: dark)' && systemDark }))
  else delete globalThis.matchMedia
  if (withDocument) setGlobal('document', { documentElement: { dataset: {} } })
  else delete globalThis.document
  return storage
}

test.afterEach(restoreGlobals)

for (const [name, options, expected] of [
  ['stored light overrides a dark system', { stored: 'light', systemDark: true }, 'light'],
  ['stored dark overrides a light system', { stored: 'dark', systemDark: false }, 'dark'],
  ['missing storage follows a dark system', { systemDark: true }, 'dark'],
  ['missing storage follows a light system', { systemDark: false }, 'light'],
  ['invalid storage follows the system', { stored: 'sepia', systemDark: true }, 'dark'],
  ['missing matchMedia falls back to light', { withMatchMedia: false }, 'light'],
]) {
  test(name, () => {
    installEnvironment(options)
    assert.equal(readStoredTheme(), expected)
  })
}

test('applyTheme is safe without a DOM and applies a normalized theme when available', () => {
  installEnvironment({ withDocument: false })
  assert.doesNotThrow(() => applyTheme('dark'))

  setGlobal('document', { documentElement: { dataset: {} } })
  applyTheme('dark')
  assert.equal(document.documentElement.dataset.theme, 'dark')
  applyTheme('unsupported')
  assert.equal(document.documentElement.dataset.theme, 'light')
})

test('manual theme selection applies and persists ahead of the system preference', () => {
  const storage = installEnvironment({ systemDark: true })
  setActivePinia(createPinia())
  const store = useThemeStore()

  assert.equal(store.theme, 'dark')
  store.setTheme('light')
  assert.equal(store.theme, 'light')
  assert.equal(document.documentElement.dataset.theme, 'light')
  assert.equal(JSON.parse(storage.getItem(STORAGE_KEY)), 'light')
  assert.equal(readStoredTheme(), 'light')
})

test('theme scenarios restore every browser global descriptor', () => {
  for (const [key, descriptor] of originalDescriptors) {
    assert.deepEqual(Object.getOwnPropertyDescriptor(globalThis, key), descriptor, key)
  }
})
