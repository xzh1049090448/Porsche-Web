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
    [{ status: 'cancelling', phase: 'confirming_cancel' }, 'confirming_cancel'],
    [{ status: 'completed', phase: 'completed' }, 'completed'],
    [{ status: 'failed', phase: 'failed' }, 'failed'],
    [{ status: 'cancelled', phase: 'cancelled' }, 'cancelled'],
  ]
  for (const [state, expected] of cases) assert.equal(ui.generationLifecycleStatus(state), expected)
})

test('only active lifecycle states can request authoritative cancellation', () => {
  assert.equal(typeof ui.canCancelGeneration, 'function')
  for (const status of ['waiting', 'receiving', 'disconnected', 'recovering']) {
    assert.equal(ui.canCancelGeneration({ status }), true, status)
  }
  for (const status of ['draining', 'cancelling', 'confirming_cancel', 'completed', 'failed', 'cancelled']) {
    assert.equal(ui.canCancelGeneration({ status }), false, status)
  }
})

test('first-byte retry requires the owned terminal empty attempt and rejects partial or stale attempts', () => {
  assert.equal(typeof ui.canRetryGenerationMessage, 'function')
  const message = { role: 'assistant', content: '', generationStatus: 'failed', transientAttempt: 'attempt-1' }
  const state = { generationId: 'attempt-1', status: 'failed', models: [{ receivedText: '', displayedText: '' }] }
  assert.equal(ui.canRetryGenerationMessage(message, state, true), true)
  assert.equal(ui.canRetryGenerationMessage({ ...message, generationStatus: 'cancelled' }, { ...state, status: 'cancelled' }, true), true)
  assert.equal(ui.canRetryGenerationMessage({ ...message, content: 'partial' }, state, true), false)
  assert.equal(ui.canRetryGenerationMessage(message, { ...state, generationId: 'stale' }, true), false)
  assert.equal(ui.canRetryGenerationMessage(message, state, false), false)
  assert.equal(ui.canRetryGenerationMessage({ ...message, multiModel: true, models: ['a', 'b'], replies: { a: '', b: '' } }, { ...state, models: [{ receivedText: '', displayedText: '' }, { receivedText: '', displayedText: '' }] }, true), true)
  assert.equal(ui.canRetryGenerationMessage({ ...message, multiModel: true, models: ['a', 'b'], replies: { a: 'partial', b: '' } }, state, true), false)
})

test('validates single and compare cardinality, uniqueness, and preserves order', () => {
  assert.equal(typeof ui.validateGenerationSelection, 'function')
  const catalog = ['a', 'b', 'c', 'd'].map(id => ({ id }))
  const single = { modelsLoaded: true, models: catalog, compareMode: false, selectedModelId: 'a', compareModelIds: [] }
  assert.deepEqual(ui.validateGenerationSelection(single), { valid: true, code: null, models: ['a'] })
  assert.equal(ui.validateGenerationSelection({ ...single, selectedModelId: '' }).code, 'single')
  assert.equal(ui.validateGenerationSelection({ ...single, selectedModelId: ' a' }).code, 'invalid_model')
  assert.equal(ui.validateGenerationSelection({ ...single, selectedModelId: 'unknown' }).code, 'invalid_model')
  assert.equal(ui.validateGenerationSelection({ ...single, selectedModelId: new String('a') }).code, 'invalid_model')
  assert.equal(ui.validateGenerationSelection({ ...single, modelsLoaded: false }).code, 'catalog')
  assert.deepEqual(ui.validateGenerationSelection({ ...single, compareMode: true, compareModelIds: ['c', 'a'] }), { valid: true, code: null, models: ['c', 'a'] })
  assert.deepEqual(ui.validateGenerationSelection({ ...single, compareMode: true, compareModelIds: ['c', 'a', 'b'] }).models, ['c', 'a', 'b'])
  assert.equal(ui.validateGenerationSelection({ ...single, compareMode: true, compareModelIds: ['a'] }).code, 'compare_cardinality')
  assert.equal(ui.validateGenerationSelection({ ...single, compareMode: true, compareModelIds: ['a', 'b', 'c', 'd'] }).code, 'compare_cardinality')
  assert.equal(ui.validateGenerationSelection({ ...single, compareMode: true, compareModelIds: ['a', 'a'] }).code, 'compare_duplicate')
  assert.equal(ui.validateGenerationSelection({ ...single, compareMode: true, compareModelIds: ['a', ' unknown'] }).code, 'invalid_model')
})

test('copy is available only after the whole attempt reaches an authoritative terminal state', () => {
  assert.equal(typeof ui.canCopyGenerationMessage, 'function')
  for (const status of ['waiting', 'receiving', 'draining', 'disconnected', 'recovering', 'cancelling']) {
    assert.equal(ui.canCopyGenerationMessage({ role: 'assistant', content: 'partial', generationStatus: status }), false, status)
  }
  for (const status of ['completed', 'failed', 'cancelled']) {
    assert.equal(ui.canCopyGenerationMessage({ role: 'assistant', content: 'visible', generationStatus: status, viewOnly: status !== 'completed' }), true, status)
  }
  assert.equal(ui.canCopyGenerationMessage({ role: 'assistant', content: 'history' }), true)
  assert.equal(ui.canCopyGenerationMessage({ role: 'assistant', content: '' }), false)
  assert.equal(ui.canCopyGenerationMessage({ role: 'assistant', content: 'partial', transientAttempt: 'id' }), false)
})

test('maps only stable error codes and keeps partial replies separate from errors', () => {
  assert.equal(typeof ui.generationErrorMessageKey, 'function')
  assert.equal(ui.generationErrorMessageKey('timeout'), 'chat.generationErrors.timeout')
  assert.equal(ui.generationErrorMessageKey('/internal/path?token=secret'), 'chat.generationErrors.requestFailed')
  const presentation = ui.modelReplyPresentation?.({
    replies: { a: 'partial answer' },
    modelStates: { a: { status: 'failed', code: 'gateway_upstream_error' } },
    viewOnly: false,
  }, 'a')
  assert.deepEqual(presentation, {
    content: 'partial answer', status: 'failed', errorKey: 'chat.generationErrors.upstream', viewOnly: true,
  })
  assert.equal(presentation.content.includes('error'), false)
  assert.equal(ui.modelReplyPresentation({ replies: { a: 'saved history' } }, 'a').status, 'completed')
})
