import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const script = fileURLToPath(new URL('./check-production-env.mjs', import.meta.url))
const expectedError = 'Production build requires VITE_USE_MOCK=false.\n'

async function runCheck({ production, local, override } = {}) {
  const cwd = await mkdtemp(path.join(tmpdir(), 'production-env-check-'))
  if (production !== undefined) await writeFile(path.join(cwd, '.env.production'), production)
  if (local !== undefined) await writeFile(path.join(cwd, '.env.production.local'), local)

  const env = { ...process.env }
  delete env.VITE_USE_MOCK
  if (override !== undefined) env.VITE_USE_MOCK = override

  const result = spawnSync(process.execPath, [script], { cwd, env, encoding: 'utf8' })
  await rm(cwd, { recursive: true, force: true })
  return result
}

test('accepts the exact production value false without output', async () => {
  const result = await runCheck({ production: 'VITE_USE_MOCK=false\n' })
  assert.equal(result.status, 0)
  assert.equal(result.stdout, '')
  assert.equal(result.stderr, '')
})

test('loads .env.production.local after .env.production', async () => {
  const result = await runCheck({
    production: 'VITE_USE_MOCK=true\n',
    local: 'VITE_USE_MOCK=false\n',
  })
  assert.equal(result.status, 0)
  assert.equal(result.stdout, '')
  assert.equal(result.stderr, '')
})

test('process environment overrides production env files', async () => {
  const result = await runCheck({ production: 'VITE_USE_MOCK=true\n', override: 'false' })
  assert.equal(result.status, 0)
  assert.equal(result.stdout, '')
  assert.equal(result.stderr, '')
})

for (const [name, value] of [
  ['missing', undefined],
  ['blank', ''],
  ['whitespace', '   '],
  ['true', 'true'],
  ['uppercase true', 'TRUE'],
  ['zero', '0'],
]) {
  test(`rejects ${name} VITE_USE_MOCK`, async () => {
    const result = await runCheck(value === undefined ? {} : { production: `VITE_USE_MOCK=${value}\n` })
    assert.equal(result.status, 1)
    assert.equal(result.stdout, '')
    assert.equal(result.stderr, expectedError)
  })
}

test('does not expose unrelated environment secrets on failure', async () => {
  const secret = 'unique-secret-that-must-not-be-printed'
  const result = await runCheck({
    production: `VITE_USE_MOCK=true\nUNRELATED_SECRET=${secret}\n`,
  })
  assert.equal(result.status, 1)
  assert.equal(result.stdout, '')
  assert.equal(result.stderr, expectedError)
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, new RegExp(secret))
})

test('a rejecting process override wins over a safe env file', async () => {
  const result = await runCheck({ production: 'VITE_USE_MOCK=false\n', override: 'true' })
  assert.equal(result.status, 1)
  assert.equal(result.stdout, '')
  assert.equal(result.stderr, expectedError)
})
