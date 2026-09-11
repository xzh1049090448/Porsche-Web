import { defineStore } from 'pinia'
import { ref } from 'vue'
import { getItem, setItem, removeItem } from '@/utils/storage'
import { USE_MOCK, authSession } from '@/api/request'
import { mockApi } from '@/api/mock'
import {
  PlatformGenerationIndeterminateError,
  cancelPlatformGeneration,
  createPlatformGenerationId,
  pollPlatformGeneration,
  streamPlatformCompareGeneration,
  streamPlatformGeneration,
} from '@/api/platform-generation'
import { createChatGeneration } from '@/utils/chat-generation'
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
import { removeConversationByGuid, upsertConversationByGuid } from '@/utils/conversation-state'
import { toApiMessageContent } from '@/utils/multi-model-message'

function genLocalId() {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
}

const ACTIVE_GENERATION_KEY = 'llm_platform_active_generation_v2'

export const useChatStore = defineStore('chat', () => {
  const conversations = ref(USE_MOCK ? getItem('conversations', []) : [])
  const activeId = ref(USE_MOCK ? getItem('activeConversation', null) : null)
  const streaming = ref(false)
  const loading = ref(false)
  const generationState = ref(null)
  const conversationDetailPromises = new Map()
  let streamController = null
  let activeRun = null
  const canonicalConversationGuid = value => {
    if (typeof value !== 'string' || !/^[1-9][0-9]*$/.test(value)) return null
    try { return BigInt(value) <= 9223372036854775807n ? value : null } catch { return null }
  }
  const conversationKey = conversation => conversation?.guid || conversation?.localKey || null
  function rememberRun(run) {
    try {
      globalThis.sessionStorage?.setItem(ACTIVE_GENERATION_KEY, JSON.stringify({ generationId: run.generationId, mode: run.mode, models: run.models, conversationGuid: canonicalConversationGuid(run.conv.guid), messageKey: run.assistant.localKey }))
    } catch { /* Metadata is best-effort and deliberately excludes generated content. */ }
  }
  function forgetRun() {
    try { globalThis.sessionStorage?.removeItem(ACTIVE_GENERATION_KEY) } catch { /* Ignore unavailable session storage. */ }
  }
  function invalidateActiveRun() {
    const run = activeRun
    activeRun = null
    run?.controller?.abort()
    run?.recoveryController?.abort()
    streamController = null
    run?.machine?.dispose()
    generationState.value = null
    forgetRun()
  }
  authSession.onInvalidate(() => {
    invalidateActiveRun()
    conversations.value = []; activeId.value = null
    streaming.value = false; loading.value = false
    conversationsLoadPromise = null
    conversationDetailPromises.clear()
    try { removeItem('conversations'); removeItem('activeConversation') } catch { /* Authentication core handles unavailable storage. */ }
  })

  function persistLocal() {
    if (USE_MOCK) {
      setItem('conversations', conversations.value)
      setItem('activeConversation', activeId.value)
    }
  }

  function getActive() {
    return conversations.value.find((c) => conversationKey(c) === activeId.value) || null
  }

  let conversationsLoadPromise = null

  async function fetchConversations() {
    if (conversationsLoadPromise) return conversationsLoadPromise
    loading.value = true
    const context = authSession.capture()
    conversationsLoadPromise = (async () => {
      try {
        const { items } = await listConversations({ limit: 100 })
        authSession.assertCurrent(context)
        conversations.value = items
        if (!getActive() && items.length) {
          activeId.value = items[0].guid
        }
        if (!USE_MOCK && activeId.value) {
          await refreshActiveConversation()
        }
      } finally {
        if (authSession.capture().epoch !== context.epoch) return
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

  async function refreshActiveConversation() {
    // The user may select another conversation while this request is pending.
    const context = authSession.capture()
    const requestedGuid = activeId.value
    if (!requestedGuid) return
    if (conversationDetailPromises.has(requestedGuid)) {
      return conversationDetailPromises.get(requestedGuid)
    }
    const pending = (async () => {
      try {
        const conv = await getConversation(requestedGuid)
        authSession.assertCurrent(context)
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
        if (authSession.capture().epoch !== context.epoch) return
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
        if (conversationDetailPromises.get(requestedGuid) === pending) conversationDetailPromises.delete(requestedGuid)
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
    const context = authSession.capture()
    if (!USE_MOCK && conversations.value.length === 0) {
      await fetchConversations()
      authSession.assertCurrent(context)
    }
    if (!activeId.value || !getActive()) {
      if (conversations.value.length === 0) {
        await createConversation()
        authSession.assertCurrent(context)
      } else {
        activeId.value = conversations.value[0].guid
        persistLocal()
      }
    }
    // A send can arrive while initial history is still loading. Wait for the
    // current selection's existing request, then re-check if selection changed.
    while (conversationDetailPromises.has(activeId.value)) {
      await conversationDetailPromises.get(activeId.value)
      authSession.assertCurrent(context)
    }
    authSession.assertCurrent(context)
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

  function runIsCurrent(run) {
    if (activeRun !== run || authSession.capture().epoch !== run.context.epoch) return false
    const currentUser = authSession.user()?.guid ?? null
    return currentUser === run.userGuid
  }

  function setGenerationPhase(run, status, snapshot = run.machine?.snapshot()) {
    if (!runIsCurrent(run)) return
    generationState.value = {
      generationId: run.generationId,
      status,
      mode: run.mode,
      conversationGuid: snapshot?.conversationGuid ?? null,
      models: snapshot?.models?.map(model => ({ ...model })) ?? [],
      diagnostics: snapshot?.diagnostics?.map(item => ({ ...item })) ?? [],
    }
    run.assistant.generationStatus = status
  }

  function bindRunConversation(run, value) {
    const guid = canonicalConversationGuid(value)
    if (!guid) return false
    const current = canonicalConversationGuid(run.conv.guid)
    if (current && current !== guid) return false
    if (!current) {
      run.conv.guid = guid
      if (activeId.value === run.conversationKey) activeId.value = guid
      run.conversationKey = guid
      rememberRun(run)
    }
    return true
  }

  function commitCompleted(run, snapshot) {
    if (run.committed || !runIsCurrent(run)) return
    run.committed = true
    forgetRun()
    run.assistant.generationStatus = 'completed'
    run.assistant.viewOnly = false
    const resultTokens = run.mode === 'single'
      ? run.terminalMeta?.result?.tokens
      : run.terminalMeta?.results?.reduce((sum, result) => sum + (result.status === 'completed' ? result.tokens : 0), 0)
        ?? (run.terminalMeta?.models ? Object.values(run.terminalMeta.models).reduce((sum, result) => sum + (result.status === 'completed' ? result.tokens : 0), 0) : undefined)
    const tokens = run.terminalMeta?.tokens ?? resultTokens ?? 0
    run.assistant.tokens = tokens
    useUserStore().applyTokensUsed(tokens, run.terminalMeta?.total_tokens_used)
    run.conv.updatedAt = Date.now()
    streaming.value = false
    persistLocal()
    setGenerationPhase(run, 'completed', snapshot)
  }

  function applyMachineSnapshot(run, snapshot) {
    if (!runIsCurrent(run)) return
    if (snapshot.conversationGuid && !bindRunConversation(run, snapshot.conversationGuid)) {
      snapshot = run.machine.fail('GENERATION_CONVERSATION_ERROR')
    }
    if (run.mode === 'single') {
      run.assistant.content = snapshot.models[0]?.displayedText ?? ''
      run.assistant.modelStatus = snapshot.models[0]?.terminal || snapshot.status
      run.assistant.errorCode = snapshot.models[0]?.code || null
    } else {
      run.assistant.replies = Object.fromEntries(snapshot.models.map(item => [item.model, item.displayedText]))
      run.assistant.modelStates = Object.fromEntries(snapshot.models.map(item => [item.model, { status: item.terminal || snapshot.status, code: item.code || null }]))
    }
    if (snapshot.status === 'completed') return commitCompleted(run, snapshot)
    if (snapshot.status === 'failed' || snapshot.status === 'cancelled') {
      forgetRun()
      run.assistant.viewOnly = true
      streaming.value = false
      return setGenerationPhase(run, snapshot.status, snapshot)
    }
    const phase = snapshot.status === 'waiting' ? 'starting' : snapshot.status === 'receiving' || snapshot.status === 'draining' ? 'streaming' : snapshot.status
    setGenerationPhase(run, phase, snapshot)
  }

  async function recoverGeneration(run) {
    if (!runIsCurrent(run) || run.cancelRequested) return
    setGenerationPhase(run, 'disconnected')
    setGenerationPhase(run, 'recovering')
    run.recoveryController = new AbortController()
    try {
      const result = await pollPlatformGeneration(run.generationId, { models: run.models, signal: run.recoveryController.signal })
      if (!runIsCurrent(run) || run.cancelRequested) return
      run.terminalMeta = result
      const snapshot = run.machine.resolveStatus(result)
      applyMachineSnapshot(run, snapshot)
    } catch (error) {
      if (!runIsCurrent(run)) return
      const snapshot = run.machine.fail(error?.status === 403 || error?.status === 404 ? 'GENERATION_OWNER_ERROR' : 'GENERATION_RECOVERY_ERROR')
      applyMachineSnapshot(run, snapshot)
    }
  }

  async function executeGeneration(run, body) {
    if (USE_MOCK) {
      const sequence = Object.fromEntries(run.models.map(model => [model, 0]))
      const apply = event => applyMachineSnapshot(run, run.machine.handleEvent({ generation_id: run.generationId, ...event }))
      apply({ type: 'meta', conversation_guid: run.conv.guid, models: run.models })
      if (run.mode === 'single') {
        await mockApi.streamChat({
          modelId: run.models[0], content: body.messages?.at(-1)?.content || '', signal: run.controller.signal,
          onChunk(delta) { sequence[run.models[0]] += 1; apply({ type: 'delta', model: run.models[0], seq: sequence[run.models[0]], delta }) },
          onDone(meta) {
            apply({ type: 'model_done', model: run.models[0], last_seq: sequence[run.models[0]] })
            run.terminalMeta = { tokens: meta.tokens, total_tokens_used: meta.totalTokensUsed }
            apply({ type: 'done', status: 'completed', conversation_guid: run.conv.guid, tokens: meta.tokens, total_tokens_used: meta.totalTokensUsed })
          },
        })
      } else {
        await mockApi.compareModels({ modelIds: run.models, content: body.messages?.at(-1)?.content || '', signal: run.controller.signal, onModelChunk({ model, delta }) { sequence[model] += 1; apply({ type: 'delta', model, seq: sequence[model], delta }) } })
        if (!run.cancelRequested) {
          for (const model of run.models) apply({ type: 'model_done', model, last_seq: sequence[model] })
          const models = Object.fromEntries(run.models.map(model => [model, { status: 'completed', tokens: 0 }]))
          run.terminalMeta = { total_tokens_used: 0 }
          apply({ type: 'done', status: 'completed', conversation_guid: run.conv.guid, total_tokens_used: 0, models })
        }
      }
      return
    }
    const stream = run.mode === 'compare' ? streamPlatformCompareGeneration : streamPlatformGeneration
    try {
      await stream(body, {
        generationId: run.generationId,
        signal: run.controller.signal,
        onEvent(event) {
          if (!runIsCurrent(run)) return
          const normalized = event.generation_id ? event : { ...event, generation_id: run.generationId }
          if (event.type === 'done') run.terminalMeta = event
          const snapshot = run.machine.handleEvent(normalized)
          applyMachineSnapshot(run, snapshot)
        },
      })
    } catch (error) {
      if (!runIsCurrent(run) || run.cancelRequested) return
      if (error instanceof PlatformGenerationIndeterminateError || error?.code === 'generation_indeterminate') return recoverGeneration(run)
      const snapshot = run.machine.fail('GENERATION_TRANSPORT_ERROR')
      applyMachineSnapshot(run, snapshot)
    }
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
    const context = authSession.capture()
    streamController = new AbortController()

    let conv
    try {
      conv = await ensureActive()
      authSession.assertCurrent(context)
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

    const mode = settings.compareMode ? 'compare' : 'single'
    const modelIds = mode === 'compare' ? [...settings.compareModelIds] : [settings.selectedModelId]
    const assistantMsg = {
      localKey: genLocalId(),
      role: 'assistant',
      ...(mode === 'single' ? { content: '' } : { multiModel: true, models: modelIds, replies: Object.fromEntries(modelIds.map(id => [id, ''])), modelStates: Object.fromEntries(modelIds.map(id => [id, { status: 'starting', code: null }])) }),
      generationStatus: 'starting',
      viewOnly: true,
      createdAt: Date.now(),
    }
    conv.messages.push(assistantMsg)
    const generationId = createPlatformGenerationId()
    const run = {
      generationId, mode, models: modelIds, context,
      userGuid: authSession.user()?.guid ?? null,
      conv, conversationKey: conversationKey(conv), assistant: assistantMsg,
      controller: streamController, recoveryController: null,
      committed: false, cancelRequested: false, terminalMeta: null, machine: null,
    }
    invalidateActiveRun()
    activeRun = run
    streamController = run.controller
    rememberRun(run)
    run.machine = createChatGeneration({
      generationId,
      conversationGuid: canonicalConversationGuid(conv.guid),
      messageKey: assistantMsg.localKey,
      mode,
      models: modelIds,
      onChange: snapshot => applyMachineSnapshot(run, snapshot),
    })
    applyMachineSnapshot(run, run.machine.snapshot())
    const body = {
      model: modelIds[0],
      ...(mode === 'compare' ? { models: modelIds } : {}),
      messages: buildMessagesForApi(conv, userContent),
      conversationGuid: canonicalConversationGuid(conv.guid),
      temperature: settings.modelParams.temperature,
      max_tokens: settings.modelParams.maxTokens,
      context_window: settings.modelParams.contextWindow,
    }
    return executeGeneration(run, body)
  }

  async function cancelStream() {
    const run = activeRun
    if (!run || !runIsCurrent(run) || ['completed', 'failed', 'cancelled'].includes(generationState.value?.status)) return
    run.cancelRequested = true
    run.machine.cancelLocalQueue()
    setGenerationPhase(run, 'cancelling')
    run.controller.abort()
    run.recoveryController?.abort()
    if (USE_MOCK) {
      applyMachineSnapshot(run, run.machine.resolveCancel({ generation_id: run.generationId, conversation_guid: null, mode: run.mode, status: 'cancelled' }))
      return
    }
    try {
      const result = await cancelPlatformGeneration(run.generationId, { models: run.models })
      if (!runIsCurrent(run)) return
      run.terminalMeta = result
      applyMachineSnapshot(run, run.machine.resolveCancel(result))
    } catch (error) {
      if (!runIsCurrent(run)) return
      applyMachineSnapshot(run, run.machine.fail(error?.status === 403 || error?.status === 404 ? 'GENERATION_OWNER_ERROR' : 'GENERATION_CANCEL_ERROR'))
    }
  }

  async function resumePendingGeneration() {
    if (streaming.value || activeRun) return false
    let saved
    try { saved = JSON.parse(globalThis.sessionStorage?.getItem(ACTIVE_GENERATION_KEY) || 'null') } catch { saved = null }
    const validId = typeof saved?.generationId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(saved.generationId)
    const validModels = Array.isArray(saved?.models) && saved.models.length >= 1 && saved.models.length <= 3 && new Set(saved.models).size === saved.models.length && saved.models.every(model => typeof model === 'string' && model.trim())
    if (!validId || !['single', 'compare'].includes(saved?.mode) || !validModels || (saved.mode === 'single' ? saved.models.length !== 1 : saved.models.length < 2)) { forgetRun(); return false }
    const conv = saved.conversationGuid ? conversations.value.find(item => item.guid === saved.conversationGuid) : getActive()
    if (!conv) return false
    const assistant = { localKey: typeof saved.messageKey === 'string' && saved.messageKey ? saved.messageKey : genLocalId(), role: 'assistant', generationStatus: 'recovering', viewOnly: true, createdAt: Date.now(), ...(saved.mode === 'single' ? { content: '' } : { multiModel: true, models: saved.models, replies: Object.fromEntries(saved.models.map(model => [model, ''])), modelStates: Object.fromEntries(saved.models.map(model => [model, { status: 'recovering', code: null }])) }) }
    conv.messages ||= []
    if (!conv.messages.some(message => message.localKey === assistant.localKey)) conv.messages.push(assistant)
    const context = authSession.capture()
    const run = { generationId: saved.generationId, mode: saved.mode, models: [...saved.models], context, userGuid: authSession.user()?.guid ?? null, conv, conversationKey: conversationKey(conv), assistant, controller: new AbortController(), recoveryController: null, committed: false, cancelRequested: false, terminalMeta: null, machine: null }
    activeRun = run; streamController = run.controller; streaming.value = true
    run.machine = createChatGeneration({ generationId: run.generationId, conversationGuid: canonicalConversationGuid(conv.guid), messageKey: assistant.localKey, mode: run.mode, models: run.models, onChange: snapshot => applyMachineSnapshot(run, snapshot) })
    setGenerationPhase(run, 'recovering')
    await recoverGeneration(run)
    return true
  }


  return {
    conversations,
    activeId,
    streaming,
    loading,
    generationState,
    getActive,
    fetchConversations,
    createConversation,
    selectConversation,
    renameConversation,
    deleteConversation,
    ensureActive,
    refreshActiveConversation,
    sendMessage,
    cancelStream,
    resumePendingGeneration,
  }
})
