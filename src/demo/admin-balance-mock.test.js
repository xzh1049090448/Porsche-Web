import test from 'node:test'
import assert from 'node:assert/strict'
import {
  MAX_MOCK_BALANCE_CENTS,
  createAdminBalanceMockFixture,
  formatCnyCents,
  parseCnyToCents,
  previewMockBalance,
} from './admin-balance-mock.js'

test('CNY parser uses integer cents and rejects signs, exponent, excess precision, and the demo limit', () => {
  assert.equal(parseCnyToCents('0'), 0)
  assert.equal(parseCnyToCents('12.3'), 1230)
  assert.equal(parseCnyToCents('999999999.99'), MAX_MOCK_BALANCE_CENTS)
  for (const value of ['', ' 1', '1 ', '+1', '-1', '1.001', '.1', '1.', '1e2', '999999999.999', '1000000000']) {
    assert.throws(() => parseCnyToCents(value), error => error?.code === 'invalid_amount')
  }
  assert.equal(formatCnyCents(123000), '1,230.00')
})

test('add, deduct, and replace previews preserve cents, allow replace zero, and reject invalid results', () => {
  assert.equal(previewMockBalance({ balanceCents: 1000, mode: 'add', amount: '0.01' }), 1001)
  assert.equal(previewMockBalance({ balanceCents: 1000, mode: 'deduct', amount: '10' }), 0)
  assert.equal(previewMockBalance({ balanceCents: 1000, mode: 'replace', amount: '0' }), 0)
  assert.throws(() => previewMockBalance({ balanceCents: 1000, mode: 'add', amount: '0' }), error => error?.code === 'positive_amount_required')
  assert.throws(() => previewMockBalance({ balanceCents: 1000, mode: 'deduct', amount: '10.01' }), error => error?.code === 'insufficient_mock_balance')
  assert.throws(() => previewMockBalance({ balanceCents: MAX_MOCK_BALANCE_CENTS, mode: 'add', amount: '0.01' }), error => error?.code === 'mock_balance_limit_exceeded')
})

test('successful adjustment changes only the mock fixture and records before and after with a Mock marker', async () => {
  const fixture = createAdminBalanceMockFixture({ delay: async () => {}, now: () => '2026-09-10T00:00:00.000Z' })
  const result = await fixture.adjust({ requestKey: 'mock-request-0001', mode: 'add', amount: '2.50', reason: '演示增加', scenario: 'success' })
  assert.equal(result.beforeCents, 125000)
  assert.equal(result.afterCents, 125250)
  assert.equal(result.record.mock, true)
  assert.equal(result.record.operator, 'Mock Root')
  assert.deepEqual(fixture.snapshot(), {
    user: { guid: 'mock-user-cny-001', username: 'mock_balance_user', synthetic: true },
    currency: 'CNY', balanceCents: 125250, usedCents: 28640,
    records: [result.record],
  })
})

test('failure, timeout, and conflict scenarios leave the fixture byte-equivalent', async () => {
  for (const scenario of ['failure', 'timeout', 'conflict']) {
    const fixture = createAdminBalanceMockFixture({ delay: async () => {} })
    const before = JSON.stringify(fixture.snapshot())
    await assert.rejects(
      fixture.adjust({ requestKey: `mock-${scenario}-0001`, mode: 'deduct', amount: '1', reason: '模拟异常', scenario }),
      error => error?.code === `mock_${scenario}`,
    )
    assert.equal(JSON.stringify(fixture.snapshot()), before)
  }
})

test('same request key singleflights and completed replay cannot apply the balance twice', async () => {
  let release
  const pending = new Promise(resolve => { release = resolve })
  const fixture = createAdminBalanceMockFixture({ delay: () => pending })
  const input = { requestKey: 'mock-duplicate-0001', mode: 'add', amount: '1', reason: '重复提交', scenario: 'success' }
  const first = fixture.adjust(input)
  const duplicate = fixture.adjust({ ...input })
  assert.equal(first, duplicate)
  release()
  const result = await first
  const replay = await fixture.adjust({ ...input })
  assert.equal(replay.afterCents, result.afterCents)
  assert.equal(fixture.snapshot().balanceCents, 125100)
  assert.equal(fixture.snapshot().records.length, 1)
  await assert.rejects(fixture.adjust({ ...input, amount: '2' }), error => error?.code === 'mock_request_conflict')

  const zeroFixture = createAdminBalanceMockFixture({ delay: async () => {} })
  const fullDeduction = { requestKey: 'mock-deduct-all-0001', mode: 'deduct', amount: '1250', reason: '扣减至零', scenario: 'success' }
  await zeroFixture.adjust(fullDeduction)
  assert.equal((await zeroFixture.adjust({ ...fullDeduction })).afterCents, 0)
  assert.equal(zeroFixture.snapshot().records.length, 1)
})
