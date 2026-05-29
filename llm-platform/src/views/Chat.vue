<template>
  <div class="chat-page">
    <MobileDrawer v-model:show="showSidebar" position="left" title="对话列表">
      <ChatSidebar embedded @navigated="showSidebar = false" />
    </MobileDrawer>

    <MobileDrawer v-model:show="showConfig" position="right" title="模型与数据集">
      <el-scrollbar class="config-drawer-scroll">
        <ModelPanel />
        <DatasetPanel />
      </el-scrollbar>
    </MobileDrawer>

    <div class="chat-sidebar-wrap desktop-only">
      <ChatSidebar />
    </div>

    <div class="chat-center">
      <div class="mobile-bar mobile-only">
        <el-button class="touch-target" text @click="showSidebar = true">
          <el-icon><Menu /></el-icon>
          <span>对话</span>
        </el-button>
        <span class="mobile-title">{{ currentTitle }}</span>
        <el-button class="touch-target" text @click="showConfig = true">
          <el-icon><Setting /></el-icon>
          <span>配置</span>
        </el-button>
      </div>

      <ChatMessageList class="chat-messages" @quick="onQuick" />
      <ChatInput ref="inputRef" :mobile="isTablet" @send="onSend" />
    </div>

    <div class="chat-config-wrap desktop-only">
      <el-scrollbar>
        <ModelPanel />
        <DatasetPanel />
      </el-scrollbar>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { Menu, Setting } from '@element-plus/icons-vue'
import ChatSidebar from '@/components/chat/ChatSidebar.vue'
import ChatMessageList from '@/components/chat/ChatMessageList.vue'
import ChatInput from '@/components/chat/ChatInput.vue'
import ModelPanel from '@/components/chat/ModelPanel.vue'
import DatasetPanel from '@/components/chat/DatasetPanel.vue'
import MobileDrawer from '@/components/mobile/MobileDrawer.vue'
import { USE_MOCK } from '@/api/request'
import { useChatStore } from '@/stores/chat'
import { useSettingsStore } from '@/stores/settings'
import { useBreakpoint } from '@/composables/useBreakpoint'

const chatStore = useChatStore()
const settingsStore = useSettingsStore()
const inputRef = ref()
const showSidebar = ref(false)
const showConfig = ref(false)
const { isTablet } = useBreakpoint()

const currentTitle = computed(() => {
  const conv = chatStore.getActive()
  return conv?.title || '新对话'
})

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

.chat-sidebar-wrap,
.chat-config-wrap {
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: var(--panel-bg);
}

.chat-config-wrap :deep(.el-scrollbar) {
  height: 100%;
}

.config-drawer-scroll {
  height: 100%;
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

.chat-messages {
  flex: 1;
  min-height: 0;
}

.mobile-bar {
  flex-shrink: 0;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 0 8px;
  height: 48px;
  background: var(--panel-bg);
  border-bottom: 1px solid var(--border);

  .el-button {
    flex-shrink: 0;
    padding: 8px 10px;
    font-size: 13px;
  }

  .mobile-title {
    flex: 1;
    min-width: 0;
    text-align: center;
    font-weight: 600;
    font-size: 15px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    padding: 0 4px;
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
  }

  .chat-center {
    border: none;
  }
}
</style>
