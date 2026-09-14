import test from 'node:test'
import assert from 'node:assert/strict'
import { createBrowserAuthAdapter } from './auth-browser.js'
import { createAuthSessionManager } from './auth-session.js'
import { authErrorMessage } from './auth-errors.js'

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }

function environment() {
  const entries = new Map([['llm_platform_token', 'old'], ['llm_platform_user', 'old'], ['llm_platform_theme', 'dark'], ['llm_platform_locale', 'en']])
  const messages = []; const locks = []; const channels = []
  const activeLocks = new Set(); const lockQueues = new Map()
  const storageFailures = { get: false, set: false, remove: false }
  const channelFailures = { construct: false, listen: false }
  const runLock = async (name, fn) => {
    activeLocks.add(name)
    try { return await fn({ name }) }
    finally {
      activeLocks.delete(name)
      lockQueues.get(name)?.shift()?.()
    }
  }
  const requestLock = (name, options, fn) => {
    locks.push([name, options])
    if (options.ifAvailable) return activeLocks.has(name) ? fn(null) : runLock(name, fn)
    return new Promise((resolve, reject) => {
      const run = () => runLock(name, fn).then(resolve, reject)
      if (activeLocks.has(name)) {
        const queue = lockQueues.get(name) || []
        queue.push(run); lockQueues.set(name, queue)
      } else run()
    })
  }
  const env = { entries, messages, locks, channels, storageFailures, channelFailures, channelAttempts: 0, isSecureContext: true, crypto: { randomUUID: () => 'operation' },
    localStorage: {
      getItem: key => { if (storageFailures.get) throw Error('get denied'); return entries.get(key) },
      setItem: (key, value) => { if (storageFailures.set) throw Error('set denied'); entries.set(key, value) },
      removeItem: key => { if (storageFailures.remove) throw Error('remove denied'); entries.delete(key) },
    },
    navigator: { locks: { request: requestLock } },
    BroadcastChannel: class {
      constructor() {
        env.channelAttempts++
        if (channelFailures.construct) throw Error('constructor denied')
        this.listeners = new Set(); this.closed = false; channels.push(this)
      }
      postMessage(value) { messages.push(value) }
      addEventListener(type, listener) {
        if (channelFailures.listen) throw Error('listener denied')
        if (type === 'message') this.listeners.add(listener)
      }
      removeEventListener(type, listener) { if (type === 'message') this.listeners.delete(listener) }
      emit(data) { this.listeners.forEach(listener => listener({ data })) }
      close() { this.closed = true }
    },
  }
  return env
}
test('browser adapter cleans old credentials preserving preferences, and broadcasts only epoch', async () => {
  const env = environment(); const browser = createBrowserAuthAdapter(env)
  assert.equal(env.entries.has('llm_platform_token'), false)
  assert.equal(env.entries.get('llm_platform_theme'), 'dark')
  assert.equal(env.entries.get('llm_platform_locale'), 'en')
  browser.publish({ type: 'invalidate', epoch: 'new', accessToken: 'secret', profile: 'private', sid: 'secret' })
  assert.deepEqual(env.messages, [{ type: 'invalidate', epoch: 'new' }])
  await browser.lock(() => 1); assert.equal(env.locks[0][1].mode, 'exclusive')
})
test('recovery lock uses non-queued ownership and a busy follower waits only to inspect', async () => {
  const env = environment(); const browser = createBrowserAuthAdapter(env); const gate = deferred()
  let ownerStarted = false; let followerOwned = false; let followerInspected = false
  const owner = browser.recoveryLock(async () => { ownerStarted = true; await gate.promise; return 'owner' }, () => assert.fail('owner must not inspect'))
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(ownerStarted, true)

  const follower = browser.recoveryLock(async () => { followerOwned = true }, () => { followerInspected = true; return 'follower' })
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(followerOwned, false)
  assert.equal(followerInspected, false)
  assert.deepEqual(env.locks.map(([name, options]) => [name, options]), [
    ['porsche_auth_recovery_v1', { mode: 'exclusive', ifAvailable: true }],
    ['porsche_auth_recovery_v1', { mode: 'exclusive', ifAvailable: true }],
    ['porsche_auth_recovery_v1', { mode: 'exclusive' }],
  ])

  gate.resolve()
  assert.equal(await owner, 'owner')
  assert.equal(await follower, 'follower')
  assert.equal(followerOwned, false)
  assert.equal(followerInspected, true)
})
test('recovery lock releases active ownership when its owner throws', async () => {
  const env = environment(); const browser = createBrowserAuthAdapter(env)
  await assert.rejects(browser.recoveryLock(async () => { throw new Error('owner failed') }, () => assert.fail('owner must not inspect')), /owner failed/)
  let owned = 0
  assert.equal(await browser.recoveryLock(async () => { owned++; return 'retried' }, () => assert.fail('released lock must be available')), 'retried')
  assert.equal(owned, 1)
})
test('probe identifies each unavailable browser capability without authentication traffic', async () => {
  const cases = [
    [env => { env.isSecureContext = false }, 'auth_insecure_context'],
    [env => { env.navigator = {} }, 'auth_web_locks_unavailable'],
    [env => { env.BroadcastChannel = null }, 'auth_broadcast_channel_unavailable'],
    [env => { env.storageFailures.set = true }, 'auth_storage_unavailable'],
    [env => { env.storageFailures.get = true }, 'auth_storage_unavailable'],
    [env => { env.storageFailures.remove = true }, 'auth_storage_unavailable'],
  ]
  for (const [change, code] of cases) {
    const env = environment(); change(env)
    const browser = createBrowserAuthAdapter(env)
    const auth = createAuthSessionManager({ browser })
    let sends = 0
    await assert.rejects(auth.cookieOperation('login', async () => { sends++ }))
    assert.equal(sends, 0)
    assert.equal(auth.state(), 'uncertain')
    assert.deepEqual(browser.probe(), { available: false, code })
  }
})
test('probe recovers storage without retaining its key or duplicating the channel', () => {
  const env = environment()
  env.storageFailures.set = true
  const browser = createBrowserAuthAdapter(env)
  assert.equal(browser.available, false)
  env.storageFailures.set = false
  assert.deepEqual(browser.probe(), { available: true, code: null })
  assert.equal(browser.available, true)
  assert.equal(env.entries.has('porsche_auth_probe_v1'), false)
  assert.equal(env.channels.length, 1)
  assert.deepEqual(browser.probe(), { available: true, code: null })
  assert.equal(env.channels.length, 1)
})
test('subscription made while unavailable activates after probe and can be removed', () => {
  const env = environment()
  env.storageFailures.set = true
  const browser = createBrowserAuthAdapter(env)
  const received = []
  const unsubscribe = browser.subscribe(message => received.push(message))
  assert.doesNotThrow(() => browser.publish({ epoch: 'before', accessToken: 'secret' }))
  assert.deepEqual(env.messages, [])
  env.storageFailures.set = false
  assert.deepEqual(browser.probe(), { available: true, code: null })
  env.channels[0].emit({ type: 'invalidate', epoch: 'after' })
  assert.deepEqual(received, [{ type: 'invalidate', epoch: 'after' }])
  unsubscribe()
  env.channels[0].emit({ type: 'invalidate', epoch: 'ignored' })
  assert.deepEqual(received, [{ type: 'invalidate', epoch: 'after' }])
  browser.publish({ type: 'other', epoch: 'broadcast', accessToken: 'secret', profile: 'private', sid: 'secret' })
  assert.deepEqual(env.messages, [{ type: 'invalidate', epoch: 'broadcast' }])
})
test('BroadcastChannel constructor failure is recoverable without retaining the probe key', () => {
  const env = environment()
  env.channelFailures.construct = true
  const browser = createBrowserAuthAdapter(env)
  const received = []
  browser.subscribe(message => received.push(message))
  assert.deepEqual(browser.probe(), { available: false, code: 'auth_broadcast_channel_unavailable' })
  assert.equal(env.entries.has('porsche_auth_probe_v1'), false)
  env.channelFailures.construct = false
  assert.deepEqual(browser.probe(), { available: true, code: null })
  env.channels[0].emit({ type: 'invalidate', epoch: 'recovered' })
  assert.deepEqual(received, [{ type: 'invalidate', epoch: 'recovered' }])
})
test('BroadcastChannel listener registration failure closes temporary channel and retries', () => {
  const env = environment()
  env.channelFailures.listen = true
  const browser = createBrowserAuthAdapter(env)
  const received = []
  browser.subscribe(message => received.push(message))
  assert.deepEqual(browser.probe(), { available: false, code: 'auth_broadcast_channel_unavailable' })
  assert.equal(env.entries.has('porsche_auth_probe_v1'), false)
  assert.equal(env.channels.every(channel => channel.closed), true)
  env.channelFailures.listen = false
  assert.deepEqual(browser.probe(), { available: true, code: null })
  assert.equal(env.channels.length, 3)
  env.channels[2].emit({ type: 'invalidate', epoch: 'recovered' })
  assert.deepEqual(received, [{ type: 'invalidate', epoch: 'recovered' }])
})
test('subscriber failure does not block later subscribers', () => {
  const env = environment()
  const browser = createBrowserAuthAdapter(env)
  const received = []
  browser.subscribe(() => { throw Error('subscriber failed') })
  browser.subscribe(message => received.push(message))
  assert.doesNotThrow(() => env.channels[0].emit({ type: 'invalidate', epoch: 'next' }))
  assert.deepEqual(received, [{ type: 'invalidate', epoch: 'next' }])
})
test('error display supports nested errors and detail while ignoring HTML/text/Blob', () => {
  assert.equal(authErrorMessage({ response: { data: { error: { code: 'auth_invalid_credentials', message: '用户名或密码错误' } } } }), '用户名或密码错误')
  assert.equal(authErrorMessage({ response: { data: { detail: [{ msg: 'required' }] } } }), 'required')
  for (const data of ['<html>secret</html>', new Blob(['secret'])]) assert.doesNotMatch(authErrorMessage({ response: { data } }), /secret|html/)
})
