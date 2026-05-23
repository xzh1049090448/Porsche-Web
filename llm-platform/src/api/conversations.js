import request, { USE_MOCK } from './request'
import { mockApi } from './mock'
import { mapConversation } from '@/utils/api-mapper'

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
    dataset_enabled: body.datasetEnabled,
    dataset_ids: body.datasetIds,
  })
  return mapConversation(raw)
}

export async function getConversation(id) {
  if (USE_MOCK) return mockApi.getConversation(id)
  const raw = await request.get(`${PREFIX}/${id}`)
  return mapConversation(raw)
}

export async function updateConversationTitle(id, title) {
  if (USE_MOCK) return mockApi.renameConversation(id, title)
  const raw = await request.put(`${PREFIX}/${id}`, { title })
  return mapConversation(raw)
}

export async function deleteConversation(id) {
  if (USE_MOCK) return mockApi.deleteConversation(id)
  return request.delete(`${PREFIX}/${id}`)
}

export async function exportConversationMarkdown(id) {
  if (USE_MOCK) {
    const conv = await mockApi.getConversation(id)
    const { exportToMarkdown } = await import('@/utils/export')
    return exportToMarkdown(conv)
  }
  const res = await fetch(`${import.meta.env.VITE_API_BASE ?? ''}${PREFIX}/${id}/export/markdown`, {
    headers: {
      Authorization: `Bearer ${(await import('@/utils/storage')).getItem('token')}`,
    },
  })
  if (!res.ok) throw new Error('导出失败')
  return res.text()
}
