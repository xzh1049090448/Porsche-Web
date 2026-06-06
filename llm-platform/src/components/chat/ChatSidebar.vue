<template>
  <aside class="chat-sidebar" :class="{ 'is-embedded': embedded }">
    <el-button type="primary" class="new-btn" :icon="Plus" @click="onNew">新建对话</el-button>
    <el-input
      v-model="keyword"
      placeholder="搜索对话..."
      clearable
      :prefix-icon="Search"
      class="search-input"
    />
    <el-scrollbar class="conv-list">
      <div
        v-for="c in filtered"
        :key="c.id"
        class="conv-item"
        :class="{ active: c.id === chatStore.activeId }"
        @click="selectConversation(c.id)"
      >
        <div class="conv-title">📋 {{ c.title }}</div>
        <div class="conv-meta">{{ formatTime(c.updatedAt) }}</div>
        <el-icon
          class="conv-delete"
          title="永久删除"
          @click.stop="remove(c)"
        >
          <Delete />
        </el-icon>
        <el-dropdown trigger="click" @click.stop>
          <el-icon class="conv-more" @click.stop><MoreFilled /></el-icon>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item @click="rename(c)">重命名</el-dropdown-item>
              <el-dropdown-item @click="exportMd(c)">导出 Markdown</el-dropdown-item>
              <el-dropdown-item @click="exportPdf(c)">导出 PDF</el-dropdown-item>
              <el-dropdown-item divided @click="remove(c)">
                <span style="color: var(--el-color-danger)">删除</span>
              </el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </div>
      <el-empty v-if="filtered.length === 0" description="暂无对话" :image-size="64" />
    </el-scrollbar>
  </aside>
</template>

<script setup>
import { ref, computed } from 'vue'
import { Plus, Search, MoreFilled, Delete } from '@element-plus/icons-vue'
import { ElMessageBox, ElMessage } from 'element-plus'
import { useChatStore } from '@/stores/chat'
import { exportToPdf, downloadFile } from '@/utils/export'
import { exportConversationMarkdown } from '@/api/conversations'

const props = defineProps({
  embedded: { type: Boolean, default: false },
})

const emit = defineEmits(['navigated'])

const chatStore = useChatStore()
const keyword = ref('')

const filtered = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  return chatStore.conversations.filter((c) => !kw || c.title.toLowerCase().includes(kw))
})

function formatTime(ts) {
  return new Date(ts).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function selectConversation(id) {
  chatStore.selectConversation(id)
  emit('navigated')
}

function onNew() {
  chatStore.createConversation()
  emit('navigated')
}

async function rename(c) {
  const { value } = await ElMessageBox.prompt('请输入对话名称', '重命名', {
    inputValue: c.title,
    confirmButtonText: '确定',
  })
  if (value?.trim()) chatStore.renameConversation(c.id, value.trim())
}

function remove(c) {
  if (chatStore.streaming) {
    ElMessage.warning('正在生成回复，请稍后再删除')
    return
  }
  ElMessageBox.confirm(
    `删除后将永久清除该对话的全部记录（含所有消息），且无法恢复。确定删除「${c.title}」？`,
    '永久删除对话',
    {
      type: 'warning',
      confirmButtonText: '永久删除',
      cancelButtonText: '取消',
      confirmButtonClass: 'el-button--danger',
    }
  )
    .then(async () => {
      try {
        await chatStore.deleteConversation(c.id)
        ElMessage.success('对话已永久删除')
      } catch {
        /* 错误由 request 拦截器或 store 抛出 */
      }
    })
    .catch(() => {})
}

async function exportMd(c) {
  try {
    const md = await exportConversationMarkdown(c.id)
    downloadFile(md, `${c.title || '对话'}.md`)
    ElMessage.success('已导出 Markdown')
  } catch {
    ElMessage.error('导出失败')
  }
}

function exportPdf(c) {
  exportToPdf(c)
}
</script>

<style scoped lang="scss">
.chat-sidebar {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  padding: 12px;
  background: var(--sidebar-bg);
  border-right: 1px solid var(--border);
}

.chat-sidebar.is-embedded {
  border-right: none;
  height: 100%;
}

.new-btn {
  width: 100%;
  margin-bottom: 12px;
  height: 40px;
  border-radius: 8px;
  font-weight: 500;
}

.search-input {
  margin-bottom: 12px;

  :deep(.el-input__wrapper) {
    background: var(--component-bg);
    box-shadow: none;
    border: 1px solid var(--border);
    border-radius: 8px;
  }
}

.conv-list {
  flex: 1;
  min-height: 0;
}

.conv-item {
  position: relative;
  padding: 12px 52px 12px 12px;
  margin-bottom: 4px;
  min-height: 56px;
  border-radius: 0;
  border-left: 3px solid transparent;
  cursor: pointer;
  transition: background 0.2s, border-color 0.2s;

  &:hover {
    background: var(--hover-bg);
  }

  &.active {
    background: var(--active-item-bg);
    border-left-color: var(--accent);

    .conv-title {
      color: var(--text-primary);
    }
  }
}

.conv-title {
  font-size: 14px;
  font-weight: 500;
  line-height: 22px;
  color: var(--text-body);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.conv-meta {
  font-size: 12px;
  line-height: 18px;
  color: var(--text-secondary);
  margin-top: 2px;
}

.conv-more {
  position: absolute;
  right: 28px;
  top: 50%;
  transform: translateY(-50%);
  padding: 8px;
  font-size: 18px;
  opacity: 0;

  .conv-item:hover & {
    opacity: 1;
  }
}

.conv-delete {
  position: absolute;
  right: 8px;
  top: 50%;
  transform: translateY(-50%);
  padding: 8px;
  font-size: 18px;
  color: var(--text-secondary);
  opacity: 0;
  transition: color 0.15s, opacity 0.15s;

  &:hover {
    color: var(--el-color-danger);
  }

  .conv-item:hover & {
    opacity: 1;
  }
}

@media (max-width: 768px) {
  .conv-more,
  .conv-delete {
    opacity: 1;
  }

  .new-btn {
    min-height: 44px;
  }
}
</style>
