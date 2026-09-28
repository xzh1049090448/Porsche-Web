import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('authenticated console brand links to the public homepage', async () => {
  const source = await readFile(new URL('./AppBrand.vue', import.meta.url), 'utf8')
  assert.match(source, /<router-link\s+to="\/"\s+class="app-brand"/)
  assert.doesNotMatch(source, /<router-link\s+to="\/chat"\s+class="app-brand"/)
})
