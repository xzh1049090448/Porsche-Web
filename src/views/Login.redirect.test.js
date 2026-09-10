import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { safeAuthRedirect } from '../utils/auth-redirect.js'

const source = readFileSync(new URL('./Login.vue', import.meta.url), 'utf8')

test('login submit uses the shared safe redirect helper with /chat default', () => {
  assert.match(source, /import \{ safeAuthRedirect \} from '@\/utils\/auth-redirect'/)
  assert.match(source, /router\.replace\(safeAuthRedirect\(route\.query\.redirect, '\/chat'\)\)/)
  assert.doesNotMatch(source, /router\.replace\(route\.query\.redirect/)
  assert.doesNotMatch(source, /route\.query\.redirect \|\| '\/'/)
})

test('login redirect behavior defaults and rejects unsafe targets while preserving safe state', () => {
  assert.equal(safeAuthRedirect(undefined, '/chat'), '/chat')
  assert.equal(safeAuthRedirect('https://evil.example', '/chat'), '/chat')
  assert.equal(safeAuthRedirect('//evil.example', '/chat'), '/chat')
  assert.equal(safeAuthRedirect('/%252f%252fevil.example', '/chat'), '/chat')
  assert.equal(safeAuthRedirect('/billing?period=month#usage', '/chat'), '/billing?period=month#usage')
})
