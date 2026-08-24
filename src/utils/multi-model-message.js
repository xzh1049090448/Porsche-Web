/** 多模型回复在单条 assistant 消息中的编码格式（与后端约定） */

export const MULTI_MODEL_MARKER = '__MULTI_MODEL__'

export function encodeMultiModelReplies(replies) {
  return MULTI_MODEL_MARKER + JSON.stringify(replies)
}

export function decodeMultiModelReplies(content) {
  if (!content || !content.startsWith(MULTI_MODEL_MARKER)) return null
  try {
    const data = JSON.parse(content.slice(MULTI_MODEL_MARKER.length))
    if (data && typeof data === 'object') {
      return Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)]))
    }
  } catch {
    return null
  }
  return null
}

export function toApiMessageContent(msg) {
  if (msg.multiModel && msg.replies) {
    return encodeMultiModelReplies(msg.replies)
  }
  return msg.content
}

export function enrichMessage(msg) {
  const replies = decodeMultiModelReplies(msg.content)
  if (!replies) return msg
  return {
    ...msg,
    multiModel: true,
    models: Object.keys(replies),
    replies,
  }
}
