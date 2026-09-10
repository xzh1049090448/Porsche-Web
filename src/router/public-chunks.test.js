import test from 'node:test'
import assert from 'node:assert/strict'
import { validatePublicGraph } from '../../scripts/check-public-route-chunks.mjs'
import { publicModuleGraphPlugin } from '../../scripts/public-module-graph.mjs'

function fixture(extraModules = []) {
  const root = '/repo'
  const plugin = publicModuleGraphPlugin()
  plugin.configResolved({ root })
  let graph
  plugin.generateBundle.call({
    emitFile(asset) { graph = JSON.parse(asset.source) },
  }, {}, {
    'assets/entry.js': { type: 'chunk', isEntry: true, imports: [], modules: Object.fromEntries([
      'src/main.js', 'src/App.vue', 'src/router/index.js', 'src/utils/auth-redirect.js', ...extraModules,
    ].map(id => [`${root}/${id}`, {}])), code: 'bootstrap', viteMetadata: { importedCss: new Set() } },
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

test('build-produced graph rejects a protected module injected into the public closure', () => {
  const graph = fixture(['src/stores/admin-user-actions.js'])
  assert.throws(() => validatePublicGraph(graph), /non-public local module.*admin-user-actions/)
})

test('build-produced graph rejects an unknown local module even without protected markers', () => {
  const graph = fixture(['src/utils/innocent-looking-unknown.js'])
  assert.throws(() => validatePublicGraph(graph), /non-public local module.*innocent-looking-unknown/)
})

test('build-produced graph rejects Element Plus, all-icons, and global authenticated styles', () => {
  for (const moduleId of ['node_modules/element-plus/es/index.mjs', 'node_modules/@element-plus/icons-vue/dist/index.mjs', 'src/styles/global.scss']) {
    const graph = fixture([moduleId])
    assert.throws(() => validatePublicGraph(graph), /forbidden public dependency|non-public local module/)
  }
})
