import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { JSDOM } from 'jsdom'
import { validatePublicGraph } from '../../scripts/check-public-route-chunks.mjs'
import { publicModuleGraphPlugin } from '../../scripts/public-module-graph.mjs'

const PUBLIC_FOUNDATION_MODULES = ['src/styles/tokens.scss', 'src/styles/foundations.scss', 'src/styles/public-shell.scss']

function fixture(extraModules = []) {
  const root = '/repo'
  const plugin = publicModuleGraphPlugin()
  plugin.configResolved({ root })
  let graph
  plugin.generateBundle.call({
    emitFile(asset) { graph = JSON.parse(asset.source) },
  }, {}, {
    'assets/entry.js': { type: 'chunk', isEntry: true, imports: [], modules: Object.fromEntries([
      'src/main.js', 'src/App.vue', 'src/router/index.js', 'src/utils/auth-redirect.js', ...PUBLIC_FOUNDATION_MODULES, ...extraModules,
    ].map(id => [id.startsWith('/') || id.startsWith('\0') ? id : `${root}/${id}`, {}])), code: 'bootstrap', viteMetadata: { importedCss: new Set() } },
    'assets/public.js': { type: 'chunk', isEntry: false, imports: ['assets/entry.js'], modules: { [`${root}/src/layouts/PublicLayout.vue`]: {} }, code: 'layout', viteMetadata: { importedCss: new Set(['assets/public.css']) } },
    'assets/public.css': { type: 'asset', source: 'x'.repeat(100) },
  })
  return graph
}

test('build plugin emits a sanitized graph accepted for the small public bootstrap allowlist', () => {
  const graph = fixture()
  assert.deepEqual(validatePublicGraph(graph), { chunkCount: 2, codeBytes: 15, cssBytes: 100 })
  assert.doesNotMatch(JSON.stringify(graph), /\/repo\//)
})

test('early document theme uses valid storage first and otherwise follows the system', () => {
  const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8')
  const parsed = new JSDOM(html)
  const earlyScript = parsed.window.document.querySelector('script:not([type])').textContent
  parsed.window.close()

  const scenarios = [
    { name: 'stored light', stored: JSON.stringify('light'), systemDark: true, expected: 'light' },
    { name: 'stored dark', stored: JSON.stringify('dark'), systemDark: false, expected: 'dark' },
    { name: 'missing storage with dark system', stored: null, systemDark: true, expected: 'dark' },
    { name: 'missing storage with light system', stored: null, systemDark: false, expected: 'light' },
    { name: 'invalid JSON with dark system', stored: '{bad', systemDark: true, expected: 'dark' },
    { name: 'invalid value with dark system', stored: JSON.stringify('sepia'), systemDark: true, expected: 'dark' },
    { name: 'storage read error with dark system', storageError: true, systemDark: true, expected: 'dark' },
    { name: 'missing matchMedia', stored: null, withMatchMedia: false, expected: 'light' },
  ]

  for (const scenario of scenarios) {
    const dom = new JSDOM('<!doctype html><html><head><title></title></head></html>', {
      url: 'https://local.test/',
      runScripts: 'outside-only',
    })
    try {
      Object.defineProperty(dom.window, 'localStorage', {
        configurable: true,
        value: {
          getItem(key) {
            if (scenario.storageError) throw new Error('storage unavailable')
            return key === 'llm_platform_uiTheme' ? scenario.stored : null
          },
        },
      })
      if (scenario.withMatchMedia !== false) {
        dom.window.matchMedia = query => ({
          matches: query === '(prefers-color-scheme: dark)' && scenario.systemDark,
        })
      } else {
        delete dom.window.matchMedia
      }

      dom.window.eval(earlyScript)
      assert.equal(dom.window.document.documentElement.dataset.theme, scenario.expected, scenario.name)
    } finally {
      dom.window.close()
    }
  }
})

test('build-produced graph rejects a protected module injected into the public closure', () => {
  const graph = fixture(['src/stores/admin-user-actions.js'])
  assert.throws(() => validatePublicGraph(graph), /non-public module.*admin-user-actions/)
})

test('build-produced graph rejects an unknown local module even without protected markers', () => {
  const graph = fixture(['src/utils/innocent-looking-unknown.js'])
  assert.throws(() => validatePublicGraph(graph), /non-public module.*innocent-looking-unknown/)
})

test('build-produced graph accepts only the dedicated public shell stylesheet', () => {
  assert.deepEqual(validatePublicGraph(fixture()), { chunkCount: 2, codeBytes: 15, cssBytes: 100 })
})

test('build-produced graph rejects Element Plus, all-icons, auth modules, and non-foundation styles', () => {
  for (const moduleId of [
    'node_modules/element-plus/es/index.mjs',
    'node_modules/@element-plus/icons-vue/dist/index.mjs',
    'src/stores/theme.js',
    'src/styles/global.scss',
    'src/styles/mobile.scss',
  ]) {
    const graph = fixture([moduleId])
    assert.throws(() => validatePublicGraph(graph), /non-public module/)
  }
})

test('module graph rejects every unknown dependency and provenance class', () => {
  for (const moduleId of [
    'node_modules/lodash/lodash.js',
    '/opt/vendor/element-plus/index.mjs',
    '\0arbitrary-helper',
  ]) {
    assert.throws(() => validatePublicGraph(fixture([moduleId])), /non-public module/)
  }
})

test('external absolute module IDs are collision-resistant and never disclose their source path', () => {
  const plugin = publicModuleGraphPlugin()
  plugin.configResolved({ root: '/repo' })
  let graph
  plugin.generateBundle.call({ emitFile(asset) { graph = JSON.parse(asset.source) } }, {}, {
    'assets/entry.js': { type: 'chunk', isEntry: true, imports: [], modules: {
      '/outside/one/index.js': {},
      '/elsewhere/two/index.js': {},
    }, code: '', viteMetadata: { importedCss: new Set() } },
  })
  const modules = graph.chunks['assets/entry.js'].modules
  assert.equal(new Set(modules).size, 2)
  assert.ok(modules.every(id => /^external:[a-f0-9]{16}:index\.js$/.test(id)))
  assert.doesNotMatch(JSON.stringify(graph), /outside|elsewhere/)
})
