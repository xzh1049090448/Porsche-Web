import request, { authenticatedFetch, USE_MOCK } from './request'
import { mockApi } from './mock'
import { mapConversation } from '@/utils/platform-mappers'
import { requiredGuid } from './guid'

const PREFIX = '/api/v1/conversations'

export async function listConversations(params = {}) {
  if (USE_MOCK) return mockApi.listConversations(params)
  const res = await request.get(PREFIX, { params })
  return {
    items: (res.items || []).map(mapConversation),
    total: res.total,
  }
}

export async function createConversation(body) {
  if (USE_MOCK) return mockApi.createConversation(body)
  const raw = await request.post(PREFIX, {
    title: body.title,
    model: body.model,
  })
  return mapConversation(raw)
}

export async function getConversation(guid) {
  const conversationGuid = requiredGuid(guid, 'conversation GUID')
  if (USE_MOCK) return mockApi.getConversation(conversationGuid)
  const raw = await request.get(`${PREFIX}/${encodeURIComponent(conversationGuid)}`)
  return mapConversation(raw)
}

export async function updateConversationTitle(guid, title) {
  const conversationGuid = requiredGuid(guid, 'conversation GUID')
  if (USE_MOCK) return mockApi.renameConversation(conversationGuid, title)
  const raw = await request.put(`${PREFIX}/${encodeURIComponent(conversationGuid)}`, { title })
  return mapConversation(raw)
}

export async function deleteConversation(guid) {
  const conversationGuid = requiredGuid(guid, 'conversation GUID')
  if (USE_MOCK) return mockApi.deleteConversation(conversationGuid)
  return request.delete(`${PREFIX}/${encodeURIComponent(conversationGuid)}`)
}

export async function exportConversationMarkdown(guid) {
  const conversationGuid = requiredGuid(guid, 'conversation GUID')
  if (USE_MOCK) {
    const conv = await mockApi.getConversation(conversationGuid)
    const { exportToMarkdown } = await import('@/utils/export')
    return exportToMarkdown(conv)
  }
  const res = await authenticatedFetch(`${import.meta.env.VITE_API_BASE ?? ''}${PREFIX}/${encodeURIComponent(conversationGuid)}/export/markdown`, {
    headers: {},
  })
  if (!res.ok) {
    const { useLocaleStore } = await import('@/stores/locale')
    throw new Error(useLocaleStore().t('chat.exportFailed'))
  }
  return res.text()
}
