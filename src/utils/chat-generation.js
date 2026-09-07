import { createGraphemePlayback } from './grapheme-playback.js'

const TERMINAL = new Set(['completed', 'cancelled', 'failed', 'disposed'])
const VALID_STATUSES = new Set(['waiting', 'receiving', 'cancelling', 'draining', 'completed', 'cancelled', 'failed', 'disposed'])
const STABLE_CODES = new Set(['gateway_upstream_error', 'invalid_request', 'rate_limited', 'cancelled', 'timeout', 'internal_error', 'upstream_error'])

const freeze = value => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze)
    Object.freeze(value)
  }
  return value
}
const text = (value, name) => {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${name} must be a nonblank string`)
  return value
}
const safeCode = code => typeof code === 'string' && STABLE_CODES.has(code) ? code : 'upstream_error'
const safeDiagnostic = code => typeof code === 'string' && (/^GENERATION_[A-Z0-9_]+$/.test(code) || STABLE_CODES.has(code)) ? code : 'GENERATION_ERROR'

export function createChatGeneration(options = {}) {
  const generationId = text(options.generationId, 'generationId')
  const conversationGuid = text(options.conversationGuid, 'conversationGuid')
  const messageKey = text(options.messageKey, 'messageKey')
  const mode = options.mode === 'compare' ? 'compare' : options.mode === 'single' ? 'single' : null
  if (!mode) throw new TypeError('mode must be single or compare')
  if (!Array.isArray(options.models) || options.models.length === 0 || options.models.some(model => typeof model !== 'string' || !model.trim()) || new Set(options.models).size !== options.models.length) throw new TypeError('models must contain unique nonblank strings')
  if (mode === 'single' && options.models.length !== 1) throw new TypeError('single mode requires one model')
  if (mode === 'compare' && options.models.length < 2) throw new TypeError('compare mode requires multiple models')

  const identity = freeze({ generationId, conversationGuid, messageKey, mode, models: [...options.models] })
  let status = 'waiting'
  let metaSeen = false
  let globalDone = false
  let disposed = false
  let diagnostics = []
  let change = typeof options.onChange === 'function' ? options.onChange : () => {}
  const factory = options.playbackFactory || options.createPlayback || createGraphemePlayback
  const scheduler = options.scheduler || {}
  const playbackOptions = { ...(options.playbackOptions || (options.playback && typeof options.playback === 'object' ? options.playback : {})), ...(scheduler.requestFrame ? { requestFrame: scheduler.requestFrame } : {}), ...(scheduler.cancelFrame ? { cancelFrame: scheduler.cancelFrame } : {}), ...(scheduler.now ? { now: scheduler.now } : {}) }
  const models = options.models.map(model => ({ model, receivedText: '', displayedText: '', lastSeq: 0, terminal: null, code: null, player: null, epoch: 0 }))

  const notify = () => { try { change(snapshot()) } catch {} }
  const diagnostic = (code, model) => {
    const item = { code: safeDiagnostic(code) }
    if (model) item.model = model
    diagnostics = [...diagnostics, freeze(item)].slice(-20)
    notify()
  }
  const modelFor = model => models.find(item => item.model === model)
  const playerSnapshot = item => item.player ? item.player.snapshot() : { receivedText: item.receivedText, displayedText: item.displayedText, pendingCount: 0, failed: false, disposed: false }
  const snapshot = () => freeze({
    identity,
    status,
    metaSeen,
    globalDone,
    models: models.map(item => {
      const player = playerSnapshot(item)
      return { model: item.model, receivedText: item.receivedText, displayedText: item.displayedText, pendingCount: player.pendingCount, lastSeq: item.lastSeq, terminal: item.terminal, code: item.code }
    }),
    diagnostics: [...diagnostics],
  })
  const setStatus = next => { if (VALID_STATUSES.has(next)) { status = next; notify() } }
  const allDrained = () => models.every(item => { const p = playerSnapshot(item); return p.pendingCount === 0 && (item.terminal === 'failed' || item.displayedText === item.receivedText) })
  const maybeComplete = () => { if (status === 'draining' && globalDone && allDrained()) setStatus('completed') }
  const cleanupPlayer = (item, method = 'cancel') => {
    item.epoch += 1
    const player = item.player; item.player = null
    if (!player || typeof player[method] !== 'function') return
    try { player[method]() } catch { diagnostic('GENERATION_CLEANUP_ERROR', item.model) }
  }
  const cleanupAll = method => models.forEach(item => cleanupPlayer(item, method))
  const makePlayer = (item, prefix = '') => {
    const epoch = ++item.epoch
    const active = () => !disposed && !TERMINAL.has(status) && status !== 'cancelling' && item.epoch === epoch
    const callbacks = { onDisplay: displayed => { if (!active()) return; item.displayedText = prefix + displayed; notify(); maybeComplete() }, onError: () => { if (!active()) return; item.terminal = 'failed'; item.code = 'PLAYBACK_ERROR'; fail('GENERATION_PLAYBACK_ERROR', item.model) } }
    try { item.player = factory({ ...playbackOptions, ...callbacks, model: item.model }) } catch { item.player = null; item.terminal = 'failed'; item.code = 'PLAYBACK_ERROR'; status = 'failed'; diagnostic('GENERATION_PLAYBACK_ERROR', item.model) }
  }
  models.forEach(item => makePlayer(item))
  if (status === 'failed') cleanupAll('dispose')

  function fail(code, model) { if (TERMINAL.has(status)) return snapshot(); status = 'failed'; cleanupAll('dispose'); diagnostic(code, model); return snapshot() }
  const validIdentity = event => event && event.generation_id === generationId
  const handleEvent = event => {
    if (disposed || TERMINAL.has(status) || status === 'cancelling') return snapshot()
    if (!event || typeof event !== 'object') return fail('GENERATION_EVENT_REJECTED')
    if (event.type === 'meta') {
      if (metaSeen || event.generation_id !== generationId || event.conversation_guid !== conversationGuid || !Array.isArray(event.models) || event.models.length !== models.length || event.models.some((m, i) => m !== models[i].model)) return fail('GENERATION_META_ERROR')
      metaSeen = true; setStatus('receiving'); return snapshot()
    }
    if (!metaSeen || !validIdentity(event)) return fail('GENERATION_EVENT_REJECTED')
    if (event.type === 'delta') {
      const item = modelFor(event.model)
      if (!item || item.terminal || !Number.isSafeInteger(event.seq) || event.seq !== item.lastSeq + 1 || typeof event.delta !== 'string' || !event.delta) return fail('GENERATION_SEQUENCE_ERROR')
      item.lastSeq = event.seq; item.receivedText += event.delta; item.player.push(event.delta); return snapshot()
    }
    if (event.type === 'model_done' || event.type === 'model_error') {
      const item = modelFor(event.model)
      if (!item || item.terminal || (event.type === 'model_done' && event.last_seq !== item.lastSeq)) return fail('GENERATION_MODEL_TERMINAL_ERROR')
      item.terminal = event.type === 'model_done' ? 'completed' : 'failed'; item.code = event.type === 'model_error' ? safeCode(event.code) : null
      if (event.type === 'model_done') item.player.finish()
      else item.player.cancel()
      return snapshot()
    }
    if (event.type === 'done') {
      const modelSummary = event.models
      const summaryOK = mode === 'single' ? !Object.prototype.hasOwnProperty.call(event, 'models') : modelSummary && typeof modelSummary === 'object' && !Array.isArray(modelSummary) && Object.keys(modelSummary).length === models.length && models.every(item => { const entry = modelSummary[item.model]; return entry && entry.status === item.terminal && (entry.status === 'completed' ? Number.isSafeInteger(entry.tokens) && entry.tokens >= 0 && Object.keys(entry).every(key => ['status', 'tokens'].includes(key)) : entry.status === 'failed' && STABLE_CODES.has(entry.code) && Object.keys(entry).every(key => ['status', 'code'].includes(key))) })
      if (globalDone || event.status !== 'completed' || event.conversation_guid !== conversationGuid || models.some(item => !item.terminal) || !summaryOK) return fail('GENERATION_DONE_ERROR')
      if (mode === 'single' && models[0].terminal !== 'completed') return fail('GENERATION_DONE_ERROR')
      globalDone = true; models.forEach(item => { if (item.terminal === 'completed') item.player.finish() }); setStatus('draining'); maybeComplete(); return snapshot()
    }
    if (event.type === 'error') return fail('GENERATION_REMOTE_ERROR')
    diagnostic('GENERATION_UNKNOWN_EVENT'); return snapshot()
  }
  const cancelLocalQueue = () => { if (status === 'waiting' || status === 'receiving') { for (const item of models) { if (status === 'failed') break; try { item.player?.cancel() } catch { fail('GENERATION_CLEANUP_ERROR', item.model) } } if (status !== 'failed') setStatus('cancelling') } return snapshot() }
  const applyAuthoritative = result => {
    if (!result || result.status !== 'completed') return fail('GENERATION_DATA_ERROR')
    const entries = mode === 'single' ? [result.result || (Array.isArray(result.results) ? result.results[0] : null)] : result.results
    if (!Array.isArray(entries) || entries.length !== models.length) return fail('GENERATION_DATA_ERROR')
    for (let i = 0; i < models.length; i++) {
      const item = models[i]; const entry = entries[i]
      if (!entry || entry.model !== item.model) return fail('GENERATION_DATA_ERROR')
      if (entry.status === 'failed') { item.player.cancel(); item.terminal = 'failed'; item.code = safeCode(entry.code); continue }
      if (entry.status !== 'completed' || typeof entry.content !== 'string' || !entry.content.startsWith(item.displayedText)) return fail('GENERATION_DATA_ERROR')
      const prefix = item.displayedText; const suffix = entry.content.slice(prefix.length); item.receivedText = entry.content; item.terminal = 'completed'; item.code = null
      cleanupPlayer(item, 'dispose'); makePlayer(item, prefix)
      if (suffix) item.player.push(suffix); item.player.finish()
    }
    globalDone = true; setStatus('draining'); maybeComplete(); return snapshot()
  }
  const validateStatusPayload = result => {
    if (!result || typeof result !== 'object' || result.generation_id !== generationId || result.mode !== mode) return false
    if (result.status === 'completed') {
      if (result.conversation_guid !== conversationGuid || !Number.isSafeInteger(result.total_tokens_used) || result.total_tokens_used < 0) return false
      if (mode === 'single') {
        const entry = result.result
        return !!entry && !Object.prototype.hasOwnProperty.call(result, 'results') && entry.model === models[0].model && entry.status === 'completed' && typeof entry.assistant_message_guid === 'string' && !!entry.assistant_message_guid.trim() && typeof entry.content === 'string' && Number.isSafeInteger(entry.tokens) && entry.tokens >= 0 && Object.keys(entry).every(key => ['model', 'status', 'content', 'assistant_message_guid', 'tokens'].includes(key))
      }
      return Array.isArray(result.results) && !Object.prototype.hasOwnProperty.call(result, 'result') && result.results.length === models.length && result.results.every((entry, index) => entry && entry.model === models[index].model && (entry.status === 'completed' || entry.status === 'failed') && Object.keys(entry).every(key => entry.status === 'completed' ? ['model', 'status', 'content', 'assistant_message_guid', 'tokens'].includes(key) : ['model', 'status', 'code'].includes(key)) && (entry.status === 'completed' ? typeof entry.assistant_message_guid === 'string' && !!entry.assistant_message_guid.trim() && typeof entry.content === 'string' && Number.isSafeInteger(entry.tokens) && entry.tokens >= 0 : STABLE_CODES.has(entry.code) && !!entry.code))
    }
    if (!['cancelled', 'failed', 'cancelling', 'committing', 'running'].includes(result.status)) return false
    const guidOK = result.conversation_guid === null || (typeof result.conversation_guid === 'string' && !!result.conversation_guid.trim() && result.conversation_guid === conversationGuid)
    return guidOK && (result.status !== 'failed' || STABLE_CODES.has(result.code)) && !Object.prototype.hasOwnProperty.call(result, 'result') && !Object.prototype.hasOwnProperty.call(result, 'results')
  }
  const resolve = result => {
    if (TERMINAL.has(status)) return snapshot()
    if (!validateStatusPayload(result)) { diagnostic('GENERATION_STATUS_ERROR'); return snapshot() }
    if (result.status === 'completed') return applyAuthoritative(result)
    if (result.status === 'cancelled') { cleanupAll('cancel'); if (!TERMINAL.has(status)) setStatus('cancelled'); return snapshot() }
    if (result.status === 'failed') return fail('GENERATION_REMOTE_ERROR')
    if (result.status === 'cancelling' || result.status === 'committing' || result.status === 'running') return snapshot()
    return fail('GENERATION_STATUS_ERROR')
  }
  const dispose = () => { if (disposed) return snapshot(); cleanupAll('dispose'); disposed = true; status = 'disposed'; return snapshot() }

  return { snapshot, handleEvent, onEvent: handleEvent, pushEvent: handleEvent, cancelLocalQueue, resolveCancel: resolve, resolveStatus: resolve, eof: () => fail('GENERATION_EOF'), fail: code => fail(code === 'transport' ? 'GENERATION_TRANSPORT_ERROR' : 'GENERATION_PARSER_ERROR'), dispose }
}
