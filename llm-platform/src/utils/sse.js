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
    onDone?.(meta)
  } catch (e) {
    onError?.(e.message || '流中断')
  }
}
