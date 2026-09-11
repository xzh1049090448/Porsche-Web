import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { createPinia, setActivePinia } from 'pinia'
import { compile } from 'sass'
import { JSDOM } from 'jsdom'
import postcss from 'postcss'

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

function selectorSpecificity(selector) {
  const ids = selector.match(/#[\w-]+/g)?.length ?? 0
  const classes = selector.match(/\.[\w-]+|\[[^\]]+\]|:(?!:)[\w-]+/g)?.length ?? 0
  const elements = selector
    .replace(/#[\w-]+|\.[\w-]+|\[[^\]]+\]|::?[\w-]+/g, ' ')
    .match(/[a-zA-Z][\w-]*/g)?.length ?? 0
  return [ids, classes, elements]
}

function winsCascade(next, current) {
  if (!current) return true
  if (next.important !== current.important) return next.important
  for (let index = 0; index < next.specificity.length; index += 1) {
    if (next.specificity[index] !== current.specificity[index]) {
      return next.specificity[index] > current.specificity[index]
    }
  }
  return next.order > current.order
}

function computeRootCustomProperties(stylesheets, rootElement) {
  const winners = new Map()
  let order = 0
  for (const stylesheet of stylesheets) {
    postcss.parse(stylesheet).walkRules(rule => {
      for (const selector of rule.selectors ?? []) {
        let matches = false
        try { matches = rootElement.matches(selector) } catch {}
        if (!matches) continue
        const specificity = selectorSpecificity(selector)
        rule.walkDecls(/^--/, declaration => {
          const candidate = { important: declaration.important, specificity, order: order += 1, value: declaration.value }
          if (winsCascade(candidate, winners.get(declaration.prop))) winners.set(declaration.prop, candidate)
        })
      }
    })
  }
  return new Map([...winners].map(([name, winner]) => [name, winner.value]))
}

function findChrome() {
  return [
    process.env.CHROME_BIN,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].find(candidate => candidate && existsSync(candidate))
}

function readComputedValuesInChrome(chrome, htmlPath, profilePath) {
  return new Promise((resolve, reject) => {
    const child = spawn(chrome, [
      '--headless=new', '--disable-gpu', '--no-sandbox', '--disable-background-networking',
      '--disable-component-update', '--disable-default-apps', '--disable-extensions', '--disable-sync',
      '--metrics-recording-only', '--no-first-run', '--no-default-browser-check',
      `--user-data-dir=${profilePath}`, '--dump-dom', `file://${htmlPath}`,
    ], { detached: true, stdio: ['ignore', 'pipe', 'ignore'] })
    let output = ''
    let settled = false
    const stop = () => {
      clearTimeout(timer)
      child.stdout.destroy()
      try { process.kill(-child.pid, 'SIGKILL') } catch {}
      child.unref()
    }
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      stop()
      reject(new Error('headless browser timed out before emitting computed theme values'))
    }, 15_000)

    child.stdout.setEncoding('utf8')
    child.stdout.on('data', chunk => {
      output += chunk
      const encoded = output.match(/data-computed="([^"]+)"/)?.[1]
      if (!encoded || settled) return
      settled = true
      stop()
      resolve(JSON.parse(Buffer.from(encoded, 'base64').toString()))
    })
    child.on('error', error => {
      if (settled) return
      settled = true
      stop()
      reject(error)
    })
    child.on('close', (code, signal) => {
      if (settled) return
      settled = true
      stop()
      reject(Object.assign(new Error(`headless browser exited before emitting computed values (${code ?? signal})`), { signal }))
    })
  })
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

test('a throwing localStorage getter falls back to the system theme', () => {
  installEnvironment({ systemDark: true })
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get() { throw new DOMException('storage blocked', 'SecurityError') },
  })

  assert.doesNotThrow(() => readStoredTheme())
  assert.equal(readStoredTheme(), 'dark')
})

test('dark Element Plus mappings win when its production CSS loads after compiled tokens', () => {
  const tokensCss = compile(fileURLToPath(new URL('../styles/tokens.scss', import.meta.url))).css
  const elementPlusCss = readFileSync(new URL('../../node_modules/element-plus/dist/index.css', import.meta.url), 'utf8')
  const dom = new JSDOM('<!doctype html><html data-theme="dark"><head></head><body></body></html>')
  try {
    const computed = computeRootCustomProperties([tokensCss, elementPlusCss], dom.window.document.documentElement)
    const expected = {
      '--el-color-primary-rgb': 'var(--color-brand-rgb)',
      '--el-color-danger-rgb': 'var(--state-danger-rgb)',
      '--el-color-error-rgb': 'var(--state-danger-rgb)',
      '--el-color-primary': 'var(--color-brand)',
      '--el-color-success': 'var(--state-success)',
      '--el-color-warning': 'var(--state-warning)',
      '--el-color-danger': 'var(--state-danger)',
      '--el-color-error': 'var(--state-danger)',
      '--el-color-info': 'var(--state-info)',
      '--el-bg-color': 'var(--surface-card)',
      '--el-bg-color-page': 'var(--surface-page)',
      '--el-bg-color-overlay': 'var(--surface-elevated)',
      '--el-text-color-primary': 'var(--text-primary)',
      '--el-text-color-regular': 'var(--text-secondary)',
      '--el-text-color-secondary': 'var(--text-muted)',
      '--el-text-color-placeholder': 'var(--text-muted)',
      '--el-text-color-disabled': 'var(--text-disabled)',
      '--el-border-color': 'var(--border-strong)',
      '--el-border-color-light': 'var(--border-default)',
      '--el-border-color-lighter': 'var(--border-subtle)',
      '--el-border-color-extra-light': 'var(--surface-hover)',
      '--el-border-color-dark': 'var(--border-strong)',
      '--el-border-color-darker': 'var(--text-disabled)',
      '--el-fill-color-blank': 'var(--surface-card)',
      '--el-fill-color-light': 'var(--surface-hover)',
      '--el-fill-color-lighter': 'var(--surface-elevated)',
      '--el-fill-color-extra-light': 'var(--surface-page)',
      '--el-fill-color': 'var(--surface-elevated)',
      '--el-fill-color-dark': 'var(--surface-page)',
      '--el-fill-color-darker': 'var(--surface-page)',
      '--el-mask-color': 'rgb(0 0 0 / 60%)',
      '--el-mask-color-extra-light': 'rgb(0 0 0 / 30%)',
      '--el-box-shadow-light': 'var(--shadow-sm)',
      '--el-box-shadow': 'var(--shadow-md)',
      '--el-box-shadow-lighter': 'var(--shadow-sm)',
      '--el-box-shadow-dark': 'var(--shadow-lg)',
    }
    for (const [name, value] of Object.entries(expected)) {
      assert.equal(computed.get(name), value, name)
    }
  } finally {
    dom.window.close()
  }
})

test('light Element Plus mappings win with complete semantic variants when its CSS loads last', () => {
  const tokensCss = compile(fileURLToPath(new URL('../styles/tokens.scss', import.meta.url))).css
  const elementPlusCss = readFileSync(new URL('../../node_modules/element-plus/dist/index.css', import.meta.url), 'utf8')
  const dom = new JSDOM('<!doctype html><html data-theme="light"><head></head><body></body></html>')
  try {
    const computed = computeRootCustomProperties([tokensCss, elementPlusCss], dom.window.document.documentElement)
    const expected = {
      '--el-color-primary-rgb': 'var(--color-brand-rgb)',
      '--el-color-danger-rgb': 'var(--state-danger-rgb)',
      '--el-color-error-rgb': 'var(--state-danger-rgb)',
      '--el-color-primary': 'var(--color-brand)',
      '--el-color-success': 'var(--state-success)',
      '--el-color-warning': 'var(--state-warning)',
      '--el-color-danger': 'var(--state-danger)',
      '--el-color-error': 'var(--state-danger)',
      '--el-color-info': 'var(--state-info)',
      '--el-color-success-light-3': '#56cca6',
      '--el-color-warning-light-5': '#f6cc84',
      '--el-color-danger-light-9': '#f7e1e2',
      '--el-color-error-light-9': 'var(--el-color-danger-light-9)',
      '--el-color-info-dark-2': '#2563eb',
      '--el-border-color-dark': 'var(--border-strong)',
      '--el-border-color-darker': 'var(--text-disabled)',
      '--el-fill-color-blank': 'var(--surface-card)',
      '--el-fill-color-lighter': 'var(--surface-elevated)',
      '--el-fill-color-extra-light': 'var(--surface-page)',
      '--el-mask-color-extra-light': 'rgb(15 23 42 / 25%)',
      '--el-box-shadow-lighter': 'var(--shadow-sm)',
      '--el-box-shadow-dark': 'var(--shadow-lg)',
    }
    for (const [name, value] of Object.entries(expected)) {
      assert.equal(computed.get(name), value, name)
    }
  } finally {
    dom.window.close()
  }
})

test('a browser computes light and dark Element Plus values when its CSS loads last', async t => {
  const chrome = findChrome()
  if (!chrome) return t.skip('Chrome or Chromium is required for the browser cascade check')

  const tokensCss = compile(fileURLToPath(new URL('../styles/tokens.scss', import.meta.url))).css
  const elementPlusCss = readFileSync(new URL('../../node_modules/element-plus/dist/index.css', import.meta.url), 'utf8')
  const propertyNames = [
    '--el-color-primary-rgb', '--el-color-danger-rgb', '--el-color-error-rgb',
    '--el-color-primary', '--el-color-success', '--el-color-warning', '--el-color-danger', '--el-color-error', '--el-color-info',
    '--el-bg-color', '--el-bg-color-page', '--el-bg-color-overlay', '--el-text-color-primary',
    '--el-border-color', '--el-border-color-darker', '--el-fill-color', '--el-fill-color-darker',
    '--el-mask-color', '--el-mask-color-extra-light', '--el-box-shadow', '--el-box-shadow-dark',
  ]
  const directory = mkdtempSync(join(tmpdir(), 'porsche-theme-cascade-'))
  const htmlPath = join(directory, 'cascade.html')
  const html = `<!doctype html><html data-theme="dark"><head>
    <link rel="stylesheet" href="tokens.css"><link rel="stylesheet" href="element-plus.css">
    </head><body><script>
      const values = Object.fromEntries(['light', 'dark'].map(theme => {
        document.documentElement.dataset.theme = theme
        const styles = getComputedStyle(document.documentElement)
        return [theme, Object.fromEntries(${JSON.stringify(propertyNames)}.map(name => [name, styles.getPropertyValue(name).trim()]))]
      }))
      document.body.dataset.computed = btoa(JSON.stringify(values))
    </script></body></html>`

  try {
    writeFileSync(htmlPath, html)
    writeFileSync(join(directory, 'tokens.css'), tokensCss)
    writeFileSync(join(directory, 'element-plus.css'), elementPlusCss)
    let computed
    try {
      computed = await readComputedValuesInChrome(chrome, htmlPath, join(directory, 'profile'))
    } catch (error) {
      if (error.signal === 'SIGABRT') return t.skip('the execution sandbox blocked the browser process')
      throw error
    }
    assert.deepEqual(computed, {
      light: {
        '--el-color-primary-rgb': '37, 99, 235',
        '--el-color-danger-rgb': '239, 68, 68',
        '--el-color-error-rgb': '239, 68, 68',
        '--el-color-primary': '#2563eb',
        '--el-color-success': '#10b981',
        '--el-color-warning': '#f59e0b',
        '--el-color-danger': '#ef4444',
        '--el-color-error': '#ef4444',
        '--el-color-info': '#3b82f6',
        '--el-bg-color': '#ffffff',
        '--el-bg-color-page': '#f8fafc',
        '--el-bg-color-overlay': '#ffffff',
        '--el-text-color-primary': '#111827',
        '--el-border-color': '#cbd5e1',
        '--el-border-color-darker': '#c0c4cc',
        '--el-fill-color': '#f1f5f9',
        '--el-fill-color-darker': '#cbd5e1',
        '--el-mask-color': 'rgb(15 23 42 / 50%)',
        '--el-mask-color-extra-light': 'rgb(15 23 42 / 25%)',
        '--el-box-shadow': '0 8px 24px rgb(15 23 42 / 10%)',
        '--el-box-shadow-dark': '0 18px 50px rgb(15 23 42 / 12%)',
      },
      dark: {
        '--el-color-primary-rgb': '59, 130, 246',
        '--el-color-danger-rgb': '239, 68, 68',
        '--el-color-error-rgb': '239, 68, 68',
        '--el-color-primary': '#3b82f6',
        '--el-color-success': '#10b981',
        '--el-color-warning': '#fbbf24',
        '--el-color-danger': '#ef4444',
        '--el-color-error': '#ef4444',
        '--el-color-info': '#3b82f6',
        '--el-bg-color': '#111827',
        '--el-bg-color-page': '#0f172a',
        '--el-bg-color-overlay': '#1e293b',
        '--el-text-color-primary': '#f8fafc',
        '--el-border-color': '#475569',
        '--el-border-color-darker': '#64748b',
        '--el-fill-color': '#1e293b',
        '--el-fill-color-darker': '#0f172a',
        '--el-mask-color': 'rgb(0 0 0 / 60%)',
        '--el-mask-color-extra-light': 'rgb(0 0 0 / 30%)',
        '--el-box-shadow': '0 8px 24px rgb(0 0 0 / 35%)',
        '--el-box-shadow-dark': '0 18px 50px rgb(0 0 0 / 42%)',
      },
    })
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
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
