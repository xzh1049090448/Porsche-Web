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
import { useLocaleStore } from './locale'
import { purgeConversationFromLocal } from '@/utils/conversation-cache'
import {
  applyConversationGuid,
  removeConversationByGuid,
  upsertConversationByGuid,
} from '@/utils/conversation-state'
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
    return conversations.value.find((c) => c.guid === activeId.value) || null
  }

  /** 对比流式：显式更新 store 中的消息，确保界面逐字刷新 */
  function patchCompareReply(conv, msgId, model, delta) {
    if (!delta) return
    const conversationGuid = conv.guid
    const cIdx = conversations.value.findIndex((c) => c.guid === conversationGuid)
    if (cIdx < 0) return
    const msgs = conversations.value[cIdx].messages || []
    const mIdx = msgs.findIndex((m) => m.localKey === msgId)
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

  /** Records a single compare-model failure without replacing successful siblings. */
  function markCompareModelFailure(conv, msgId, model, message) {
    const cIdx = conversations.value.findIndex((item) => item.guid === conv.guid)
    if (cIdx < 0) return
    const messages = conversations.value[cIdx].messages || []
    const mIdx = messages.findIndex((messageItem) => messageItem.localKey === msgId)
    if (mIdx < 0) return
    const current = messages[mIdx]
    const replies = { ...(current.replies || {}) }
    if (!replies[model]) replies[model] = `${useLocaleStore().t('chat.errorPrefix')} ${message}`
    const nextMessages = [...messages]
    nextMessages[mIdx] = { ...current, replies }
    conversations.value[cIdx] = { ...conversations.value[cIdx], messages: nextMessages }
  }

  /** 刷新后保留已流式展示的 replies（避免服务端一次性覆盖导致“突然整段出现”） */
  function mergeLastMultiModelReplies(conversationGuid, msgId, localReplies) {
    if (!localReplies || !Object.keys(localReplies).length) return
    const cIdx = conversations.value.findIndex((c) => c.guid === conversationGuid)
    if (cIdx < 0) return
    const msgs = conversations.value[cIdx].messages || []
    const mIdx = msgs.findIndex((m) => m.localKey === msgId)
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
        if (!getActive() && items.length) {
          activeId.value = items[0].guid
        }
        if (!USE_MOCK && activeId.value) {
          await refreshActiveConversation()
        }
      } finally {
        loading.value = false
        conversationsLoadPromise = null
      }
    })()
    return conversationsLoadPromise
  }

  async function createConversation(title) {
    const settings = useSettingsStore()
    const localeStore = useLocaleStore()
    const body = {
      title: title || localeStore.t('chat.defaultTitle'),
      model: settings.selectedModelId,
    }
    const conv = await apiCreateConversation(body)
    conversations.value = upsertConversationByGuid(conversations.value, conv)
    activeId.value = conv.guid
    persistLocal()
    return conv
  }

  function selectConversation(conversationGuid) {
    activeId.value = conversationGuid
    persistLocal()
    if (!USE_MOCK) return refreshActiveConversation()
  }

  const conversationDetailPromises = new Map()

  async function refreshActiveConversation() {
    // The user may select another conversation while this request is pending.
    const requestedGuid = activeId.value
    if (!requestedGuid) return
    if (conversationDetailPromises.has(requestedGuid)) {
      return conversationDetailPromises.get(requestedGuid)
    }
    const pending = (async () => {
      try {
        const conv = await getConversation(requestedGuid)
        const idx = conversations.value.findIndex((c) => c.guid === requestedGuid)
        // Do not resurrect a removed conversation or apply a mismatched response.
        if (idx < 0 || conv.guid !== requestedGuid) return
        const local = conversations.value[idx]
        if (local?.messages?.length && (!conv.messages || conv.messages.length < local.messages.length)) {
          conv.messages = local.messages
        }
        conversations.value = upsertConversationByGuid(conversations.value, conv)
        return conv
      } catch (err) {
        if (err?.response?.status === 404) {
          conversations.value = removeConversationByGuid(conversations.value, requestedGuid)
          purgeConversationFromLocal(requestedGuid)
          if (activeId.value === requestedGuid) {
            activeId.value = conversations.value[0]?.guid ?? null
            persistLocal()
            if (!conversations.value.length) {
              await createConversation()
            } else {
              await refreshActiveConversation()
            }
          }
        }
      } finally {
        // Cache only in-flight work: a failed detail must remain retryable.
        conversationDetailPromises.delete(requestedGuid)
      }
    })()
    conversationDetailPromises.set(requestedGuid, pending)
    return pending
  }

  async function renameConversation(conversationGuid, title) {
    await updateConversationTitle(conversationGuid, title)
    const c = conversations.value.find((x) => x.guid === conversationGuid)
    if (c) {
      c.title = title
      c.updatedAt = Date.now()
    }
    persistLocal()
  }

  async function deleteConversation(conversationGuid) {
    if (streaming.value) {
      throw new Error(useLocaleStore().t('chat.streamingDeleteWarn'))
    }

    await apiDeleteConversation(conversationGuid)

    conversations.value = removeConversationByGuid(conversations.value, conversationGuid)
    purgeConversationFromLocal(conversationGuid)

    if (activeId.value === conversationGuid) {
      activeId.value = conversations.value[0]?.guid ?? null
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
        activeId.value = conversations.value[0].guid
        persistLocal()
      }
    }
    // A send can arrive while initial history is still loading. Wait for the
    // current selection's existing request, then re-check if selection changed.
    while (conversationDetailPromises.has(activeId.value)) {
      await conversationDetailPromises.get(activeId.value)
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
      const localeStore = useLocaleStore()
      ElMessage.warning(localeStore.t('chat.compareNoImage'))
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
      localKey: genLocalId(),
      role: 'user',
      content: userContent,
      images,
      createdAt: Date.now(),
    }
    if (!conv.messages) conv.messages = []
    conv.messages.push(userMsg)
    if (conv.messages.filter((m) => m.role === 'user').length === 1) {
      conv.title = userContent.slice(0, 24) || useLocaleStore().t('chat.defaultTitle')
    }
    conv.updatedAt = Date.now()
    persistLocal()

    if (settings.compareMode) {
      return sendCompareMode(userContent, conv)
    }

    const assistantMsg = {
      localKey: genLocalId(),
      role: 'assistant',
      content: '',
      createdAt: Date.now(),
    }
    conv.messages.push(assistantMsg)

    let conversationGuid = typeof conv.guid === 'string' && conv.guid.trim() ? conv.guid : null
    let streamFailed = false

    try {
      await streamPlatformChat(
        {
          model: settings.selectedModelId,
          messages: buildMessagesForApi(conv, userContent),
          conversationGuid,
          temperature: settings.modelParams.temperature,
          max_tokens: settings.modelParams.maxTokens,
          context_window: settings.modelParams.contextWindow,
        },
        {
          onMeta(meta) {
            if (meta.conversationGuid != null) {
              conversationGuid = meta.conversationGuid
              if (conv.guid !== meta.conversationGuid) {
                Object.assign(conv, applyConversationGuid(conv, meta.conversationGuid))
                activeId.value = meta.conversationGuid
              }
            }
          },
          onChunk(ch) {
            assistantMsg.content += ch
          },
          onDone(meta) {
            if (meta?.tokens != null) {
              assistantMsg.tokens = meta.tokens
            }
            useUserStore().applyTokensUsed(meta?.tokens ?? 0, meta?.totalTokensUsed)
          },
          onError(msg) {
            streamFailed = true
            assistantMsg.content += `\n\n${useLocaleStore().t('chat.errorPrefix')} ${msg}`
          },
        }
      )
      if (!USE_MOCK && conversationGuid && !streamFailed) {
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
      localKey: genLocalId(),
      role: 'assistant',
      multiModel: true,
      models: modelIds,
      replies: Object.fromEntries(modelIds.map((id) => [id, ''])),
      createdAt: Date.now(),
    }
    conv.messages.push(assistantMsg)

    let conversationGuid = typeof conv.guid === 'string' && conv.guid.trim() ? conv.guid : null
    let compareFailed = false

    try {
      await comparePlatformChat(
        {
          models: modelIds,
          messages: buildMessagesForApi(conv, content),
          conversationGuid,
          temperature: settings.modelParams.temperature,
          max_tokens: settings.modelParams.maxTokens,
          context_window: settings.modelParams.contextWindow,
        },
        {
          onModelChunk({ model, delta }) {
            patchCompareReply(conv, assistantMsg.localKey, model, delta)
          },
          onModelResult(result) {
            if (result?.error) {
              markCompareModelFailure(conv, assistantMsg.localKey, result.model, result.error)
            }
          },
          onDone(meta) {
            if (meta?.conversationGuid != null) {
              conversationGuid = meta.conversationGuid
              if (conv.guid !== meta.conversationGuid) {
                Object.assign(conv, applyConversationGuid(conv, meta.conversationGuid))
                activeId.value = meta.conversationGuid
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
                assistantMsg.replies[id] = `${useLocaleStore().t('chat.errorPrefix')} ${msg}`
              }
            }
          },
        }
      )

      if (!USE_MOCK && conversationGuid && !compareFailed) {
        const cIdx = conversations.value.findIndex((c) => c.guid === conv.guid)
        const mIdx =
          cIdx >= 0
            ? (conversations.value[cIdx].messages || []).findIndex(
                (m) => m.localKey === assistantMsg.localKey
              )
            : -1
        const streamedReplies =
          cIdx >= 0 && mIdx >= 0
            ? { ...(conversations.value[cIdx].messages[mIdx].replies || {}) }
            : { ...assistantMsg.replies }
        await refreshActiveConversation()
        mergeLastMultiModelReplies(conv.guid, assistantMsg.localKey, streamedReplies)
      }
    } catch (err) {
      const msg = useLocaleStore().t('chat.compareFailed')
      const next = { ...assistantMsg.replies }
      for (const id of modelIds) {
        next[id] = `${useLocaleStore().t('chat.errorPrefix')} ${msg}`
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
