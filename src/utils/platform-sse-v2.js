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
}

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

export function createPlatformSSEv2Parser({ generationId, models, onEvent = () => {}, onError = () => {} } = {}) {
  const expectedModels = Array.isArray(models) ? models.map(String) : []
  const modelSet = new Set(expectedModels)
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
  const modelState = new Map()
  const accepted = new Map()

  const notifyError = code => {
    if (errorSent) return
    errorSent = true
    failed = true
    terminal = true
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
    const key = `${eventName}:${canonical(payload)}`
    const duplicateKey = `${eventName}:${payload.model ?? ''}:${payload.seq ?? payload.last_seq ?? ''}`
    if (eventName === 'meta' && metaSeen) return protocolError(codes.protocol)
    if (terminal && eventName === 'done') return protocolError(codes.afterTerminal)
    if (accepted.has(duplicateKey)) {
      if (accepted.get(duplicateKey) === key) return
      return protocolError(codes.duplicate)
    }
    if (terminal) return protocolError(codes.afterTerminal)
    if (!metaSeen && eventName !== 'meta') return protocolError(codes.protocol)
    if (eventName === 'meta') {
      if (metaSeen || payload.schema !== 'platform-chat-sse.v2' || payload.generation_id !== generationId || !Array.isArray(payload.models) || payload.models.length !== expectedModels.length || payload.models.some((m, i) => m !== expectedModels[i])) return protocolError(codes.protocol)
      metaSeen = true
      expectedModels.forEach(model => modelState.set(model, { next: 1, terminal: false }))
      accepted.set(duplicateKey, key)
      return callback({ type: 'meta', ...payload })
    }
    if (payload.generation_id !== generationId) return protocolError(codes.protocol)
    if (eventName === 'delta') {
      const state = modelState.get(payload.model)
      if (!state || state.terminal || typeof payload.delta !== 'string' || payload.delta.length === 0 || !Number.isSafeInteger(payload.seq) || payload.seq !== state.next) return protocolError(codes.sequence)
      state.next += 1
      accepted.set(duplicateKey, key)
      return callback({ type: 'delta', model: payload.model, seq: payload.seq, delta: payload.delta })
    }
    if (eventName === 'model_done' || eventName === 'model_error') {
      const state = modelState.get(payload.model)
      if (!state || state.terminal) return protocolError(codes.protocol)
      if (eventName === 'model_done' && payload.last_seq !== state.next - 1) return protocolError(codes.sequence)
      state.terminal = true
      accepted.set(duplicateKey, key)
      return callback({ type: eventName, model: payload.model, ...(eventName === 'model_done' ? { last_seq: payload.last_seq } : { code: typeof payload.code === 'string' ? payload.code : 'model_error' }) })
    }
    if (eventName === 'done') {
      if (payload.status !== 'completed' || (expectedModels.length > 1 && (!payload.models || typeof payload.models !== 'object'))) return protocolError(codes.protocol)
      if (expectedModels.length > 1 && expectedModels.some(model => !modelState.get(model)?.terminal || !payload.models[model])) return protocolError(codes.protocol)
      globalDone = true
      terminal = true
      accepted.set(duplicateKey, key)
      return callback({ type: 'done', ...payload })
    }
    if (eventName === 'error') {
      if (typeof payload.code !== 'string') return protocolError(codes.protocol)
      accepted.set(duplicateKey, key)
      return notifyError('SSE_V2_REMOTE_ERROR')
    }
    accepted.set(duplicateKey, key)
  }
  const dispatch = () => {
    while (!failed) {
      const match = buffer.match(/\r\n\r\n|\n\n|\r\r/)
      if (!match) break
      const raw = buffer.slice(0, match.index)
      buffer = buffer.slice(match.index + match[0].length)
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
      if (finished || terminal || failed) { if (terminal && !failed && input != null) notifyError(codes.afterTerminal); return }
      if (!(typeof input === 'string' || input instanceof Uint8Array)) return notifyError(codes.invalidInput)
      try { buffer += typeof input === 'string' ? input : decoder.decode(input, { stream: true }) } catch { return notifyError(codes.framing) }
      dispatch()
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
