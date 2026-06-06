import { getAuthToken, USE_MOCK } from './request'
import { mockApi } from './mock'
import { readPlatformChatStream, readPlatformCompareStream } from '@/utils/sse'
import request from './request'

const PREFIX = '/api/v1/platform'

export async function listModels() {
  if (USE_MOCK) {
    const { MODELS } = await import('@/constants/models')
    return MODELS.map((m) => ({ ...m, registered: true }))
  }
  const res = await request.get(`${PREFIX}/models`)
  const { mapModel } = await import('@/utils/api-mapper')
  const rawList = Array.isArray(res) ? res : (res.models || res.items || [])
  return rawList.map(mapModel)
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
    dataset_enabled: false,
    dataset_ids: null,
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

/**
 * 多模型对比（SSE：各模型并行流式输出）
 */
export async function comparePlatformChat(body, callbacks = {}) {
  if (USE_MOCK) {
    await mockApi.compareModels({
      modelIds: body.models,
      content: body.messages?.filter((m) => m.role === 'user').pop()?.content || '',
      onModelChunk: (payload) => callbacks.onModelChunk?.(payload),
    })
    const estTokens = Math.ceil((body.messages?.filter((m) => m.role === 'user').pop()?.content || '').length * 1.2 * body.models.length)
    callbacks.onDone?.({
      tokens: estTokens,
    })
    return { results: [], conversationId: null }
  }

  const payload = {
    models: body.models,
    messages: body.messages,
    conversation_id: body.conversation_id ?? null,
    temperature: body.temperature,
    max_tokens: body.max_tokens,
    context_window: body.context_window,
    stream: true,
    dataset_enabled: false,
    dataset_ids: null,
  }

  const response = await fetch(`${import.meta.env.VITE_API_BASE ?? ''}${PREFIX}/chat/compare`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getAuthToken()}`,
    },
    body: JSON.stringify(payload),
  })

  const results = []
  await readPlatformCompareStream(response, {
    onModelChunk: callbacks.onModelChunk,
    onModelResult(r) {
      results.push(r)
      callbacks.onModelResult?.(r)
    },
    onDone: callbacks.onDone,
    onError: callbacks.onError,
  })

  return {
    results,
    conversationId: null,
  }
}
