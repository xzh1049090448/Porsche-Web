import test from 'node:test'
import assert from 'node:assert/strict'
import { createStreamScope } from './stream-scope.js'
import { createAuthSessionManager } from './auth-session.js'
import { browserFixture } from './auth-test-browser.js'

test('real and mock stream callbacks stop after user cancel or identity invalidation', () => {
  for (const invalidate of [false, true]) {
    const auth = createAuthSessionManager({ browser: browserFixture() }); auth.setSession({ accessToken: 'a', user: { guid: '1' } })
    const cancel = new AbortController(); const events = []
    const scope = createStreamScope(auth, { signal: cancel.signal, onChunk: v => events.push(v), onDone: () => events.push('done') })
    scope.callbacks.onChunk('first')
    if (invalidate) auth.clearSession(); else cancel.abort()
    scope.callbacks.onChunk('late'); scope.callbacks.onDone({})
    assert.deepEqual(events, ['first']); assert.equal(scope.signal.aborted, true); scope.cleanup()
  }
})
