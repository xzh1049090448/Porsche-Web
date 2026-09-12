const ACTIVE_STATUSES = new Set(['waiting', 'receiving', 'draining', 'disconnected', 'recovering'])
const LIFECYCLE_STATUSES = new Set([...ACTIVE_STATUSES, 'cancelling', 'completed', 'failed', 'cancelled'])
const STABLE_ERROR_KEYS = Object.freeze({
  cancelled: 'cancelled',
  gateway_upstream_error: 'upstream',
  internal_error: 'requestFailed',
  invalid_request: 'invalidRequest',
  rate_limited: 'rateLimited',
  timeout: 'timeout',
  upstream_error: 'upstream',
})

export function generationLifecycleStatus(state) {
  if (!state || typeof state !== 'object') return null
  const phase = state.phase
  if (phase === 'starting') return 'waiting'
  if (phase === 'streaming' && (state.status === 'receiving' || state.status === 'draining')) return state.status
  if (LIFECYCLE_STATUSES.has(phase)) return phase
  return LIFECYCLE_STATUSES.has(state.status) ? state.status : null
}

export function canCancelGeneration(state) {
  return ACTIVE_STATUSES.has(generationLifecycleStatus(state))
}

export function validateGenerationSelection(options = {}) {
  const { compareMode, selectedModelId, compareModelIds = [] } = options
  const source = options
  if (source?.modelsLoaded !== true || !Array.isArray(source.models)) return { valid: false, code: 'catalog', models: [] }
  const catalogIds = new Set(source.models.flatMap(model => typeof model?.id === 'string' && model.id === model.id.trim() && model.id ? [model.id] : []))
  const validModel = model => typeof model === 'string' && model.length > 0 && model === model.trim() && catalogIds.has(model)
  if (!compareMode) {
    if (selectedModelId === '') return { valid: false, code: 'single', models: [] }
    const valid = validModel(selectedModelId)
    return { valid, code: valid ? null : 'invalid_model', models: valid ? [selectedModelId] : [] }
  }
  const models = Array.isArray(compareModelIds) ? [...compareModelIds] : []
  if (models.length < 2 || models.length > 3) {
    return { valid: false, code: 'compare_cardinality', models }
  }
  if (new Set(models).size !== models.length) return { valid: false, code: 'compare_duplicate', models }
  if (models.some(model => !validModel(model))) return { valid: false, code: 'invalid_model', models }
  return { valid: true, code: null, models }
}

export function canCopyGenerationMessage(message, content = message?.content) {
  if (message?.role !== 'assistant' || typeof content !== 'string' || !content) return false
  if (['completed', 'failed', 'cancelled'].includes(message.generationStatus)) return true
  return !message.generationStatus && !message.transientAttempt
}

export function generationErrorMessageKey(code) {
  return `chat.generationErrors.${STABLE_ERROR_KEYS[code] || 'requestFailed'}`
}

export function modelReplyPresentation(message, modelId) {
  const state = message?.modelStates?.[modelId]
  const content = typeof message?.replies?.[modelId] === 'string' ? message.replies[modelId] : ''
  const status = typeof state?.status === 'string'
    ? state.status
    : (!message?.transientAttempt && message?.viewOnly !== true && content ? 'completed' : 'waiting')
  return {
    content,
    status,
    errorKey: status === 'failed' ? generationErrorMessageKey(state?.code) : null,
    viewOnly: message?.viewOnly === true,
  }
}
