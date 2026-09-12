import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

const checker = resolve('scripts/check-production-bundle.mjs')
async function fixture(files) {
  const cwd = await mkdtemp(join(tmpdir(), 'production-bundle-check-'))
  await mkdir(join(cwd, 'dist', '.vite'), { recursive: true })
  for (const [name, content] of Object.entries(files)) {
    const path = join(cwd, 'dist', name)
    await mkdir(resolve(path, '..'), { recursive: true })
    await writeFile(path, content)
  }
  return spawnSync(process.execPath, [checker], { cwd, encoding: 'utf8' })
}

test('rejects a production manifest that imports the general mock module', async () => {
  const result = await fixture({
    '.vite/manifest.json': JSON.stringify({ 'src/main.js': { file: 'assets/main.js', imports: ['_mock-deadbeef.js'] }, '_mock-deadbeef.js': { file: 'assets/mock-deadbeef.js' } }),
    'assets/main.js': 'export{}',
    'assets/mock-deadbeef.js': 'export{}',
  })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /general mock module/i)
})

for (const [name, marker] of Object.entries({ phone: '13800138000', password: 'Porsche@2026', token: 'mock_token_', fixtureGuid: '355650202352226304' })) {
  test(`rejects representative ${name} fixture content`, async () => {
    const result = await fixture({ '.vite/manifest.json': '{}', 'assets/main.js': `const value=${JSON.stringify(marker)}` })
    assert.equal(result.status, 1)
    assert.match(result.stderr, /mock fixture marker/i)
  })
}

test('accepts a clean production bundle', async () => {
  const result = await fixture({ '.vite/manifest.json': JSON.stringify({ 'src/main.js': { file: 'assets/main.js' } }), 'assets/main.js': 'export{}' })
  assert.equal(result.status, 0, result.stderr)
})
