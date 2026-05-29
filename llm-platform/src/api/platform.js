import { getAuthToken, USE_MOCK } from './request'
import { mockApi } from './mock'
import { readPlatformChatStream } from '@/utils/sse'
import request from './request'

const PREFIX = '/api/v1/platform'

export async function listModels() {
  if (USE_MOCK) {
    const { MODELS } = await import('@/constants/models')
    return MODELS
  }
  const res = await request.get(`${PREFIX}/models`)
  const { mapModel } = await import('@/utils/api-mapper')
  return (res.models || []).map(mapModel)
}

/**
 * 流式对话
 * @param {object} body - 与后端 PlatformChatRequest 对齐
 */
export async function streamPlatformChat(body, callbacks) {
  if (USE_MOCK) {
    return mockApi.streamChat({
      modelId: body.model,
      content: body.messages?.filter((m) => m.role === 'user').pop()?.content || '',
      useDataset: body.dataset_enabled,
      datasetIds: body.dataset_ids,
      onChunk: callbacks.onChunk,
      onDone: callbacks.onDone,
      onMeta: callbacks.onMeta,
    })
  }

  const payload = {
    model: body.model,
    messages: body.messages,
    conversation_id: body.conversation_id ?? null,
    temperature: body.temperature,
    max_tokens: body.max_tokens,
    context_window: body.context_window,
    stream: true,
    dataset_enabled: body.dataset_enabled ?? false,
    dataset_ids: body.dataset_ids ?? null,
  }

  const response = await fetch(`${import.meta.env.VITE_API_BASE ?? ''}${PREFIX}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getAuthToken()}`,
    },
    body: JSON.stringify(payload),
  })

  return readPlatformChatStream(response, callbacks)
}

export async function comparePlatformChat(body) {
  if (USE_MOCK) {
    const results = {}
    await mockApi.compareModels({
      modelIds: body.models,
      content: body.messages?.filter((m) => m.role === 'user').pop()?.content || '',
      onModelChunk: (id, text) => {
        results[id] = text
      },
    })
    return {
      results: Object.entries(results).map(([model, content]) => ({
        model,
        content,
        error: null,
        tokens: 0,
        latency_ms: 0,
      })),
      datasetAttribution: body.dataset_enabled ? '本回答基于已确权跨境电商专属数据集生成' : null,
    }
  }

  const res = await request.post(`${PREFIX}/chat/compare`, {
    models: body.models,
    messages: body.messages,
    conversation_id: body.conversation_id ?? null,
    temperature: body.temperature,
    max_tokens: body.max_tokens,
    context_window: body.context_window,
    dataset_enabled: body.dataset_enabled ?? false,
    dataset_ids: body.dataset_ids ?? null,
  })

  return {
    results: res.results || [],
    datasetAttribution: res.dataset_attribution,
    conversationId: res.conversation_id,
  }
}
