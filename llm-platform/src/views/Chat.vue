<template>
  <div class="chat-page">
    <div class="chat-sidebar-wrap">
      <ChatSidebar />
    </div>
    <div class="chat-center">
      <ChatMessageList @quick="onQuick" />
      <ChatInput ref="inputRef" @send="onSend" />
    </div>
    <div class="chat-config-wrap">
      <el-scrollbar>
        <ModelPanel />
        <DatasetPanel />
      </el-scrollbar>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import ChatSidebar from '@/components/chat/ChatSidebar.vue'
import ChatMessageList from '@/components/chat/ChatMessageList.vue'
import ChatInput from '@/components/chat/ChatInput.vue'
import ModelPanel from '@/components/chat/ModelPanel.vue'
import DatasetPanel from '@/components/chat/DatasetPanel.vue'
import { USE_MOCK } from '@/api/request'
import { useChatStore } from '@/stores/chat'
import { useSettingsStore } from '@/stores/settings'

const chatStore = useChatStore()
const settingsStore = useSettingsStore()
const inputRef = ref()

onMounted(async () => {
  await Promise.all([settingsStore.loadModels(), settingsStore.loadDatasets()])
  if (!USE_MOCK) {
    await chatStore.fetchConversations()
  }
  await chatStore.ensureActive()
})

function onSend(content, images) {
  chatStore.sendMessage(content, images)
}

function onQuick(q) {
  inputRef.value?.setText(q)
}
</script>

<style scoped lang="scss">
.chat-page {
  display: grid;
  grid-template-columns: var(--sidebar-w) 1fr var(--config-w);
  height: 100%;
  overflow: hidden;
}

.chat-sidebar-wrap {
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.chat-center {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: var(--app-bg);
  border-left: 1px solid var(--border);
  border-right: 1px solid var(--border);
}

.chat-config-wrap {
  min-height: 0;
  background: var(--panel-bg);
  overflow: hidden;

  :deep(.el-scrollbar) {
    height: 100%;
  }
}

@media (max-width: 1200px) {
  .chat-page {
    grid-template-columns: 220px 1fr 260px;
  }
}

@media (max-width: 992px) {
  .chat-page {
    grid-template-columns: 1fr;
    grid-template-rows: auto minmax(0, 1fr) auto;
  }

  .chat-sidebar-wrap {
    max-height: 180px;
    border-bottom: 1px solid var(--border);
  }

  .chat-config-wrap {
    max-height: 280px;
    border-top: 1px solid var(--border);
  }
}
</style>
