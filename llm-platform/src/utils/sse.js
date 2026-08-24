/**
 * 解析平台 SSE：首包 meta + OpenAI 兼容 delta
 */
async function readUnauthorizedDetail(response) {
  try {
    const err = await response.json()
    if (typeof err.detail === 'string') return err.detail
  } catch {
    /* ignore */
  }
  const { useLocaleStore } = await import('@/stores/locale')
  return useLocaleStore().t('auth.sessionExpired')
}

async function readPlatformFailure(response) {
  let code = ''
  try {
    const payload = await response.json()
    code = payload?.error?.code || payload?.code || ''
  } catch {
    /* A non-JSON error is intentionally not surfaced to the user. */
  }
  if (code === 'model_unavailable') return '模型当前不可用，请刷新模型目录后重试'
  if (response.status === 413) return '请求内容过大'
  if (response.status === 415) return '请求格式不正确'
  return '请求失败，请稍后重试'
}

/** Converts only documented platform SSE payloads into safe display events. */
export function parsePlatformEvent(event, data) {
  let payload
  try {
    payload = JSON.parse(data)
  } catch {
    return null
  }
  if (event === 'chunk' && typeof payload.model === 'string' && payload.model && payload.chunk?.choices?.[0]?.delta) {
    return { kind: 'modelChunk', model: payload.model, delta: payload.chunk.choices[0].delta.content || '' }
  }
  if (event === 'model_done' && typeof payload.model === 'string' && payload.model) {
    return { kind: 'modelDone', model: payload.model }
  }
  if (event === 'model_error' && typeof payload.model === 'string' && payload.model) {
    return { kind: 'modelError', model: payload.model, message: safeClientMessage(payload.error) }
  }
  if (event === 'message' && payload.choices?.[0]?.delta) {
    return { kind: 'chatChunk', delta: payload.choices[0].delta.content || '' }
  }
  if (event === 'error' || payload.error) return { kind: 'error', message: '请求失败' }
  if (payload.type === 'done') return { kind: 'done', payload }
  if (payload.type === 'meta') return { kind: 'meta', payload }
  return null
}

function safeClientMessage(error) {
  const message = typeof error?.message === 'string' ? error.message : ''
  return message && message.length <= 120 && !/https?:\/\/|key|secret|token/i.test(message) ? message : '请求失败'
}

async function consumePlatformSSE(response, onEvent) {
  const reader = response.body?.getReader()
  if (!reader) throw new Error('stream_unavailable')

  const decoder = new TextDecoder()
  let buffer = ''
  let event = 'message'
  let dataLines = []
  const dispatch = () => {
    if (!dataLines.length) return
    onEvent(event, dataLines.join('\n'))
    event = 'message'
    dataLines = []
  }
  const consumeLine = (line) => {
    if (!line) {
      dispatch()
    } else if (line.startsWith('event:')) {
      event = line.slice(6).trim() || 'message'
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trimStart())
    }
  }

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''
    lines.forEach((line) => consumeLine(line.endsWith('\r') ? line.slice(0, -1) : line))
  }
  buffer += decoder.decode()
  if (buffer) consumeLine(buffer.endsWith('\r') ? buffer.slice(0, -1) : buffer)
  dispatch()
}

export async function readPlatformChatStream(response, { onMeta, onChunk, onDone, onError }) {
  if (!response.ok) {
    if (response.status === 401) {
      const { handleUnauthorized } = await import('@/utils/auth-redirect')
      await handleUnauthorized(await readUnauthorizedDetail(response))
      return
    }
    onError?.(await readPlatformFailure(response))
    return
  }

  let meta = {}
  let doneCalled = false

  try {
    await consumePlatformSSE(response, (event, data) => {
      if (data === '[DONE]') return
      const parsed = parsePlatformEvent(event, data)
      if (parsed?.kind === 'meta') {
        meta = { conversationId: parsed.payload.conversation_id, datasetUsed: parsed.payload.dataset_used, datasetBadge: parsed.payload.dataset_attribution }
        onMeta?.(meta)
      } else if (parsed?.kind === 'done') {
        meta = { ...meta, tokens: parsed.payload.tokens ?? 0, totalTokensUsed: parsed.payload.total_tokens_used }
        onDone?.(meta)
        doneCalled = true
      } else if (parsed?.kind === 'error') {
        onError?.(parsed.message)
      } else if (parsed?.kind === 'chatChunk' && parsed.delta) {
        onChunk?.(parsed.delta)
      }
    })
    if (!doneCalled) onDone?.(meta)
  } catch (e) {
    onError?.('流式连接中断')
  }
}

/** 解析模型对比 SSE：流式 model_chunk，结束后推送 done */
export async function readPlatformCompareStream(
  response,
  { onModelChunk, onModelResult, onDone, onError }
) {
  if (!response.ok) {
    if (response.status === 401) {
      const { handleUnauthorized } = await import('@/utils/auth-redirect')
      await handleUnauthorized(await readUnauthorizedDetail(response))
      return
    }
    onError?.(await readPlatformFailure(response))
    return
  }

  let doneMeta = {}
  let doneCalled = false

  try {
    await consumePlatformSSE(response, (event, data) => {
      if (data === '[DONE]') return
      const parsed = parsePlatformEvent(event, data)
      if (parsed?.kind === 'modelChunk') onModelChunk?.({ model: parsed.model, delta: parsed.delta })
      else if (parsed?.kind === 'modelDone') onModelResult?.({ model: parsed.model })
      else if (parsed?.kind === 'modelError') onModelResult?.({ model: parsed.model, error: parsed.message })
      else if (parsed?.kind === 'done') {
        doneMeta = { conversationId: parsed.payload.conversation_id, datasetAttribution: parsed.payload.dataset_attribution, datasetUsed: parsed.payload.dataset_used, tokens: parsed.payload.tokens ?? 0, totalTokensUsed: parsed.payload.total_tokens_used }
        onDone?.(doneMeta)
        doneCalled = true
      } else if (parsed?.kind === 'error') {
        onError?.(parsed.message)
      }
    })
    if (!doneCalled) onDone?.(doneMeta)
  } catch (e) {
    onError?.('流式连接中断')
  }
}
