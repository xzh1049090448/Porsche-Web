<template>
  <div ref="listRef" class="message-list">
  <!-- compare mode -->
    <template v-if="settings.compareMode && Object.keys(chatStore.compareResults).length">
      <div class="compare-grid">
        <div v-for="m in compareModels" :key="m.id" class="compare-col">
          <div class="compare-header">
            <span class="model-icon">{{ m.icon }}</span>
            {{ m.name }}
          </div>
          <div class="compare-body">
            <div v-if="chatStore.streaming && !chatStore.compareResults[m.id]" class="reply-loading">
              <span class="loading-dots" aria-hidden="true">
                <i /><i /><i />
              </span>
              <span class="loading-label">生成中</span>
            </div>
            <template v-else>
              <MarkdownContent
                v-if="chatStore.compareResults[m.id]"
                :content="chatStore.compareResults[m.id]"
                :streaming="chatStore.streaming"
              />
            </template>
          </div>
        </div>
      </div>
    </template>

    <template v-else>
      <div v-if="!messages.length" class="welcome">
        <h2>开始对话</h2>
        <p>已接入智谱 GLM-4.7 Flash / GLM-4 / GLM-5.1，选择模型与数据集后输入跨境电商相关问题</p>
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
        <div class="bubble">
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
          <div v-if="msg.datasetUsed" class="dataset-badge">
            <el-icon><CircleCheck /></el-icon>
            {{ msg.datasetBadge }}
          </div>
          <div v-if="msg.role === 'assistant' && msg.content" class="msg-actions">
            <el-button text size="small" :icon="CopyDocument" @click="copy(msg.content)">
              复制
            </el-button>
          </div>
        </div>
      </div>
    </template>
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

const compareModels = computed(() =>
  settings.compareModelIds
    .map((id) => settings.models.find((m) => m.id === id))
    .filter(Boolean)
)

const quickQuestions = [
  '亚马逊 FBA 标题优化要点？',
  'Shopee 退换货政策怎么写？',
  '跨境物流时效如何回复客户？',
]

function isAwaitingReply(msg) {
  const list = messages.value
  return (
    chatStore.streaming &&
    msg.role === 'assistant' &&
    !msg.content &&
    list[list.length - 1]?.id === msg.id
  )
}

function streamingLast(msg) {
  const list = messages.value
  return (
    chatStore.streaming &&
    msg.role === 'assistant' &&
    list[list.length - 1]?.id === msg.id
  )
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
    chatStore.streaming,
    chatStore.compareResults,
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

.compare-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 12px;
}

.compare-col {
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
  background: #fff;
}

.compare-header {
  padding: 10px 12px;
  background: #f5f7fa;
  font-weight: 600;
  font-size: 13px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.compare-body {
  padding: 12px;
  font-size: 13px;
  line-height: 1.6;
  min-height: 120px;
}
</style>
