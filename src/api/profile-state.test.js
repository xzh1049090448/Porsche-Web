import test from 'node:test'
import assert from 'node:assert/strict'
import { createProfileState, mergeProfileDisplay } from './profile-state.js'
import { createAuthSessionManager } from './auth-session.js'
import { browserFixture } from './auth-test-browser.js'

test('profile statistics remain separate from AuthUser and profile 503 does not fail login', async () => {
  const auth = createAuthSessionManager({ browser: browserFixture() })
  auth.setSession({ accessToken: 'access', user: { guid: '1', username: 'alice' } })
  const profile = createProfileState(auth)
  await assert.rejects(profile.load(async () => { throw Error('503') }))
  assert.equal(auth.accessToken(), 'access')
  await profile.load(async () => ({ guid: '1', totalTokensUsed: 120, verified: true }))
  assert.equal(profile.value().totalTokensUsed, 120)
  assert.equal(auth.user().totalTokensUsed, undefined)
  auth.clearSession(); assert.equal(profile.value(), null)
})


test('updated profile nickname displays while authentication identity and permissions remain authoritative', () => {
  const authUser = { guid: '1', username: 'alice', nickname: 'Old', role: 1, status: 1 }
  const profile = { guid: 'other', username: 'spoofed', nickname: 'Updated', role: 100, status: 0, totalTokensUsed: 120 }
  assert.deepEqual(mergeProfileDisplay(authUser, profile), { ...authUser, nickname: 'Updated', totalTokensUsed: 120 })
  assert.equal(mergeProfileDisplay(authUser, { nickname: '' }).nickname, '')
  assert.equal(mergeProfileDisplay(authUser, { totalTokensUsed: 12 }).nickname, 'Old')
  assert.equal(mergeProfileDisplay(null, profile), null)
  assert.equal(authUser.nickname, 'Old')
})
