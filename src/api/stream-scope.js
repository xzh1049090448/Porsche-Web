/** Shared cancellation and epoch guard for native and mock stream callbacks. */
export function createStreamScope(auth, callbacks = {}) {
  const context = auth.capture()
  const controller = new AbortController()
  const abort = () => controller.abort()
  const unsubscribe = auth.onInvalidate(abort)
  callbacks.signal?.addEventListener('abort', abort, { once: true })
  if (callbacks.signal?.aborted) abort()
  const isCurrent = () => { try { auth.assertCurrent(context); return true } catch { return false } }
  const guarded = Object.fromEntries(Object.entries(callbacks).map(([key, value]) => [key, typeof value !== 'function' ? value : (...args) => {
    if (!controller.signal.aborted && isCurrent()) return value(...args)
  }]))
  return { signal: controller.signal, isCurrent, callbacks: guarded,
    cleanup() { unsubscribe(); callbacks.signal?.removeEventListener('abort', abort) },
  }
}
