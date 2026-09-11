import { createStreamScope } from './stream-scope'
import { USE_MOCK, authSession } from './request'
import { mockApi } from './mock'
import request from './request'
import { catalogModels } from '@/utils/model-catalog'
import { getPlatformModelDetail } from './platform-model-detail'
import {
  PlatformGenerationIndeterminateError,
  streamPlatformCompareGeneration,
  streamPlatformGeneration,
} from './platform-generation'

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
    return await streamPlatformGeneration(body, {
      signal: scope.signal,
      onEvent(event) {
        if (event.type === 'meta') scope.callbacks.onMeta?.({ conversationGuid: event.conversation_guid, generationId: event.generation_id, models: event.models })
        else if (event.type === 'delta') scope.callbacks.onChunk?.(event.delta)
        else if (event.type === 'done') scope.callbacks.onDone?.({ conversationGuid: event.conversation_guid, generationId: event.generation_id, tokens: event.tokens, totalTokensUsed: event.total_tokens_used })
      },
    })
  } catch (error) {
    if (error instanceof PlatformGenerationIndeterminateError && error.reason === 'aborted') scope.callbacks.onCancel?.({ generationId: error.generation_id })
    else scope.callbacks.onError?.(error.code || 'generation_indeterminate', { generationId: error.generation_id })
    throw error
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
    return await streamPlatformCompareGeneration({ ...body, model: body.model ?? body.models?.[0] }, {
      signal: scope.signal,
      onEvent(event) {
        if (event.type === 'meta') scope.callbacks.onMeta?.({ conversationGuid: event.conversation_guid, generationId: event.generation_id, models: event.models })
        else if (event.type === 'delta') scope.callbacks.onModelChunk?.({ model: event.model, delta: event.delta })
        else if (event.type === 'model_done') {
          const result = { model: event.model }
          scope.callbacks.onModelResult?.(result)
        } else if (event.type === 'model_error') {
          const result = { model: event.model, code: event.code, error: event.code }
          scope.callbacks.onModelResult?.(result)
        } else if (event.type === 'done') scope.callbacks.onDone?.({ conversationGuid: event.conversation_guid, generationId: event.generation_id, tokens: event.total_tokens_used, totalTokensUsed: event.total_tokens_used, models: event.models })
      },
    })
  } catch (error) {
    if (error instanceof PlatformGenerationIndeterminateError && error.reason === 'aborted') scope.callbacks.onCancel?.({ generationId: error.generation_id })
    else scope.callbacks.onError?.(error.code || 'generation_indeterminate', { generationId: error.generation_id })
    throw error
  } finally { scope.cleanup() }
}
