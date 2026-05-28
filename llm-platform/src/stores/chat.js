import { defineStore } from 'pinia'
import { ref } from 'vue'
import { getItem, setItem } from '@/utils/storage'
import { USE_MOCK } from '@/api/request'
import { streamPlatformChat, comparePlatformChat } from '@/api/platform'
import {
  listConversations,
  createConversation as apiCreateConversation,
  getConversation,
  updateConversationTitle,
  deleteConversation as apiDeleteConversation,
} from '@/api/conversations'
import { useSettingsStore } from './settings'
import { DATASET_BADGE_TEXT } from '@/constants/datasets'

function genLocalId() {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
}

export const useChatStore = defineStore('chat', () => {
  const conversations = ref(USE_MOCK ? getItem('conversations', []) : [])
  const activeId = ref(USE_MOCK ? getItem('activeConversation', null) : null)
  const streaming = ref(false)
  const compareResults = ref({})
  const loading = ref(false)

  function persistLocal() {
    if (USE_MOCK) {
      setItem('conversations', conversations.value)
      setItem('activeConversation', activeId.value)
    }
  }

  function getActive() {
    return conversations.value.find((c) => c.id === activeId.value) || null
  }

  let conversationsLoadPromise = null

  async function fetchConversations() {
    if (conversationsLoadPromise) return conversationsLoadPromise
    loading.value = true
    conversationsLoadPromise = (async () => {
      try {
        const { items } = await listConversations({ limit: 100 })
        conversations.value = items
        if (!activeId.value && items.length) {
          activeId.value = items[0].id
        }
      } finally {
        loading.value = false
        conversationsLoadPromise = null
      }
    })()
    return conversationsLoadPromise
  }

  async function createConversation(title = '新对话') {
    const settings = useSettingsStore()
    const body = {
      title,
      model: settings.selectedModelId,
      datasetEnabled: settings.useDataset,
      datasetIds: settings.useDataset ? settings.selectedDatasetIds : null,
    }
    const conv = await apiCreateConversation(body)
    conversations.value.unshift(conv)
    activeId.value = conv.id
    persistLocal()
    return conv
  }

  function selectConversation(id) {
    activeId.value = id
    persistLocal()
    if (!USE_MOCK) refreshActiveConversation()
  }

  async function refreshActiveConversation() {
    if (!activeId.value) return
    try {
      const conv = await getConversation(activeId.value)
      const idx = conversations.value.findIndex((c) => c.id === conv.id)
      const local = idx >= 0 ? conversations.value[idx] : null
      if (local?.messages?.length && (!conv.messages || conv.messages.length < local.messages.length)) {
        conv.messages = local.messages
      }
      if (idx >= 0) conversations.value[idx] = conv
      else conversations.value.unshift(conv)
    } catch {
      /* ignore */
    }
  }

  async function renameConversation(id, title) {
    await updateConversationTitle(id, title)
    const c = conversations.value.find((x) => x.id === id)
    if (c) {
      c.title = title
      c.updatedAt = Date.now()
    }
    persistLocal()
  }

  async function deleteConversation(id) {
    await apiDeleteConversation(id)
    conversations.value = conversations.value.filter((c) => c.id !== id)
    if (activeId.value === id) {
      activeId.value = conversations.value[0]?.id ?? null
    }
    persistLocal()
  }

  async function ensureActive() {
    if (!USE_MOCK && conversations.value.length === 0) {
      await fetchConversations()
    }
    if (!activeId.value || !getActive()) {
      if (conversations.value.length === 0) {
        await createConversation()
      } else {
        activeId.value = conversations.value[0].id
        persistLocal()
      }
    }
    return getActive()
  }

  function buildMessagesForApi(conv, userContent) {
    const history = (conv.messages || []).map((m) => ({
      role: m.role,
      content: m.content,
    }))
    const last = history[history.length - 1]
    if (!(last?.role === 'user' && last.content === userContent)) {
      history.push({ role: 'user', content: userContent })
    }
    return history
  }

  async function sendMessage(content, images = []) {
    const settings = useSettingsStore()
    const conv = await ensureActive()
    if (!content.trim() && !images.length) return

    const userContent = content.trim()
    const userMsg = {
      id: genLocalId(),
      role: 'user',
      content: userContent,
      images,
      createdAt: Date.now(),
    }
    if (!conv.messages) conv.messages = []
    conv.messages.push(userMsg)
    if (conv.messages.filter((m) => m.role === 'user').length === 1) {
      conv.title = userContent.slice(0, 24) || '新对话'
    }
    conv.updatedAt = Date.now()
    persistLocal()

    if (settings.compareMode) {
      return sendCompare(userContent)
    }

    const assistantMsg = {
      id: genLocalId(),
      role: 'assistant',
      content: '',
      createdAt: Date.now(),
      datasetUsed: false,
    }
    conv.messages.push(assistantMsg)
    streaming.value = true

    let conversationId = typeof conv.id === 'number' ? conv.id : null
    let streamFailed = false

    try {
      await streamPlatformChat(
        {
          model: settings.selectedModelId,
          messages: buildMessagesForApi(conv, userContent),
          conversation_id: conversationId,
          temperature: settings.modelParams.temperature,
          max_tokens: settings.modelParams.maxTokens,
          context_window: settings.modelParams.contextWindow,
          dataset_enabled: settings.useDataset,
          dataset_ids: settings.useDataset ? settings.selectedDatasetIds : null,
        },
        {
          onMeta(meta) {
            if (meta.conversationId != null) {
              conversationId = meta.conversationId
              if (conv.id !== meta.conversationId) {
                conv.id = meta.conversationId
                activeId.value = meta.conversationId
              }
            }
            assistantMsg.datasetUsed = meta.datasetUsed
            assistantMsg.datasetBadge = meta.datasetBadge || DATASET_BADGE_TEXT
          },
          onChunk(ch) {
            assistantMsg.content += ch
          },
          onDone(meta) {
            if (meta?.datasetUsed) {
              assistantMsg.datasetUsed = true
              assistantMsg.datasetBadge = meta.datasetBadge || DATASET_BADGE_TEXT
            }
          },
          onError(msg) {
            streamFailed = true
            assistantMsg.content += `\n\n[错误] ${msg}`
          },
        }
      )
      if (!USE_MOCK && conversationId && !streamFailed) {
        await refreshActiveConversation()
      }
    } finally {
      streaming.value = false
      conv.updatedAt = Date.now()
      persistLocal()
    }
  }

  async function sendCompare(content) {
    const settings = useSettingsStore()
    const conv = getActive()
    if (settings.compareModelIds.length < 2) {
      const { ElMessage } = await import('element-plus')
      ElMessage.warning('请至少选择 2 个模型进行对比')
      return
    }
    compareResults.value = {}
    streaming.value = true

    try {
      const { results, datasetAttribution } = await comparePlatformChat({
        models: settings.compareModelIds,
        messages: buildMessagesForApi(conv || { messages: [] }, content),
        temperature: settings.modelParams.temperature,
        max_tokens: settings.modelParams.maxTokens,
        dataset_enabled: settings.useDataset,
        dataset_ids: settings.useDataset ? settings.selectedDatasetIds : null,
      })
      const mapped = {}
      for (const r of results) {
        mapped[r.model] = r.error ? `[错误] ${r.error}` : r.content || ''
      }
      compareResults.value = mapped
      if (datasetAttribution) {
        compareResults.value._attribution = datasetAttribution
      }
    } finally {
      streaming.value = false
    }
  }

  function clearCompare() {
    compareResults.value = {}
  }

  return {
    conversations,
    activeId,
    streaming,
    compareResults,
    loading,
    getActive,
    fetchConversations,
    createConversation,
    selectConversation,
    renameConversation,
    deleteConversation,
    ensureActive,
    refreshActiveConversation,
    sendMessage,
    clearCompare,
  }
})
