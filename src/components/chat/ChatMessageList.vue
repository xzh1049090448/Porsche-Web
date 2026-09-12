<template>
  <div class="message-list-shell conversation-surface">
    <div ref="listRef" class="message-list" @scroll="onListScroll">
    <div v-if="!messages.length" class="welcome">
      <h2>{{ t('chat.welcomeTitle') }}</h2>
      <p>{{ t('chat.welcomeDesc') }}</p>
    </div>

    <div
      v-for="msg in messages"
      :key="msg.guid || msg.localKey"
      class="message"
      :class="msg.role"
    >
      <el-avatar :size="36" :class="msg.role">
        {{ msg.role === 'user' ? t('chat.userAvatar') : t('chat.aiAvatar') }}
      </el-avatar>
      <div v-if="isEmptyTerminalAttempt(msg)" class="attempt-failure" role="status" aria-live="polite">
        <p class="reply-error">{{ t(attemptFailureKey(msg)) }}</p>
        <button
          v-if="canRetryAttempt(msg)"
          type="button"
          class="regenerate-button"
          :disabled="retryingAttempt === msg.localKey"
          :aria-label="t('chat.regenerate')"
          @click="retryAttempt(msg)"
        >
          {{ t(retryingAttempt === msg.localKey ? 'chat.regenerating' : 'chat.regenerate') }}
        </button>
      </div>
      <div v-else class="bubble" :class="{ 'multi-bubble': msg.multiModel }">
        <div v-if="msg.images?.length" class="msg-images">
          <el-image
            v-for="(img, i) in msg.images"
            :key="i"
            :src="img.url || img"
            fit="cover"
            :preview-src-list="msg.images.map((x) => x.url || x)"
            class="thumb"
          />
        </div>

        <div v-if="msg.multiModel" class="multi-reply-grid">
          <div v-for="m in modelsForMessage(msg)" :key="m.id" class="reply-col">
            <div class="reply-header">
              <span class="model-icon">{{ m.icon }}</span>
              <span class="reply-model-name">{{ m.name }}</span>
              <span class="reply-state">{{ t(`chat.generationStates.${modelReplyPresentation(msg, m.id).status}`) }}</span>
            </div>
            <div class="reply-body">
              <div v-if="isMultiModelWaiting(msg, m.id)" class="reply-loading">
                <span class="loading-dots" aria-hidden="true">
                  <i /><i /><i />
                </span>
                <span class="loading-label">{{ t('chat.generating') }}</span>
              </div>
              <template v-else>
                <MarkdownContent
                  :content="modelReplyPresentation(msg, m.id).content"
                  :streaming="isMultiModelStreaming(msg, m.id)"
                />
                <span v-if="isMultiModelStreaming(msg, m.id)" class="cursor">|</span>
                <p
                  v-if="modelReplyPresentation(msg, m.id).errorKey"
                  class="reply-error"
                  role="status"
                >
                  {{ t(modelReplyPresentation(msg, m.id).errorKey) }}
                </p>
                <p
                  v-if="modelReplyPresentation(msg, m.id).viewOnly"
                  class="reply-view-only-warning"
                  role="note"
                >
                  {{ t('chat.viewOnlyPartial') }}
                </p>
              </template>
            </div>
            <div v-if="canCopyGenerationMessage(msg, replyFor(msg, m.id))" class="col-actions">
              <el-button
                text size="small" :icon="CopyDocument"
                :loading="copyingKey === copyKey(msg, m.id)"
                :disabled="copyingKey !== null"
                @click="copy(msg.replies[m.id], copyKey(msg, m.id))"
              >
                {{ t(copyingKey === copyKey(msg, m.id) ? 'chat.copying' : 'chat.copy') }}
              </el-button>
            </div>
          </div>
        </div>
        <div v-if="msg.multiModel && msg.tokens" class="msg-actions">
          <span class="msg-tokens">{{ t('chat.tokensTotal', { count: formatTokens(msg.tokens) }) }}</span>
        </div>

        <template v-else>
          <div class="content">
            <div v-if="isAwaitingReply(msg)" class="reply-loading" aria-live="polite">
              <span class="loading-dots" aria-hidden="true">
                <i /><i /><i />
              </span>
              <span class="loading-label">{{ t('chat.thinking') }}</span>
            </div>
            <template v-else>
              <MarkdownContent
                v-if="msg.role === 'assistant'"
                :content="msg.content"
                :streaming="streamingLast(msg)"
              />
              <span v-else class="plain-text">{{ msg.content }}</span>
              <span v-if="streamingLast(msg) && msg.content" class="cursor">|</span>
              <p v-if="singleErrorKey(msg)" class="reply-error" role="status">
                {{ t(singleErrorKey(msg)) }}
              </p>
            </template>
          </div>
          <div v-if="canCopyGenerationMessage(msg)" class="msg-actions">
            <span v-if="msg.tokens" class="msg-tokens">{{ t('chat.tokens', { count: formatTokens(msg.tokens) }) }}</span>
            <el-button
              text size="small" :icon="CopyDocument"
              :loading="copyingKey === copyKey(msg)"
              :disabled="copyingKey !== null"
              @click="copy(msg.content, copyKey(msg))"
            >
              {{ t(copyingKey === copyKey(msg) ? 'chat.copying' : 'chat.copy') }}
            </el-button>
          </div>
        </template>

        <p
          v-if="showViewOnlyWarning(msg)"
          class="view-only-warning"
          role="note"
        >
          {{ t('chat.viewOnlyPartial') }}
        </p>

      </div>
    </div>
    </div>
    <button
      v-if="!stickToBottom"
      type="button"
      class="back-to-latest"
      :aria-label="t('chat.backToLatest')"
      @click="scrollToBottom(true)"
    >
      {{ t('chat.backToLatest') }}
    </button>
  </div>
</template>

<script setup>
import { computed, ref, watch, nextTick, onBeforeUnmount } from 'vue'
import { CopyDocument } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { useChatStore } from '@/stores/chat'
import { useSettingsStore } from '@/stores/settings'
import MarkdownContent from '@/components/chat/MarkdownContent.vue'
import { useI18n } from '@/composables/useI18n'
import { canCopyGenerationMessage, canRetryGenerationMessage, generationErrorMessageKey, modelReplyPresentation } from '@/components/chat/generation-ui'
import { copyText } from '@/utils/clipboard'

const chatStore = useChatStore()
const settings = useSettingsStore()
const { t } = useI18n()
const listRef = ref()
/** 用户未主动上滑时跟随流式输出滚到底部 */
const stickToBottom = ref(true)
const retryingAttempt = ref(null)
const copyingKey = ref(null)
let copyOperation = null
let disposed = false
const SCROLL_BOTTOM_THRESHOLD = 80

const messages = computed(() => chatStore.getActive()?.messages || [])

function modelsForMessage(msg) {
  return (msg.models || [])
    .map((id) => settings.models.find((m) => m.id === id) || { id, name: id, icon: 'AI' })
}

function isLastMessage(msg) {
  const list = messages.value
  return list[list.length - 1] === msg
}

function isAwaitingReply(msg) {
  return chatStore.streaming && msg.role === 'assistant' && !msg.content && isLastMessage(msg)
}

function streamingLast(msg) {
  return chatStore.streaming && msg.role === 'assistant' && isLastMessage(msg)
}

function replyFor(msg, modelId) {
  return modelReplyPresentation(msg, modelId).content
}

function showViewOnlyWarning(msg) {
  if (msg.role !== 'assistant' || msg.viewOnly !== true) return false
  if (msg.multiModel) return false
  return ['failed', 'cancelled'].includes(msg.generationStatus)
}

function hasVisibleContent(msg) {
  if (msg.multiModel) return Object.values(msg.replies || {}).some(content => typeof content === 'string' && content.length > 0)
  return typeof msg.content === 'string' && msg.content.length > 0
}

function isEmptyTerminalAttempt(msg) {
  return msg.role === 'assistant' && ['failed', 'cancelled'].includes(msg.generationStatus) && !hasVisibleContent(msg)
}

function attemptFailureKey(msg) {
  return generationErrorMessageKey(msg.generationStatus === 'cancelled' ? 'cancelled' : msg.errorCode)
}

function canRetryAttempt(msg) {
  return canRetryGenerationMessage(msg, chatStore.generationState, isLastMessage(msg))
}

async function retryAttempt(msg) {
  if (retryingAttempt.value || !canRetryAttempt(msg)) return
  retryingAttempt.value = msg.localKey
  try {
    await chatStore.retryGenerationAttempt()
  } finally {
    if (retryingAttempt.value === msg.localKey) retryingAttempt.value = null
  }
}

function singleErrorKey(msg) {
  return msg.role === 'assistant' && msg.generationStatus === 'failed' ? generationErrorMessageKey(msg.errorCode) : null
}

function isMultiModelWaiting(msg, modelId) {
  const reply = modelReplyPresentation(msg, modelId)
  return (
    chatStore.streaming &&
    isLastMessage(msg) &&
    msg.multiModel &&
    ['waiting', 'receiving', 'draining', 'recovering'].includes(reply.status) &&
    reply.content.length === 0
  )
}

function isMultiModelStreaming(msg, modelId) {
  const reply = modelReplyPresentation(msg, modelId)
  return (
    chatStore.streaming &&
    isLastMessage(msg) &&
    msg.multiModel &&
    ['waiting', 'receiving', 'draining', 'recovering'].includes(reply.status) &&
    reply.content.length > 0
  )
}

function formatTokens(n) {
  return Number(n || 0).toLocaleString()
}

function copyKey(message, modelId = 'single') {
  return `${message.guid || message.localKey || 'message'}:${modelId}`
}

async function copy(text, key) {
  if (copyOperation) return
  const operation = { key, controller: new AbortController() }
  copyOperation = operation
  copyingKey.value = key
  try {
    const copied = await copyText(text, {
      navigator: globalThis.navigator,
      document: globalThis.document,
      container: listRef.value,
      signal: operation.controller.signal,
    })
    if (disposed || operation.controller.signal.aborted || copyOperation !== operation) return
    if (copied) ElMessage.success(t('chat.copied'))
    else ElMessage.warning(t('chat.copyFailed'))
  } catch (error) {
    if (disposed || operation.controller.signal.aborted || copyOperation !== operation || error?.name === 'AbortError') return
    ElMessage.warning(t('chat.copyFailed'))
  } finally {
    if (!disposed && copyOperation === operation) {
      copyOperation = null
      copyingKey.value = null
    }
  }
}

onBeforeUnmount(() => {
  disposed = true
  copyOperation?.controller.abort()
  copyOperation = null
})

function isNearBottom(el) {
  if (!el) return true
  return el.scrollHeight - el.scrollTop - el.clientHeight <= SCROLL_BOTTOM_THRESHOLD
}

function onListScroll() {
  const el = listRef.value
  if (!el) return
  stickToBottom.value = isNearBottom(el)
}

async function scrollToBottom(force = false) {
  await nextTick()
  const el = listRef.value
  if (!el) return
  if (force || stickToBottom.value || isNearBottom(el)) {
    el.scrollTop = el.scrollHeight
    stickToBottom.value = true
  }
}

watch(
  () => chatStore.streaming,
  (streaming, prev) => {
    if (streaming && !prev) {
      stickToBottom.value = isNearBottom(listRef.value)
    }
  }
)

watch(() => chatStore.activeId, () => {
  stickToBottom.value = true
  scrollToBottom(true)
})

watch(
  () => {
    const last = messages.value[messages.value.length - 1]
    const replyChars =
      last?.multiModel && last.replies
        ? Object.values(last.replies).reduce((n, t) => n + (t?.length || 0), 0)
        : 0
    return [messages.value.length, last?.content, replyChars, chatStore.streaming]
  },
  () => scrollToBottom(false),
  { deep: true }
)
</script>

<style scoped lang="scss">
.message-list-shell {
  position: relative;
  flex: 1;
  min-height: 0;
}

.message-list {
  height: 100%;
  box-sizing: border-box;
  overflow-y: auto;
  padding: 24px;
  background: var(--app-bg);
}

.back-to-latest {
  position: absolute;
  right: 24px;
  bottom: 18px;
  z-index: 2;
  min-height: 38px;
  padding: 8px 14px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--component-bg);
  color: var(--text-primary);
  box-shadow: 0 4px 14px rgb(0 0 0 / 14%);
  cursor: pointer;

  &:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
}

.welcome {
  text-align: center;
  padding: 48px 24px;
  color: var(--text-secondary);

  h2 {
    color: var(--text-primary);
    font-size: 20px;
    font-weight: 600;
    line-height: 28px;
    margin: 0 0 8px;
  }

  p {
    font-size: 14px;
    line-height: 22px;
    color: var(--text-body);
  }
}

.message {
  display: flex;
  gap: 12px;
  margin-bottom: 24px;

  &.user {
    flex-direction: row-reverse;

    .bubble {
      background: var(--bubble-user-bg);
      border: 1px solid var(--bubble-user-border);
      color: var(--bubble-user-text);
    }
  }

  &.assistant .bubble {
    background: var(--bubble-assistant-bg);
    border: 1px solid var(--border);
    color: var(--text-body);
  }

  :deep(.el-avatar) {
    background: var(--model-icon-bg);
    color: var(--accent);
    border: 1px solid var(--border);
    flex-shrink: 0;
  }

  &.user :deep(.el-avatar) {
    background: var(--model-icon-bg);
    color: var(--accent);
  }
}

.bubble {
  max-width: min(720px, 85%);
  padding: 12px 16px;
  border-radius: 8px;
  font-size: 14px;
  line-height: 22px;
  word-break: break-word;

  &.multi-bubble {
    max-width: min(960px, 95%);
    padding: 12px;
  }
}

.plain-text {
  white-space: pre-wrap;
}

.message.user .plain-text {
  color: var(--bubble-user-text);
}

.message.user :deep(.markdown-body a) {
  color: var(--bubble-user-text);
  text-decoration: underline;
}

.msg-images {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 8px;

  .thumb {
    width: 120px;
    height: 80px;
    border-radius: 6px;
  }
}

.msg-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
  border-top: 1px solid var(--border);
  padding-top: 4px;
}

.msg-tokens {
  font-size: 12px;
  color: var(--text-secondary);
  margin-right: auto;
}

.cursor {
  animation: blink 0.8s infinite;
}

.reply-loading {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  min-height: 24px;
  color: var(--text-secondary);
}

.loading-label {
  font-size: 13px;
}

.loading-dots {
  display: inline-flex;
  align-items: center;
  gap: 5px;

  i {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--accent);
    opacity: 0.35;
    animation: dot-bounce 1.2s infinite ease-in-out;

    &:nth-child(2) {
      animation-delay: 0.15s;
    }

    &:nth-child(3) {
      animation-delay: 0.3s;
    }
  }
}

@keyframes dot-bounce {
  0%,
  80%,
  100% {
    transform: translateY(0);
    opacity: 0.35;
  }

  40% {
    transform: translateY(-5px);
    opacity: 1;
  }
}

@keyframes blink {
  50% {
    opacity: 0;
  }
}

.multi-reply-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 10px;
}

.reply-col {
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
  background: var(--hover-bg);
}

.reply-header {
  padding: 8px 10px;
  background: var(--component-bg);
  font-weight: 500;
  font-size: 12px;
  color: var(--text-primary);
  display: flex;
  align-items: center;
  gap: 6px;
}

.reply-model-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.reply-state {
  margin-left: auto;
  color: var(--text-secondary);
  font-size: 11px;
}

.reply-error,
.reply-view-only-warning,
.view-only-warning {
  margin: 8px 0 0;
  color: var(--danger);
  font-size: 12px;
  line-height: 18px;
}

.reply-view-only-warning,
.view-only-warning {
  color: var(--text-secondary);
  border-top: 1px solid var(--border);
  padding-top: 8px;
}

.attempt-failure {
  max-width: min(720px, 85%);
  padding: 12px 16px;
  border: 1px solid var(--danger);
  border-radius: 8px;
  background: var(--component-bg);
}

.attempt-failure .reply-error {
  margin-top: 0;
}

.regenerate-button {
  min-height: 34px;
  margin-top: 10px;
  padding: 6px 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: transparent;
  color: var(--text-primary);
  cursor: pointer;

  &:disabled {
    color: var(--text-disabled);
    cursor: not-allowed;
  }
}

.model-icon {
  width: 20px;
  height: 20px;
  border-radius: 4px;
  background: var(--model-icon-bg);
  color: var(--accent);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  font-weight: 700;
}

.reply-body {
  padding: 10px;
  font-size: 13px;
  line-height: 1.6;
  min-height: 80px;
}

.col-actions {
  border-top: 1px solid var(--border);
  padding: 2px 4px;
}

@media (max-width: 768px) {
  .message-list {
    padding: 12px 12px 8px;
  }

  .back-to-latest {
    right: 12px;
    bottom: 12px;
  }

  .welcome {
    padding: 32px 16px;

    h2 {
      font-size: 18px;
    }
  }

  .message {
    gap: 8px;
    margin-bottom: 16px;
  }

  .bubble {
    max-width: 92%;
    padding: 10px 12px;
    font-size: 14px;

    &.multi-bubble {
      max-width: 100%;
      padding: 8px;
    }
  }

  .multi-reply-grid {
    grid-template-columns: 1fr;
    gap: 8px;
  }

  .msg-images .thumb {
    width: 100px;
    height: 72px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .cursor,
  .loading-dots i {
    animation: none;
  }
}

@media (max-width: 480px) {
  .bubble {
    max-width: 94%;
    font-size: 14px;
  }
}
</style>
