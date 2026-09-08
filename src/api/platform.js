import { createStreamScope } from './stream-scope'
import { authenticatedFetch, USE_MOCK, authSession } from './request'
import { mockApi } from './mock'
import { readPlatformChatStream, readPlatformCompareStream } from '@/utils/sse'
import request from './request'
import { catalogModels } from '@/utils/model-catalog'
import { optionalGuid } from './guid'
import { getPlatformModelDetail } from './platform-model-detail'

const PREFIX = '/api/v1/platform'

export async function listModels() {
  if (USE_MOCK) {
    return { models: await mockApi.listModels(), catalogStale: false }
  }
  const res = await request.get(`${PREFIX}/models`)
  return { models: catalogModels(res), catalogStale: res?.catalog_stale === true }
}

/** Reads an authorized model detail from the local platform API. */
export async function getModel(id) {
  return getPlatformModelDetail(id, request, catalogModels)
}

/**
 * 流式对话
 * @param {object} body - 与后端 PlatformChatRequest 对齐
 */
export async function streamPlatformChat(body, callbacks = {}) {
  const scope = createStreamScope(authSession, callbacks)
  try {
    if (USE_MOCK) return await mockApi.streamChat({
      modelId: body.model,
      content: body.messages?.filter(m => m.role === 'user').pop()?.content || '',
      ...scope.callbacks,
      signal: scope.signal,
    })
    const payload = {
      model: body.model, messages: body.messages,
      conversation_guid: optionalGuid(body.conversationGuid),
      temperature: body.temperature, max_tokens: body.max_tokens, context_window: body.context_window, stream: true,
    }
    const response = await authenticatedFetch(`${import.meta.env.VITE_API_BASE ?? ''}${PREFIX}/chat/completions`, {
      method: 'POST', signal: scope.signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    })
    return await readPlatformChatStream(response, { ...callbacks, signal: scope.signal, isCurrent: scope.isCurrent })
  } finally { scope.cleanup() }
}

/** Existing multi-model comparison shares the same no-replay and terminal policy. */
export async function comparePlatformChat(body, callbacks = {}) {
  const scope = createStreamScope(authSession, callbacks)
  try {
    if (USE_MOCK) {
      await mockApi.compareModels({ modelIds: body.models,
        content: body.messages?.filter(m => m.role === 'user').pop()?.content || '',
        onModelChunk: scope.callbacks.onModelChunk, signal: scope.signal,
      })
      const tokens = Math.ceil((body.messages?.filter(m => m.role === 'user').pop()?.content || '').length * 1.2 * body.models.length)
      scope.callbacks.onDone?.({ tokens })
      return { results: [], conversationGuid: null }
    }
    const payload = {
      models: body.models, messages: body.messages,
      conversation_guid: optionalGuid(body.conversationGuid),
      temperature: body.temperature, max_tokens: body.max_tokens, context_window: body.context_window, stream: true,
    }
    const response = await authenticatedFetch(`${import.meta.env.VITE_API_BASE ?? ''}${PREFIX}/chat/compare`, {
      method: 'POST', signal: scope.signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    })
    const results = []
    await readPlatformCompareStream(response, { ...callbacks, signal: scope.signal, isCurrent: scope.isCurrent,
      onModelResult(result) { results.push(result); callbacks.onModelResult?.(result) },
    })
    return { results, conversationGuid: null }
  } finally { scope.cleanup() }
}
