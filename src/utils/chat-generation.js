import { createGraphemePlayback } from './grapheme-playback.js'

const TERMINAL = new Set(['completed', 'cancelled', 'failed', 'disposed'])
const VALID_STATUSES = new Set(['waiting', 'receiving', 'cancelling', 'draining', 'completed', 'cancelled', 'failed', 'disposed'])

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
const safeCode = code => typeof code === 'string' && /^[A-Z0-9_]+$/.test(code) ? code : 'GENERATION_ERROR'

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
  const models = options.models.map(model => ({ model, receivedText: '', displayedText: '', lastSeq: 0, terminal: null, code: null, player: null }))

  const notify = () => { try { change(snapshot()) } catch {} }
  const diagnostic = (code, model) => {
    const item = { code: safeCode(code) }
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
  const allDrained = () => models.every(item => { const p = playerSnapshot(item); return p.pendingCount === 0 && item.displayedText === item.receivedText })
  const maybeComplete = () => { if (status === 'draining' && globalDone && allDrained()) setStatus('completed') }
  const makePlayer = (item, prefix = '') => {
    const callbacks = { onDisplay: displayed => { item.displayedText = prefix + displayed; notify(); maybeComplete() }, onError: () => { item.terminal = 'failed'; item.code = 'PLAYBACK_ERROR'; if (!TERMINAL.has(status)) setStatus('failed'); diagnostic('GENERATION_PLAYBACK_ERROR', item.model) } }
    try { item.player = factory({ ...playbackOptions, ...callbacks, model: item.model }) } catch { item.terminal = 'failed'; item.code = 'PLAYBACK_ERROR'; setStatus('failed') }
  }
  models.forEach(item => makePlayer(item))

  const fail = code => { if (TERMINAL.has(status)) return snapshot(); status = 'failed'; diagnostic(code); return snapshot() }
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
      item.player.finish()
      return snapshot()
    }
    if (event.type === 'done') {
      if (globalDone || event.status !== 'completed' || event.conversation_guid !== conversationGuid || models.some(item => !item.terminal)) return fail('GENERATION_DONE_ERROR')
      if (mode === 'single' && models[0].terminal !== 'completed') return fail('GENERATION_DONE_ERROR')
      globalDone = true; models.forEach(item => { if (item.terminal === 'completed') item.player.finish() }); setStatus('draining'); maybeComplete(); return snapshot()
    }
    if (event.type === 'error') return fail('GENERATION_REMOTE_ERROR')
    diagnostic('GENERATION_UNKNOWN_EVENT'); return snapshot()
  }
  const cancelLocalQueue = () => { if (status === 'waiting' || status === 'receiving') { models.forEach(item => item.player.cancel()); setStatus('cancelling') } return snapshot() }
  const applyAuthoritative = result => {
    if (!result || result.status !== 'completed') return fail('GENERATION_DATA_ERROR')
    const entries = mode === 'single' ? [result.result || (Array.isArray(result.results) ? result.results[0] : null)] : result.results
    if (!Array.isArray(entries) || entries.length !== models.length) return fail('GENERATION_DATA_ERROR')
    for (let i = 0; i < models.length; i++) {
      const item = models[i]; const entry = entries[i]
      if (!entry || entry.model !== item.model) return fail('GENERATION_DATA_ERROR')
      if (entry.status === 'failed') { item.terminal = 'failed'; item.code = safeCode(entry.code); continue }
      if (entry.status !== 'completed' || typeof entry.content !== 'string' || !entry.content.startsWith(item.displayedText)) return fail('GENERATION_DATA_ERROR')
      const prefix = item.displayedText; const suffix = entry.content.slice(prefix.length); item.receivedText = entry.content; item.terminal = 'completed'; item.code = null
      if (item.player.snapshot().finished || item.player.snapshot().disposed) { item.player = null; makePlayer(item, prefix) }
      if (suffix) item.player.push(suffix); item.player.finish()
    }
    globalDone = true; setStatus('draining'); maybeComplete(); return snapshot()
  }
  const resolve = result => {
    if (!result || typeof result.status !== 'string') return fail('GENERATION_STATUS_ERROR')
    if (result.status === 'completed') return applyAuthoritative(result)
    if (result.status === 'cancelled') { models.forEach(item => item.player.cancel()); setStatus('cancelled'); return snapshot() }
    if (result.status === 'failed') return fail('GENERATION_REMOTE_ERROR')
    if (result.status === 'cancelling' || result.status === 'committing' || result.status === 'running') return snapshot()
    return fail('GENERATION_STATUS_ERROR')
  }
  const dispose = () => { if (disposed) return snapshot(); disposed = true; models.forEach(item => item.player.dispose()); status = 'disposed'; diagnostics = []; return snapshot() }

  return { snapshot, handleEvent, onEvent: handleEvent, pushEvent: handleEvent, cancelLocalQueue, resolveCancel: resolve, resolveStatus: resolve, eof: () => fail('GENERATION_EOF'), fail: code => fail(code === 'transport' ? 'GENERATION_TRANSPORT_ERROR' : 'GENERATION_PARSER_ERROR'), dispose }
}
