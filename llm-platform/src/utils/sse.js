/**
 * 解析平台 SSE：首包 meta + OpenAI 兼容 delta
 */
export async function readPlatformChatStream(response, { onMeta, onChunk, onDone, onError }) {
  if (!response.ok) {
    let detail = `HTTP ${response.status}`
    try {
      const err = await response.json()
      detail = err.detail || detail
    } catch {
      /* ignore */
    }
    onError?.(typeof detail === 'string' ? detail : '请求失败')
    return
  }

  const reader = response.body?.getReader()
  if (!reader) {
    onError?.('不支持流式响应')
    return
  }

  const decoder = new TextDecoder()
  let buffer = ''
  let meta = {}
  let doneCalled = false

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (!line.startsWith('data:')) continue
        const data = line.slice(5).trim()
        if (!data || data === '[DONE]') continue

        try {
          const json = JSON.parse(data)
          if (json.type === 'meta') {
            meta = {
              conversationId: json.conversation_id,
              datasetUsed: json.dataset_used,
              datasetBadge: json.dataset_attribution,
            }
            onMeta?.(meta)
            continue
          }
          if (json.type === 'done') {
            meta = {
              ...meta,
              tokens: json.tokens ?? 0,
              totalTokensUsed: json.total_tokens_used,
            }
            onDone?.(meta)
            doneCalled = true
            continue
          }
          if (json.error) {
            const msg = json.error?.message || json.error
            onError?.(typeof msg === 'string' ? msg : '流式输出错误')
            return
          }
          const delta = json.choices?.[0]?.delta?.content
          if (delta) onChunk?.(delta)
        } catch {
          /* 非 JSON 行忽略 */
        }
      }
    }
    if (!doneCalled) onDone?.(meta)
  } catch (e) {
    onError?.(e.message || '流中断')
  }
}

/** 解析模型对比 SSE：流式 model_chunk，结束后推送 done */
export async function readPlatformCompareStream(
  response,
  { onModelChunk, onModelResult, onDone, onError }
) {
  if (!response.ok) {
    let detail = `HTTP ${response.status}`
    try {
      const err = await response.json()
      detail = err.detail || detail
    } catch {
      /* ignore */
    }
    onError?.(typeof detail === 'string' ? detail : '请求失败')
    return
  }

  const reader = response.body?.getReader()
  if (!reader) {
    onError?.('不支持流式响应')
    return
  }

  const decoder = new TextDecoder()
  let buffer = ''
  let doneMeta = {}
  let doneCalled = false

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (!line.startsWith('data:')) continue
        const data = line.slice(5).trim()
        if (!data || data === '[DONE]') continue

        try {
          const json = JSON.parse(data)
          if (json.type === 'model_chunk' && json.model) {
            onModelChunk?.({
              model: json.model,
              delta: json.delta || '',
            })
            continue
          }
          if (json.type === 'model_result') {
            onModelResult?.({
              model: json.model,
              content: json.content,
              error: json.error,
              tokens: json.tokens,
              latency_ms: json.latency_ms,
            })
            continue
          }
          if (json.type === 'done') {
            doneMeta = {
              conversationId: json.conversation_id,
              datasetAttribution: json.dataset_attribution,
              datasetUsed: json.dataset_used,
              tokens: json.tokens ?? 0,
              totalTokensUsed: json.total_tokens_used,
            }
            onDone?.(doneMeta)
            doneCalled = true
            continue
          }
          if (json.error) {
            const msg = json.error?.message || json.error
            onError?.(typeof msg === 'string' ? msg : '对比输出错误')
            return
          }
        } catch {
          /* ignore */
        }
      }
    }
    if (!doneCalled) onDone?.(doneMeta)
  } catch (e) {
    onError?.(e.message || '流中断')
  }
}
