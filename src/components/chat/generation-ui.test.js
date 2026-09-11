import assert from 'node:assert/strict'
import test from 'node:test'

const ui = await import('./generation-ui.js').catch(() => ({}))

test('normalizes every BE06 lifecycle state without collapsing recovery phases', () => {
  assert.equal(typeof ui.generationLifecycleStatus, 'function')
  const cases = [
    [{ status: 'waiting', phase: 'starting' }, 'waiting'],
    [{ status: 'receiving', phase: 'streaming' }, 'receiving'],
    [{ status: 'draining', phase: 'streaming' }, 'draining'],
    [{ status: 'disconnected', phase: 'disconnected' }, 'disconnected'],
    [{ status: 'recovering', phase: 'recovering' }, 'recovering'],
    [{ status: 'cancelling', phase: 'cancelling' }, 'cancelling'],
    [{ status: 'completed', phase: 'completed' }, 'completed'],
    [{ status: 'failed', phase: 'failed' }, 'failed'],
    [{ status: 'cancelled', phase: 'cancelled' }, 'cancelled'],
  ]
  for (const [state, expected] of cases) assert.equal(ui.generationLifecycleStatus(state), expected)
})

test('only active lifecycle states can request authoritative cancellation', () => {
  assert.equal(typeof ui.canCancelGeneration, 'function')
  for (const status of ['waiting', 'receiving', 'draining', 'disconnected', 'recovering']) {
    assert.equal(ui.canCancelGeneration({ status }), true, status)
  }
  for (const status of ['cancelling', 'completed', 'failed', 'cancelled']) {
    assert.equal(ui.canCancelGeneration({ status }), false, status)
  }
})

test('validates single and compare cardinality, uniqueness, and preserves order', () => {
  assert.equal(typeof ui.validateGenerationSelection, 'function')
  assert.deepEqual(ui.validateGenerationSelection({ compareMode: false, selectedModelId: 'a', compareModelIds: [] }), { valid: true, code: null, models: ['a'] })
  assert.equal(ui.validateGenerationSelection({ compareMode: false, selectedModelId: '', compareModelIds: [] }).code, 'single')
  assert.deepEqual(ui.validateGenerationSelection({ compareMode: true, selectedModelId: 'a', compareModelIds: ['c', 'a'] }), { valid: true, code: null, models: ['c', 'a'] })
  assert.deepEqual(ui.validateGenerationSelection({ compareMode: true, selectedModelId: 'a', compareModelIds: ['c', 'a', 'b'] }).models, ['c', 'a', 'b'])
  assert.equal(ui.validateGenerationSelection({ compareMode: true, compareModelIds: ['a'] }).code, 'compare_cardinality')
  assert.equal(ui.validateGenerationSelection({ compareMode: true, compareModelIds: ['a', 'b', 'c', 'd'] }).code, 'compare_cardinality')
  assert.equal(ui.validateGenerationSelection({ compareMode: true, compareModelIds: ['a', 'a'] }).code, 'compare_duplicate')
})

test('maps only stable error codes and keeps partial replies separate from errors', () => {
  assert.equal(typeof ui.generationErrorMessageKey, 'function')
  assert.equal(ui.generationErrorMessageKey('timeout'), 'chat.generationErrors.timeout')
  assert.equal(ui.generationErrorMessageKey('/internal/path?token=secret'), 'chat.generationErrors.requestFailed')
  const presentation = ui.modelReplyPresentation?.({
    replies: { a: 'partial answer' },
    modelStates: { a: { status: 'failed', code: 'gateway_upstream_error' } },
    viewOnly: true,
  }, 'a')
  assert.deepEqual(presentation, {
    content: 'partial answer', status: 'failed', errorKey: 'chat.generationErrors.upstream', viewOnly: true,
  })
  assert.equal(presentation.content.includes('error'), false)
  assert.equal(ui.modelReplyPresentation({ replies: { a: 'saved history' } }, 'a').status, 'completed')
})
