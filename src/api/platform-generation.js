import { authenticatedFetch } from './request.js'
import { createPlatformSSEv2Parser, PLATFORM_SSE_V2_ERROR_CODES } from '../utils/platform-sse-v2.js'

const PREFIX = '/api/v1/platform'
const STREAM_VERSION = 'platform-chat-sse.v2'
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const POSITIVE_INT64 = /^[1-9][0-9]*$/
const SAFE_CODES = new Set(['gateway_upstream_error', 'invalid_request', 'rate_limited', 'cancelled', 'timeout', 'internal_error', 'upstream_error'])
const SAFE_HTTP_CODES = new Set([...SAFE_CODES, 'generation_not_found', 'generation_status_unavailable'])
const TERMINAL = new Set(['cancelled', 'completed', 'failed'])
const PENDING = new Set(['running', 'cancelling', 'committing'])
const SINGLE_FIELDS = ['model', 'messages', 'conversation_guid', 'temperature', 'max_tokens', 'context_window', 'n', 'top_p', 'frequency_penalty', 'presence_penalty', 'stop', 'tools', 'response_format', 'stream_options', 'seed']
const COMPARE_FIELDS = ['model', 'models', ...SINGLE_FIELDS.filter(field => field !== 'model')]
const HTTP_TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/

const hasExactKeys = (value, required, optional = []) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const keys = Object.keys(value)
  const allowed = new Set([...required, ...optional])
  return required.every(key => Object.prototype.hasOwnProperty.call(value, key)) && keys.every(key => allowed.has(key))
}
const isSafeInteger = value => Number.isSafeInteger(value) && value >= 0
const utf8Length = value => new TextEncoder().encode(value).byteLength
const isValidUTF8String = value => typeof value === 'string' && new TextDecoder('utf-8', { fatal: true }).decode(new TextEncoder().encode(value)) === value
const isPositiveDecimal = value => {
  if (typeof value !== 'string' || !POSITIVE_INT64.test(value)) return false
  try { return BigInt(value) <= 9223372036854775807n } catch { return false }
}
const abortError = () => new DOMException('The operation was aborted.', 'AbortError')
const assertNotAborted = signal => { if (signal?.aborted) throw abortError() }

export class PlatformGenerationIndeterminateError extends Error {
  constructor(generationId, reason) {
    super('Generation outcome is indeterminate; recover it with the generation id.')
    this.name = 'PlatformGenerationIndeterminateError'
    this.code = 'generation_indeterminate'
    this.generation_id = generationId
    this.reason = reason
  }
}

export class PlatformGenerationRemoteError extends Error {
  constructor(generationId) {
    super('Generation ended with a server-declared error.')
    this.name = 'PlatformGenerationRemoteError'
    this.code = PLATFORM_SSE_V2_ERROR_CODES.remote
    this.generation_id = generationId
  }
}

export class PlatformGenerationHTTPError extends Error {
  constructor(status, code = 'request_failed', generationId) {
    super('Platform generation request failed.')
    this.name = 'PlatformGenerationHTTPError'
    this.status = status
    this.code = code
    this.generation_id = generationId
  }
}

export function assertCanonicalGenerationId(value) {
  if (typeof value !== 'string' || !UUID_V4.test(value)) throw new TypeError('generationId must be a canonical lowercase UUID v4')
  return value
}

function createGenerationId(randomUUID) {
  const id = String(randomUUID()).toLowerCase()
  return assertCanonicalGenerationId(id)
}

function requestPayload(body, generationId, compare) {
  const source = body && typeof body === 'object' ? body : {}
  const payload = {}
  for (const field of compare ? COMPARE_FIELDS : SINGLE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(source, field)) payload[field] = source[field]
  }
  if (!Object.prototype.hasOwnProperty.call(payload, 'conversation_guid') && Object.prototype.hasOwnProperty.call(source, 'conversationGuid')) {
    const guid = source.conversationGuid
    if (typeof guid === 'string' && guid.trim()) payload.conversation_guid = guid
  }
  payload.stream = true
  payload.stream_version = STREAM_VERSION
  payload.generation_id = generationId
  return payload
}

function requestedModels(body, compare, generationId) {
  const valid = model => isValidUTF8String(model)
    && model.length > 0
    && model.trim() === model
    && utf8Length(model) <= 128
  if (!valid(body?.model)) throw new PlatformGenerationIndeterminateError(generationId, 'invalid_generation_request')
  if (!compare) {
    return [body.model]
  }
  if (!Array.isArray(body?.models)
      || body.models.length < 2
      || body.models.length > 3
      || !body.models.every(valid)
      || new Set(body.models).size !== body.models.length) {
    throw new PlatformGenerationIndeterminateError(generationId, 'invalid_generation_request')
  }
  return [...body.models]
}

function isEventStreamContentType(value) {
  if (typeof value !== 'string') return false
  let index = 0
  const skipOWS = () => { while (value[index] === ' ' || value[index] === '\t') index += 1 }
  skipOWS()
  const typeStart = index
  while (index < value.length && value[index] !== ';' && value[index] !== ' ' && value[index] !== '\t') index += 1
  if (value.slice(typeStart, index).toLowerCase() !== 'text/event-stream') return false
  skipOWS()
  while (index < value.length) {
    if (value[index] !== ';') return false
    index += 1
    skipOWS()
    const nameStart = index
    while (index < value.length && HTTP_TOKEN.test(value[index])) index += 1
    if (index === nameStart) return false
    skipOWS()
    if (value[index] !== '=') return false
    index += 1
    skipOWS()
    if (value[index] === '"') {
      index += 1
      let closed = false
      while (index < value.length) {
        const character = value[index]
        const code = value.charCodeAt(index)
        if (character === '"') { index += 1; closed = true; break }
        if (character === '\\') {
          index += 1
          if (index >= value.length) return false
          const escaped = value.charCodeAt(index)
          if (escaped !== 9 && (escaped < 32 || escaped > 126)) return false
        } else if (code !== 9 && (code < 32 || code === 127)) return false
        index += 1
      }
      if (!closed) return false
    } else {
      const parameterStart = index
      while (index < value.length && HTTP_TOKEN.test(value[index])) index += 1
      if (index === parameterStart) return false
    }
    skipOWS()
  }
  return true
}

const hasNoStore = response => {
  const value = response.headers?.get?.('Cache-Control')
  if (typeof value !== 'string') return false
  const directives = value.split(',').map(item => item.trim()).filter(Boolean)
  return directives.length === 1 && directives[0].toLowerCase() === 'no-store'
}

async function cancelUnreadBody(response) {
  try { await response.body?.cancel?.() } catch { /* Best-effort release of an untrusted response. */ }
}

function validateResult(result) {
  if (hasExactKeys(result, ['model', 'status', 'assistant_message_guid', 'content', 'tokens'])
      && isValidUTF8String(result.model) && result.model.trim() === result.model && result.model.length > 0 && utf8Length(result.model) <= 128
      && result.status === 'completed' && isPositiveDecimal(result.assistant_message_guid)
      && isValidUTF8String(result.content) && result.content.length > 0 && utf8Length(result.content) <= 65535
      && Number.isInteger(result.tokens) && result.tokens >= 0 && result.tokens <= 2147483647) return { ...result }
  if (hasExactKeys(result, ['model', 'status', 'code'])
      && isValidUTF8String(result.model) && result.model.trim() === result.model && result.model.length > 0 && utf8Length(result.model) <= 128
      && result.status === 'failed' && SAFE_CODES.has(result.code)) return { ...result }
  return null
}

function validateStatus(value, generationId, expectedModels) {
  if (value?.generation_id !== generationId) return null
  if (PENDING.has(value?.status)) {
    if (!hasExactKeys(value, ['generation_id', 'status', 'mode', 'conversation_guid']) || !['single', 'compare'].includes(value.mode) || value.conversation_guid !== null) return null
    return { ...value }
  }
  if (value?.status === 'cancelled') {
    if (!hasExactKeys(value, ['generation_id', 'status', 'mode', 'conversation_guid']) || !['single', 'compare', null].includes(value.mode) || value.conversation_guid !== null) return null
    return { ...value }
  }
  if (value?.status === 'failed') {
    if (!hasExactKeys(value, ['generation_id', 'status', 'mode', 'conversation_guid', 'code']) || !['single', 'compare', null].includes(value.mode) || value.conversation_guid !== null || !SAFE_CODES.has(value.code)) return null
    return { ...value }
  }
  if (value?.status !== 'completed' || !isPositiveDecimal(value.conversation_guid) || !isSafeInteger(value.total_tokens_used)) return null
  if (value.mode === 'single') {
    if (!hasExactKeys(value, ['generation_id', 'status', 'mode', 'conversation_guid', 'result', 'total_tokens_used'])) return null
    const result = validateResult(value.result)
    if (!result || result.status !== 'completed') return null
    if (expectedModels && (expectedModels.length !== 1 || result.model !== expectedModels[0])) return null
    return { ...value, result }
  }
  if (value.mode === 'compare') {
    if (!hasExactKeys(value, ['generation_id', 'status', 'mode', 'conversation_guid', 'results', 'total_tokens_used']) || !Array.isArray(value.results) || value.results.length < 2 || value.results.length > 3) return null
    const results = value.results.map(validateResult)
    if (results.some(result => !result) || new Set(results.map(result => result.model)).size !== results.length) return null
    if (expectedModels && (expectedModels.length !== results.length || expectedModels.some((model, index) => model !== results[index].model))) return null
    return { ...value, results }
  }
  return null
}

async function safeHTTPError(response, generationId) {
  let code = 'request_failed'
  try {
    const data = await response.json()
    const candidate = data?.error?.code
    if (SAFE_HTTP_CODES.has(candidate)) code = candidate
  } catch { /* A private or malformed body is never exposed. */ }
  return new PlatformGenerationHTTPError(response.status, code, generationId)
}

function defaultSleep(ms, signal) {
  assertNotAborted(signal)
  return new Promise((resolve, reject) => {
    const cleanup = () => signal?.removeEventListener('abort', abort)
    const timer = setTimeout(() => { cleanup(); resolve() }, ms)
    const abort = () => { clearTimeout(timer); cleanup(); reject(abortError()) }
    signal?.addEventListener('abort', abort, { once: true })
  })
}

export function createPlatformGenerationClient({
  baseURL = '',
  authenticatedFetchImpl = authenticatedFetch,
  randomUUID = () => globalThis.crypto.randomUUID(),
  parserFactory = createPlatformSSEv2Parser,
  sleep = defaultSleep,
  now = () => Date.now(),
} = {}) {
  const generationURL = generationId => `${baseURL}${PREFIX}/chat/generations/${generationId}`

  async function requestJSON(url, init, generationId, expectedModels) {
    let response
    try { response = await authenticatedFetchImpl(url, init) }
    catch (error) { throw new PlatformGenerationIndeterminateError(generationId, init.signal?.aborted || error?.name === 'AbortError' ? 'aborted' : 'network_error') }
    if (!hasNoStore(response)) {
      await cancelUnreadBody(response)
      if (!response.ok) throw new PlatformGenerationHTTPError(response.status, 'request_failed', generationId)
      throw new PlatformGenerationIndeterminateError(generationId, 'invalid_cache_control')
    }
    if (!response.ok) throw await safeHTTPError(response, generationId)
    let data
    try { data = await response.json() } catch { throw new PlatformGenerationIndeterminateError(generationId, 'invalid_status_response') }
    const status = validateStatus(data, generationId, expectedModels)
    if (!status) throw new PlatformGenerationIndeterminateError(generationId, 'invalid_status_response')
    return { data: status, response }
  }

  async function consumeStream(response, generationId, models, onEvent, signal) {
    if (!response.ok) throw await safeHTTPError(response, generationId)
    if (!isEventStreamContentType(response.headers.get('Content-Type')) || !response.body) {
      try { await response.body?.cancel?.() } catch { /* Best-effort release of an unread invalid response. */ }
      throw new PlatformGenerationIndeterminateError(generationId, 'invalid_stream_response')
    }
    if (signal?.aborted) {
      try { await response.body.cancel() } catch { /* Best-effort release before a reader is established. */ }
      throw new PlatformGenerationIndeterminateError(generationId, 'aborted')
    }
    let reader
    try { reader = response.body.getReader() }
    catch {
      try { await response.body.cancel() } catch { /* A locked or invalid body still fails closed. */ }
      throw new PlatformGenerationIndeterminateError(generationId, 'invalid_stream_response')
    }
    let cancellation = null
    const cancelOnce = () => {
      if (!cancellation) cancellation = Promise.resolve().then(() => reader.cancel()).catch(() => {})
      return cancellation
    }
    const cancelReader = () => { void cancelOnce() }
    signal?.addEventListener('abort', cancelReader, { once: true })
    try {
      let parserError = null
      let done = null
      let parser
      try {
        parser = parserFactory({
          generationId,
          models,
          onEvent(event) {
            const safeEvent = Object.freeze({ ...event, generation_id: generationId })
            if (safeEvent.type === 'done') done = safeEvent
            onEvent?.(safeEvent)
          },
          onError(error) { parserError = error.code },
        })
      } catch {
        throw new PlatformGenerationIndeterminateError(generationId, 'parser_initialization_error')
      }
      assertNotAborted(signal)
      while (!parserError && !done) {
        const item = await reader.read()
        if (item.done) break
        parser.push(item.value)
      }
      if (parserError) {
        if (parserError === PLATFORM_SSE_V2_ERROR_CODES.remote) throw new PlatformGenerationRemoteError(generationId)
        throw new PlatformGenerationIndeterminateError(generationId, parserError)
      }
      if (done) return { generation_id: generationId, status: 'completed', done }
      if (signal?.aborted) throw new PlatformGenerationIndeterminateError(generationId, 'aborted')
      parser.finish()
      if (parserError === PLATFORM_SSE_V2_ERROR_CODES.remote) throw new PlatformGenerationRemoteError(generationId)
      if (parserError) throw new PlatformGenerationIndeterminateError(generationId, parserError)
      if (!done) throw new PlatformGenerationIndeterminateError(generationId, PLATFORM_SSE_V2_ERROR_CODES.eof)
      return { generation_id: generationId, status: 'completed', done }
    } catch (error) {
      if (error instanceof PlatformGenerationIndeterminateError || error instanceof PlatformGenerationRemoteError || error instanceof PlatformGenerationHTTPError) throw error
      throw new PlatformGenerationIndeterminateError(generationId, signal?.aborted || error?.name === 'AbortError' ? 'aborted' : 'network_error')
    } finally {
      signal?.removeEventListener('abort', cancelReader)
      await cancelOnce()
      try { reader.releaseLock() } catch { /* Reader may already be detached after cancellation. */ }
    }
  }

  async function stream(body, options, compare) {
    const generationId = options?.generationId ? assertCanonicalGenerationId(options.generationId) : createGenerationId(randomUUID)
    const models = requestedModels(body, compare, generationId)
    let payload
    try { payload = JSON.stringify(requestPayload(body, generationId, compare)) }
    catch { throw new PlatformGenerationIndeterminateError(generationId, 'invalid_generation_request') }
    const response = await authenticatedFetchImpl(`${baseURL}${PREFIX}/chat/${compare ? 'compare' : 'completions'}`, {
      method: 'POST',
      signal: options?.signal,
      headers: { 'Content-Type': 'application/json' },
      body: payload,
    }).catch(error => {
      throw new PlatformGenerationIndeterminateError(generationId, error?.name === 'AbortError' || options?.signal?.aborted ? 'aborted' : 'network_error')
    })
    return consumeStream(response, generationId, models, options?.onEvent, options?.signal)
  }

  async function get(generationId, options = {}) {
    assertCanonicalGenerationId(generationId)
    return (await requestJSON(generationURL(generationId), { method: 'GET', signal: options.signal, cache: 'no-store' }, generationId, options.models)).data
  }

  async function poll(generationId, options = {}) {
    assertCanonicalGenerationId(generationId)
    const started = now()
    let attempts = 0
    while (true) {
      assertNotAborted(options.signal)
      const status = await get(generationId, options)
      attempts += 1
      if (TERMINAL.has(status.status)) return status
      const elapsed = Math.max(0, now() - started)
      let delay
      if (elapsed >= 10000 || attempts >= 8) delay = 5000
      else delay = [250, 500, 1000, 2000][Math.min(attempts - 1, 3)]
      await sleep(delay, options.signal)
      assertNotAborted(options.signal)
    }
  }

  async function cancel(generationId, options = {}) {
    assertCanonicalGenerationId(generationId)
    const { data, response } = await requestJSON(`${generationURL(generationId)}/cancel`, { method: 'POST', signal: options.signal, cache: 'no-store' }, generationId, options.models)
    if (response.status === 200 && TERMINAL.has(data.status)) return data
    if (response.status !== 202 || !['cancelling', 'committing'].includes(data.status)) {
      throw new PlatformGenerationIndeterminateError(generationId, 'invalid_cancel_response')
    }
    if (response.headers.get('Retry-After') !== '1') throw new PlatformGenerationIndeterminateError(generationId, 'invalid_cancel_response')
    await sleep(1000, options.signal)
    assertNotAborted(options.signal)
    return poll(generationId, options)
  }

  return Object.freeze({
    createGenerationId: () => createGenerationId(randomUUID),
    streamSingle: (body, options = {}) => stream(body, options, false),
    streamCompare: (body, options = {}) => stream(body, options, true),
    get,
    cancel,
    poll,
  })
}

const productionClient = createPlatformGenerationClient({ baseURL: import.meta.env?.VITE_API_BASE ?? '' })

export const createPlatformGenerationId = () => productionClient.createGenerationId()
export const streamPlatformGeneration = (body, options) => productionClient.streamSingle(body, options)
export const streamPlatformCompareGeneration = (body, options) => productionClient.streamCompare(body, options)
export const getPlatformGeneration = (generationId, options) => productionClient.get(generationId, options)
export const cancelPlatformGeneration = (generationId, options) => productionClient.cancel(generationId, options)
export const pollPlatformGeneration = (generationId, options) => productionClient.poll(generationId, options)
