export function browserFixture() {
  let record = { epoch: 'initial', pending: null, suppressed: false }
  let queue = Promise.resolve()
  const messages = []
  return {
    get available() { return true },
    probe: () => ({ available: true, code: null }),
    messages,
    read: () => structuredClone(record),
    write: (next) => { record = structuredClone(next) },
    lock: (fn) => { const next = queue.then(fn); queue = next.catch(() => {}); return next },
    publish: (message) => messages.push(message),
    subscribe: () => () => {},
    id: (() => { let id = 0; return () => `operation-${++id}` })(),
  }
}
