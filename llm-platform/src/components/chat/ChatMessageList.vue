<template>
  <div ref="listRef" class="message-list">
    <div v-if="!messages.length" class="welcome">
      <h2>开始对话</h2>
      <p>已接入智谱 GLM-5.1 / GLM-4.5 Air / GLM-4.7 Flash，可多选模型并行对比</p>
      <p class="welcome-sub">选择模型与数据集后输入跨境电商相关问题</p>
      <div class="quick-tags">
        <el-tag
          v-for="q in quickQuestions"
          :key="q"
          class="quick-tag"
          effect="plain"
          @click="$emit('quick', q)"
        >
          {{ q }}
        </el-tag>
      </div>
    </div>

    <div
      v-for="msg in messages"
      :key="msg.id"
      class="message"
      :class="msg.role"
    >
      <el-avatar :size="36" :class="msg.role">
        {{ msg.role === 'user' ? '我' : 'AI' }}
      </el-avatar>
      <div class="bubble" :class="{ 'multi-bubble': msg.multiModel }">
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
              {{ m.name }}
            </div>
            <div class="reply-body">
              <div v-if="isMultiModelLoading(msg, m.id)" class="reply-loading">
                <span class="loading-dots" aria-hidden="true">
                  <i /><i /><i />
                </span>
                <span class="loading-label">生成中</span>
              </div>
              <MarkdownContent
                v-else-if="msg.replies?.[m.id]"
                :content="msg.replies[m.id]"
                :streaming="isMultiModelStreaming(msg, m.id)"
              />
            </div>
            <div v-if="msg.replies?.[m.id]" class="col-actions">
              <el-button text size="small" :icon="CopyDocument" @click="copy(msg.replies[m.id])">
                复制
              </el-button>
            </div>
          </div>
        </div>

        <template v-else>
          <div class="content">
            <div v-if="isAwaitingReply(msg)" class="reply-loading" aria-live="polite">
              <span class="loading-dots" aria-hidden="true">
                <i /><i /><i />
              </span>
              <span class="loading-label">正在思考</span>
            </div>
            <template v-else>
              <MarkdownContent
                v-if="msg.role === 'assistant'"
                :content="msg.content"
                :streaming="streamingLast(msg)"
              />
              <span v-else class="plain-text">{{ msg.content }}</span>
              <span v-if="streamingLast(msg) && msg.content" class="cursor">|</span>
            </template>
          </div>
          <div v-if="msg.role === 'assistant' && msg.content" class="msg-actions">
            <el-button text size="small" :icon="CopyDocument" @click="copy(msg.content)">
              复制
            </el-button>
          </div>
        </template>

        <div v-if="msg.datasetUsed" class="dataset-badge">
          <el-icon><CircleCheck /></el-icon>
          {{ msg.datasetBadge }}
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, watch, nextTick } from 'vue'
import { CopyDocument, CircleCheck } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { useChatStore } from '@/stores/chat'
import { useSettingsStore } from '@/stores/settings'
import MarkdownContent from '@/components/chat/MarkdownContent.vue'
defineEmits(['quick'])

const chatStore = useChatStore()
const settings = useSettingsStore()
const listRef = ref()

const messages = computed(() => chatStore.getActive()?.messages || [])

const quickQuestions = [
  '亚马逊 FBA 标题优化要点？',
  'Shopee 退换货政策怎么写？',
  '跨境物流时效如何回复客户？',
]

function modelsForMessage(msg) {
  return (msg.models || [])
    .map((id) => settings.models.find((m) => m.id === id))
    .filter(Boolean)
}

function isLastMessage(msg) {
  const list = messages.value
  return list[list.length - 1]?.id === msg.id
}

function isAwaitingReply(msg) {
  return chatStore.streaming && msg.role === 'assistant' && !msg.content && isLastMessage(msg)
}

function streamingLast(msg) {
  return chatStore.streaming && msg.role === 'assistant' && isLastMessage(msg)
}

function isMultiModelLoading(msg, modelId) {
  return (
    chatStore.streaming &&
    isLastMessage(msg) &&
    msg.multiModel &&
    !msg.replies?.[modelId]
  )
}

function isMultiModelStreaming(msg, modelId) {
  return chatStore.streaming && isLastMessage(msg) && msg.multiModel && !!msg.replies?.[modelId]
}

function copy(text) {
  navigator.clipboard.writeText(text)
  ElMessage.success('已复制')
}

async function scrollToBottom() {
  await nextTick()
  if (listRef.value) {
    listRef.value.scrollTop = listRef.value.scrollHeight
  }
}

watch(() => chatStore.activeId, () => scrollToBottom())

watch(
  () => [
    messages.value.length,
    messages.value[messages.value.length - 1]?.content,
    messages.value[messages.value.length - 1]?.replies,
    chatStore.streaming,
  ],
  () => scrollToBottom(),
  { deep: true }
)
</script>

<style scoped lang="scss">
.message-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 20px;
}

.welcome {
  text-align: center;
  padding: 48px 24px;
  color: var(--text-secondary);

  h2 {
    color: var(--text-primary);
    margin: 0 0 8px;
  }

  .welcome-sub {
    margin: 4px 0 0;
    font-size: 13px;
  }

  .quick-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    justify-content: center;
    margin-top: 20px;
  }

  .quick-tag {
    cursor: pointer;
  }
}

.message {
  display: flex;
  gap: 12px;
  margin-bottom: 20px;

  &.user {
    flex-direction: row-reverse;

    .bubble {
      background: #409eff;
      color: #fff;
    }
  }

  &.assistant .bubble {
    background: #fff;
    border: 1px solid var(--border);
  }
}

.bubble {
  max-width: min(720px, 85%);
  padding: 12px 16px;
  border-radius: 12px;
  font-size: 14px;
  line-height: 1.6;
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
  color: #fff;
}

.message.user :deep(.markdown-body a) {
  color: #fff;
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
  margin-top: 8px;
  border-top: 1px solid var(--border);
  padding-top: 4px;
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
  background: #fafafa;
}

.reply-header {
  padding: 8px 10px;
  background: #f5f7fa;
  font-weight: 600;
  font-size: 12px;
  display: flex;
  align-items: center;
  gap: 6px;
}

.model-icon {
  width: 20px;
  height: 20px;
  border-radius: 4px;
  background: #ecf5ff;
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

.dataset-badge {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 8px;
  font-size: 12px;
  color: var(--accent-green);
}

@media (max-width: 768px) {
  .message-list {
    padding: 12px 12px 8px;
  }

  .welcome {
    padding: 32px 16px;

    h2 {
      font-size: 18px;
    }

    .welcome-sub {
      font-size: 12px;
    }

    .quick-tag {
      font-size: 12px;
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

@media (max-width: 480px) {
  .bubble {
    max-width: 94%;
    font-size: 14px;
  }
}
</style>
