<template>
  <aside class="chat-sidebar">
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
        @click="chatStore.selectConversation(c.id)"
      >
        <div class="conv-title">{{ c.title }}</div>
        <div class="conv-meta">{{ formatTime(c.updatedAt) }}</div>
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
import { Plus, Search, MoreFilled } from '@element-plus/icons-vue'
import { ElMessageBox, ElMessage } from 'element-plus'
import { useChatStore } from '@/stores/chat'
import { exportToPdf, downloadFile } from '@/utils/export'
import { exportConversationMarkdown } from '@/api/conversations'

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

function onNew() {
  chatStore.createConversation()
}

async function rename(c) {
  const { value } = await ElMessageBox.prompt('请输入对话名称', '重命名', {
    inputValue: c.title,
    confirmButtonText: '确定',
  })
  if (value?.trim()) chatStore.renameConversation(c.id, value.trim())
}

function remove(c) {
  ElMessageBox.confirm(`确定删除「${c.title}」？`, '删除对话', { type: 'warning' }).then(() => {
    chatStore.deleteConversation(c.id)
    ElMessage.success('已删除')
  })
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
  padding: 12px;
  background: var(--panel-bg);
  border-right: 1px solid var(--border);
}

.new-btn {
  width: 100%;
  margin-bottom: 10px;
}

.search-input {
  margin-bottom: 10px;
}

.conv-list {
  flex: 1;
}

.conv-item {
  position: relative;
  padding: 10px 28px 10px 10px;
  margin-bottom: 4px;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.15s;

  &:hover {
    background: #f5f7fa;
  }

  &.active {
    background: #ecf5ff;
    border-left: 3px solid var(--accent);
    padding-left: 7px;
  }
}

.conv-title {
  font-size: 13px;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.conv-meta {
  font-size: 11px;
  color: var(--text-secondary);
  margin-top: 4px;
}

.conv-more {
  position: absolute;
  right: 8px;
  top: 50%;
  transform: translateY(-50%);
  opacity: 0;
  .conv-item:hover & {
    opacity: 1;
  }
}
</style>
