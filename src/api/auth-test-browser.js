export function browserFixture() {
  let record = { epoch: 'initial', pending: null, suppressed: false }
  let queue = Promise.resolve()
  let recoveryActive = false
  const recoveryWaiters = []
  const messages = []
  const runRecovery = async fn => {
    recoveryActive = true
    try { return await fn() }
    finally {
      recoveryActive = false
      recoveryWaiters.shift()?.()
    }
  }
  return {
    get available() { return true },
    probe: () => ({ available: true, code: null }),
    messages,
    read: () => structuredClone(record),
    write: (next) => { record = structuredClone(next) },
    lock: (fn) => { const next = queue.then(fn); queue = next.catch(() => {}); return next },
    recoveryLock: (owner, inspect) => {
      if (!recoveryActive) return runRecovery(owner)
      return new Promise((resolve, reject) => {
        recoveryWaiters.push(() => runRecovery(inspect).then(resolve, reject))
      })
    },
    publish: (message) => messages.push(message),
    subscribe: () => () => {},
    id: (() => { let id = 0; return () => `operation-${++id}` })(),
  }
}
