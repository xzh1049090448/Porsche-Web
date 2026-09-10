import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

test('production build emits a manifest and has an executable public chunk gate', () => {
  const vite = readFileSync(new URL('../../vite.config.js', import.meta.url), 'utf8')
  const gate = readFileSync(new URL('../../scripts/check-public-route-chunks.mjs', import.meta.url), 'utf8')
  assert.match(vite, /manifest:\s*true/)
  assert.match(gate, /manifest\.json/)
  assert.match(gate, /PublicLayout\.vue/)
  for (const marker of ['admin-users', 'users\\.create', 'users\\.delete', 'action-verifications']) assert.match(gate, new RegExp(marker))
})
