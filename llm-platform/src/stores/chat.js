import { defineStore } from 'pinia'
import { ref } from 'vue'
import { getItem, setItem, removeItem } from '@/utils/storage'
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
import { useUserStore } from './user'
import { DATASET_BADGE_TEXT } from '@/constants/datasets'
import { purgeConversationFromLocal } from '@/utils/conversation-cache'
import { toApiMessageContent } from '@/utils/multi-model-message'

function genLocalId() {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
}

export const useChatStore = defineStore('chat', () => {
  const conversations = ref(USE_MOCK ? getItem('conversations', []) : [])
  const activeId = ref(USE_MOCK ? getItem('activeConversation', null) : null)
  const streaming = ref(false)
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

  /** 对比流式：显式更新 store 中的消息，确保界面逐字刷新 */
  function patchCompareReply(conv, msgId, model, delta) {
    if (!delta) return
    const convId = conv.id
    const cIdx = conversations.value.findIndex((c) => c.id === convId)
    if (cIdx < 0) return
    const msgs = conversations.value[cIdx].messages || []
    const mIdx = msgs.findIndex((m) => m.id === msgId)
    if (mIdx < 0) return
    const msg = msgs[mIdx]
    const replies = { ...(msg.replies || {}) }
    replies[model] = (replies[model] ?? '') + delta
    const nextMsgs = [...msgs]
    nextMsgs[mIdx] = { ...msg, replies }
    conversations.value[cIdx] = {
      ...conversations.value[cIdx],
      messages: nextMsgs,
    }
  }

  /** 刷新后保留已流式展示的 replies（避免服务端一次性覆盖导致“突然整段出现”） */
  function mergeLastMultiModelReplies(convId, msgId, localReplies) {
    if (!localReplies || !Object.keys(localReplies).length) return
    const cIdx = conversations.value.findIndex((c) => c.id === convId)
    if (cIdx < 0) return
    const msgs = conversations.value[cIdx].messages || []
    const mIdx = msgs.findIndex((m) => m.id === msgId)
    if (mIdx < 0) return
    const msg = msgs[mIdx]
    if (!msg.multiModel) return
    const merged = { ...(msg.replies || {}) }
    for (const [model, text] of Object.entries(localReplies)) {
      const local = text || ''
      const remote = merged[model] || ''
      if (local.length >= remote.length) {
        merged[model] = local
      }
    }
    const nextMsgs = [...msgs]
    nextMsgs[mIdx] = { ...msg, replies: merged }
    conversations.value[cIdx] = {
      ...conversations.value[cIdx],
      messages: nextMsgs,
    }
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
    } catch (err) {
      if (err?.response?.status === 404) {
        const deletedId = activeId.value
        conversations.value = conversations.value.filter((c) => c.id !== deletedId)
        purgeConversationFromLocal(deletedId)
        activeId.value = conversations.value[0]?.id ?? null
        persistLocal()
        if (!conversations.value.length) {
          await createConversation()
        }
      }
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
    if (streaming.value) {
      throw new Error('正在生成回复，请稍后再删除')
    }

    await apiDeleteConversation(id)

    conversations.value = conversations.value.filter((c) => c.id !== id)
    purgeConversationFromLocal(id)

    if (activeId.value === id) {
      activeId.value = conversations.value[0]?.id ?? null
      if (!activeId.value) {
        removeItem('activeConversation')
      }
    }

    persistLocal()

    if (!conversations.value.length) {
      await createConversation()
    } else if (activeId.value) {
      persistLocal()
    }
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
      content: toApiMessageContent(m),
    }))
    const last = history[history.length - 1]
    if (!(last?.role === 'user' && last.content === userContent)) {
      history.push({ role: 'user', content: userContent })
    }
    return history
  }

  async function sendMessage(content, images = []) {
    if (!content.trim() && !images.length) return
    if (streaming.value) return

    const settings = useSettingsStore()
    if (settings.compareMode && images.length) {
      const { ElMessage } = await import('element-plus')
      ElMessage.warning('模型对比模式下不支持上传图片')
      return
    }

    streaming.value = true

    let conv
    try {
      conv = await ensureActive()
    } catch {
      streaming.value = false
      return
    }

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
      return sendCompareMode(userContent, conv)
    }

    const assistantMsg = {
      id: genLocalId(),
      role: 'assistant',
      content: '',
      createdAt: Date.now(),
      datasetUsed: false,
    }
    conv.messages.push(assistantMsg)

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
            if (meta?.tokens != null) {
              assistantMsg.tokens = meta.tokens
            }
            useUserStore().applyTokensUsed(meta?.tokens ?? 0, meta?.totalTokensUsed)
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

  async function sendCompareMode(content, conv) {
    const settings = useSettingsStore()
    const modelIds = [...settings.compareModelIds]

    const assistantMsg = {
      id: genLocalId(),
      role: 'assistant',
      multiModel: true,
      models: modelIds,
      replies: Object.fromEntries(modelIds.map((id) => [id, ''])),
      createdAt: Date.now(),
      datasetUsed: false,
    }
    conv.messages.push(assistantMsg)

    let conversationId = typeof conv.id === 'number' ? conv.id : null
    let compareFailed = false

    try {
      await comparePlatformChat(
        {
          models: modelIds,
          messages: buildMessagesForApi(conv, content),
          conversation_id: conversationId,
          temperature: settings.modelParams.temperature,
          max_tokens: settings.modelParams.maxTokens,
          context_window: settings.modelParams.contextWindow,
          dataset_enabled: settings.useDataset,
          dataset_ids: settings.useDataset ? settings.selectedDatasetIds : null,
        },
        {
          onModelChunk({ model, delta }) {
            patchCompareReply(conv, assistantMsg.id, model, delta)
          },
          onDone(meta) {
            if (meta?.datasetUsed || meta?.datasetAttribution) {
              assistantMsg.datasetUsed = true
              assistantMsg.datasetBadge =
                meta.datasetAttribution || DATASET_BADGE_TEXT
            }
            if (meta?.conversationId != null) {
              conversationId = meta.conversationId
              if (conv.id !== meta.conversationId) {
                conv.id = meta.conversationId
                activeId.value = meta.conversationId
              }
            }
            if (meta?.tokens != null) {
              assistantMsg.tokens = meta.tokens
            }
            useUserStore().applyTokensUsed(meta?.tokens ?? 0, meta?.totalTokensUsed)
          },
          onError(msg) {
            compareFailed = true
            for (const id of modelIds) {
              if (!assistantMsg.replies[id]) {
                assistantMsg.replies[id] = `[错误] ${msg}`
              }
            }
          },
        }
      )

      if (!USE_MOCK && conversationId && !compareFailed) {
        const cIdx = conversations.value.findIndex((c) => c.id === conv.id)
        const mIdx =
          cIdx >= 0
            ? (conversations.value[cIdx].messages || []).findIndex(
                (m) => m.id === assistantMsg.id
              )
            : -1
        const streamedReplies =
          cIdx >= 0 && mIdx >= 0
            ? { ...(conversations.value[cIdx].messages[mIdx].replies || {}) }
            : { ...assistantMsg.replies }
        await refreshActiveConversation()
        mergeLastMultiModelReplies(conv.id, assistantMsg.id, streamedReplies)
      }
    } catch (err) {
      const msg = err?.response?.data?.detail || err?.message || '对比请求失败'
      const next = { ...assistantMsg.replies }
      for (const id of modelIds) {
        next[id] = `[错误] ${msg}`
      }
      assistantMsg.replies = next
    } finally {
      streaming.value = false
      conv.updatedAt = Date.now()
      persistLocal()
    }
  }

  return {
    conversations,
    activeId,
    streaming,
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
  }
})
