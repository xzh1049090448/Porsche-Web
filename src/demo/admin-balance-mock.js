export const ADMIN_BALANCE_MOCK_MARKER = 'A09_BALANCE_MOCK_DEMO_ONLY'
export const MAX_MOCK_BALANCE_CENTS = 99_999_999_999

const modes = new Set(['add', 'deduct', 'replace'])
const scenarios = new Set(['success', 'failure', 'timeout', 'conflict'])
const syntheticUser = Object.freeze({ guid: 'mock-user-cny-001', username: 'mock_balance_user', synthetic: true })

const fail = code => Object.assign(new Error(code), { code })

export function parseCnyToCents(value) {
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d{0,8})(?:\.\d{1,2})?$/.test(value)) throw fail('invalid_amount')
  const [whole, fraction = ''] = value.split('.')
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
  if (!Number.isSafeInteger(cents) || cents > MAX_MOCK_BALANCE_CENTS) throw fail('invalid_amount')
  return cents
}

export function formatCnyCents(cents) {
  if (!Number.isSafeInteger(cents) || cents < 0 || cents > MAX_MOCK_BALANCE_CENTS) throw fail('invalid_amount')
  return new Intl.NumberFormat('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(cents / 100)
}

export function previewMockBalance({ balanceCents, mode, amount }) {
  if (!Number.isSafeInteger(balanceCents) || balanceCents < 0 || balanceCents > MAX_MOCK_BALANCE_CENTS || !modes.has(mode)) throw fail('invalid_adjustment')
  const amountCents = parseCnyToCents(amount)
  if (mode !== 'replace' && amountCents === 0) throw fail('positive_amount_required')
  const afterCents = mode === 'add' ? balanceCents + amountCents : mode === 'deduct' ? balanceCents - amountCents : amountCents
  if (afterCents < 0) throw fail('insufficient_mock_balance')
  if (afterCents > MAX_MOCK_BALANCE_CENTS) throw fail('mock_balance_limit_exceeded')
  return afterCents
}

function normalizeInput(input) {
  if (!input || typeof input.requestKey !== 'string' || !/^[a-z0-9-]{8,64}$/.test(input.requestKey)) throw fail('invalid_mock_request')
  if (!modes.has(input.mode) || !scenarios.has(input.scenario)) throw fail('invalid_mock_request')
  const reason = typeof input.reason === 'string' ? input.reason.trim() : ''
  if (!reason || [...reason].length > 200) throw fail('invalid_reason')
  const normalized = Object.freeze({ requestKey: input.requestKey, mode: input.mode, amount: input.amount, reason, scenario: input.scenario })
  return { normalized, signature: JSON.stringify(normalized) }
}

export function createAdminBalanceMockFixture({ delay = () => new Promise(resolve => setTimeout(resolve, 350)), now = () => new Date().toISOString() } = {}) {
  let balanceCents = 125_000
  const usedCents = 28_640
  let records = []
  let sequence = 0
  const active = new Map()
  const completed = new Map()

  const snapshot = () => ({ user: { ...syntheticUser }, currency: 'CNY', balanceCents, usedCents, records: records.map(record => ({ ...record })) })

  const adjust = input => {
    const prepared = normalizeInput(input)
    const prior = completed.get(prepared.normalized.requestKey)
    if (prior) {
      if (prior.signature !== prepared.signature) return Promise.reject(fail('mock_request_conflict'))
      return Promise.resolve({ ...prior.result, record: { ...prior.result.record } })
    }
    const current = active.get(prepared.normalized.requestKey)
    if (current) {
      if (current.signature !== prepared.signature) return Promise.reject(fail('mock_request_conflict'))
      return current.promise
    }
    const beforeCents = balanceCents
    const afterCents = previewMockBalance({ balanceCents, mode: prepared.normalized.mode, amount: prepared.normalized.amount })
    const run = { signature: prepared.signature, promise: null }
    run.promise = Promise.resolve().then(delay).then(() => {
      if (prepared.normalized.scenario !== 'success') throw fail(`mock_${prepared.normalized.scenario}`)
      if (balanceCents !== beforeCents) throw fail('mock_conflict')
      balanceCents = afterCents
      const record = Object.freeze({
        id: `mock-adjust-${++sequence}`,
        mock: true,
        mode: prepared.normalized.mode,
        operator: 'Mock Root',
        reason: prepared.normalized.reason,
        beforeCents,
        afterCents: balanceCents,
        createdAt: now(),
      })
      records = [record, ...records]
      const result = Object.freeze({ beforeCents, afterCents: balanceCents, record })
      completed.set(prepared.normalized.requestKey, { signature: prepared.signature, result })
      return result
    }).finally(() => active.delete(prepared.normalized.requestKey))
    active.set(prepared.normalized.requestKey, run)
    return run.promise
  }

  return Object.freeze({ snapshot, adjust })
}
