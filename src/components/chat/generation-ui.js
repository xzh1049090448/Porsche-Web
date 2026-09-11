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

export function validateGenerationSelection({ compareMode, selectedModelId, compareModelIds = [] } = {}) {
  if (!compareMode) {
    const valid = typeof selectedModelId === 'string' && selectedModelId.trim().length > 0
    return { valid, code: valid ? null : 'single', models: valid ? [selectedModelId] : [] }
  }
  const models = Array.isArray(compareModelIds) ? [...compareModelIds] : []
  if (models.length < 2 || models.length > 3 || models.some(model => typeof model !== 'string' || !model.trim())) {
    return { valid: false, code: 'compare_cardinality', models }
  }
  if (new Set(models).size !== models.length) return { valid: false, code: 'compare_duplicate', models }
  return { valid: true, code: null, models }
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
