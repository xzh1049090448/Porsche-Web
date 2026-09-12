import assert from 'node:assert/strict'
import test from 'node:test'
import { createPinia, setActivePinia } from 'pinia'
import { createServer } from 'vite'

test('real settings reload normalizes stale compare selection against a one-model catalog and persists exit', async () => {
  const values = new Map([
    ['llm_platform_compareMode', 'true'],
    ['llm_platform_compareModelIds', JSON.stringify(['model-a', 'removed-model'])],
    ['llm_platform_selectedModel', JSON.stringify('removed-model')],
  ])
  const originalStorage = globalThis.localStorage
  globalThis.localStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) }
  const server = await createServer({ envFile: false, server: { middlewareMode: true, watch: null, ws: false }, optimizeDeps: { noDiscovery: true, include: [] }, define: { 'import.meta.env.VITE_USE_MOCK': 'false' } })
  try {
    const { useSettingsStore } = await server.ssrLoadModule('/src/stores/settings.js')
    setActivePinia(createPinia())
    const first = useSettingsStore()
    assert.equal(first.compareMode, true, 'sanity check persisted stale state was read')
    assert.deepEqual(first.compareModelIds, ['model-a', 'removed-model'])
    first.models = [{ id: 'model-a', title: 'Model A' }]
    first.modelsLoaded = true
    first.normalizeModelSelection()
    assert.deepEqual(first.compareModelIds, ['model-a'])
    assert.equal(first.compareMode, false)
    assert.equal(values.get('llm_platform_compareMode'), 'false')
    setActivePinia(createPinia())
    const reloaded = useSettingsStore()
    assert.equal(reloaded.compareMode, false, 'normalized compare exit must survive a real store reload')
    assert.deepEqual(reloaded.compareModelIds, ['model-a'])
  } finally {
    await server.close()
    globalThis.localStorage = originalStorage
  }
})
