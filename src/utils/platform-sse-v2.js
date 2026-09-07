const textDecoder = () => new TextDecoder('utf-8', { fatal: true })

const codes = {
  invalidInput: 'SSE_V2_INVALID_INPUT',
  framing: 'SSE_V2_FRAMING_ERROR',
  invalidJson: 'SSE_V2_INVALID_JSON',
  protocol: 'SSE_V2_PROTOCOL_ERROR',
  sequence: 'SSE_V2_SEQUENCE_ERROR',
  duplicate: 'SSE_V2_CONFLICTING_DUPLICATE',
  afterTerminal: 'SSE_V2_EVENT_AFTER_TERMINAL',
  legacyDone: 'SSE_V2_LEGACY_DONE',
  eof: 'SSE_V2_EOF_WITHOUT_TERMINAL',
  callback: 'SSE_V2_CALLBACK_FAILURE',
  limit: 'SSE_V2_LIMIT_EXCEEDED',
}
const stableModelCodes = new Set(['gateway_upstream_error', 'invalid_request', 'rate_limited', 'cancelled', 'timeout', 'internal_error', 'upstream_error'])

const safeError = (code) => Object.freeze({ code })
const canonical = value => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
  return JSON.stringify(value)
}
const freezeDeep = value => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freezeDeep)
    Object.freeze(value)
  }
  return value
}

export function createPlatformSSEv2Parser({ generationId, models, onEvent = () => {}, onError = () => {}, maxBufferBytes = 1024 * 1024, maxEventBytes = 1024 * 1024, maxAcceptedEvents = 100000, maxSeq = 1000000 } = {}) {
  const expectedModels = Array.isArray(models) ? models.map(String) : []
  const decoder = textDecoder()
  let buffer = ''
  let currentEvent = ''
  let dataLines = []
  let metaSeen = false
  let terminal = false
  let failed = false
  let finished = false
  let errorSent = false
  let globalDone = false
  let inputStarted = false
  const modelState = new Map()
  const accepted = new Map()
  const byteLength = value => new TextEncoder().encode(value).byteLength
  const accept = (key, value) => { if (accepted.size >= maxAcceptedEvents) { notifyError(codes.limit); return false }; accepted.set(key, value); return true }

  const notifyError = code => {
    if (errorSent) return
    errorSent = true
    failed = true
    terminal = true
    buffer = ''
    dataLines = []
    currentEvent = ''
    accepted.clear()
    modelState.clear()
    try { onError(safeError(code)) } catch { /* callbacks are untrusted */ }
  }
  const callback = event => {
    try { onEvent(freezeDeep(event)) } catch { notifyError(codes.callback) }
  }
  const protocolError = code => notifyError(code)
  const parseData = (eventName, data) => {
    if (data === '[DONE]') return protocolError(codes.legacyDone)
    if (!['meta', 'delta', 'model_done', 'model_error', 'done', 'error'].includes(eventName)) {
      if (terminal) return protocolError(codes.afterTerminal)
      return callback({ type: 'diagnostic', category: 'unknown_event' })
    }
    let payload
    try { payload = JSON.parse(data) } catch { return protocolError(codes.invalidJson) }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return protocolError(codes.protocol)
    let key
    try { key = `${eventName}:${canonical(payload)}` } catch { return protocolError(codes.protocol) }
    const duplicateKey = `${eventName}:${payload.model ?? ''}:${payload.seq ?? payload.last_seq ?? ''}`
    if (eventName === 'meta' && metaSeen) return protocolError(codes.protocol)
    if (terminal && globalDone && eventName === 'done' && accepted.get(duplicateKey) === key) return
    if (terminal) return protocolError(codes.afterTerminal)
    if (eventName === 'delta' && modelState.get(payload.model)?.terminal) return protocolError(codes.afterTerminal)
    if (accepted.has(duplicateKey)) {
      if (accepted.get(duplicateKey) === key) return
      return protocolError(codes.duplicate)
    }
    if (terminal) return protocolError(codes.afterTerminal)
    if (!metaSeen && eventName !== 'meta') return protocolError(codes.protocol)
    if (eventName === 'meta') {
      if (metaSeen || payload.schema !== 'platform-chat-sse.v2' || payload.generation_id !== generationId || typeof payload.conversation_guid !== 'string' || !payload.conversation_guid.trim() || !Array.isArray(payload.models) || payload.models.length !== expectedModels.length || payload.models.some((m, i) => m !== expectedModels[i]) || Object.keys(payload).some(key => !['schema', 'generation_id', 'conversation_guid', 'models'].includes(key))) return protocolError(codes.protocol)
      metaSeen = true
      expectedModels.forEach(model => modelState.set(model, { next: 1, terminal: false }))
      if (!accept(duplicateKey, key)) return
      return callback({ type: 'meta', schema: payload.schema, generation_id: payload.generation_id, conversation_guid: payload.conversation_guid, models: [...payload.models] })
    }
    if (payload.generation_id !== generationId) return protocolError(codes.protocol)
    if (eventName === 'delta') {
      const state = modelState.get(payload.model)
      if (!state || state.terminal || typeof payload.delta !== 'string' || payload.delta.length === 0 || !Number.isSafeInteger(payload.seq) || payload.seq > maxSeq || payload.seq !== state.next) return protocolError(codes.sequence)
      state.next += 1
      if (!accept(duplicateKey, key)) return
      return callback({ type: 'delta', model: payload.model, seq: payload.seq, delta: payload.delta })
    }
    if (eventName === 'model_done' || eventName === 'model_error') {
      const state = modelState.get(payload.model)
      if (!state || state.terminal) return protocolError(codes.protocol)
      if (eventName === 'model_done' && (!Number.isSafeInteger(payload.last_seq) || payload.last_seq > maxSeq || payload.last_seq !== state.next - 1)) return protocolError(codes.sequence)
      state.terminal = true
      state.status = eventName === 'model_done' ? 'completed' : 'failed'
      state.code = eventName === 'model_error' && stableModelCodes.has(payload.code) ? payload.code : 'upstream_error'
      if (!accept(duplicateKey, key)) return
      return callback({ type: eventName, model: payload.model, ...(eventName === 'model_done' ? { last_seq: payload.last_seq } : { code: state.code }) })
    }
    if (eventName === 'done') {
      const allowed = expectedModels.length === 1 ? ['generation_id', 'status', 'conversation_guid', 'tokens', 'total_tokens_used'] : ['generation_id', 'status', 'conversation_guid', 'total_tokens_used', 'models']
      if (Object.keys(payload).some(key => !allowed.includes(key)) || payload.generation_id !== generationId || payload.status !== 'completed' || typeof payload.conversation_guid !== 'string' || !payload.conversation_guid.trim() || !Number.isSafeInteger(payload.total_tokens_used) || payload.total_tokens_used < 0 || (expectedModels.length === 1 && (!Number.isSafeInteger(payload.tokens) || payload.tokens < 0)) || expectedModels.some(model => !modelState.get(model)?.terminal) || (expectedModels.length === 1 && modelState.get(expectedModels[0]).status !== 'completed')) return protocolError(codes.protocol)
      if (expectedModels.length > 1) {
        if (!payload.models || typeof payload.models !== 'object' || Array.isArray(payload.models) || Object.keys(payload.models).length !== expectedModels.length || expectedModels.some(model => !Object.prototype.hasOwnProperty.call(payload.models, model))) return protocolError(codes.protocol)
        for (const model of expectedModels) {
          const item = payload.models[model]
          const state = modelState.get(model)
          if (!item || item.status !== state.status || (state.status === 'completed' && (!Number.isSafeInteger(item.tokens) || item.tokens < 0 || Object.keys(item).some(key => !['status', 'tokens'].includes(key)))) || (state.status === 'failed' && (item.code !== state.code || Object.keys(item).some(key => !['status', 'code'].includes(key))))) return protocolError(codes.protocol)
        }
      } else if (payload.models !== undefined) return protocolError(codes.protocol)
      globalDone = true
      terminal = true
      if (!accept(duplicateKey, key)) return
      const sanitized = { type: 'done', generation_id: payload.generation_id, status: payload.status, conversation_guid: payload.conversation_guid, total_tokens_used: payload.total_tokens_used }
      if (expectedModels.length === 1) sanitized.tokens = payload.tokens
      else sanitized.models = payload.models
      return callback(sanitized)
    }
    if (eventName === 'error') {
      if (typeof payload.code !== 'string') return protocolError(codes.protocol)
      if (!accept(duplicateKey, key)) return
      return notifyError('SSE_V2_REMOTE_ERROR')
    }
    if (!accept(duplicateKey, key)) return
  }
  const dispatch = () => {
    while (!failed) {
      const match = buffer.match(/\r\n\r\n|\n\n|\r\r/)
      if (!match) break
      const raw = buffer.slice(0, match.index)
      buffer = buffer.slice(match.index + match[0].length)
      if (byteLength(raw) > maxEventBytes) { notifyError(codes.limit); break }
      currentEvent = ''
      dataLines = []
      for (const line of raw.split(/\r\n|\n|\r/)) {
        if (line.startsWith(':')) continue
        if (line.startsWith('event:')) currentEvent = line.slice(6).trim()
        else if (line.startsWith('data:')) dataLines.push(line.slice(5).startsWith(' ') ? line.slice(6) : line.slice(5))
      }
      if (dataLines.length || currentEvent) parseData(currentEvent || 'message', dataLines.join('\n'))
    }
  }
  return {
    push(input) {
      if (finished || failed) return
      if (!(typeof input === 'string' || input instanceof Uint8Array)) return notifyError(codes.invalidInput)
      try {
        if (typeof input === 'string') {
          const value = !inputStarted && input.startsWith('\ufeff') ? input.slice(1) : input
          buffer += value
        } else buffer += decoder.decode(input, { stream: true })
        inputStarted = true
      } catch { return notifyError(codes.framing) }
      dispatch()
      if (!failed && byteLength(buffer) > maxBufferBytes) return notifyError(codes.limit)
    },
    finish() {
      if (finished) return
      finished = true
      if (failed) return
      try { buffer += decoder.decode() } catch { return notifyError(codes.framing) }
      dispatch()
      if (failed) return
      if (buffer.trim() !== '') return notifyError(codes.framing)
      if (!globalDone) notifyError(codes.eof)
    },
  }
}

export const PLATFORM_SSE_V2_ERROR_CODES = Object.freeze({ ...codes, remote: 'SSE_V2_REMOTE_ERROR' })
