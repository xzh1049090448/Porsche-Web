<template>
  <div class="chat-root">
    <MobileDrawer v-model:show="showSidebar" position="left" :title="t('chat.convListDrawer')">
      <ChatSidebar embedded @navigated="showSidebar = false" />
    </MobileDrawer>

    <MobileDrawer v-model:show="showConfig" position="right" :title="t('chat.modelConfig')">
      <el-scrollbar class="config-drawer-scroll">
        <ModelPanel />
      </el-scrollbar>
    </MobileDrawer>

    <div
      class="chat-page"
      :class="{
        'is-sidebar-collapsed': sidebarCollapsed,
        'is-config-collapsed': configCollapsed,
      }"
    >
    <aside class="chat-sidebar-wrap desktop-only" :class="{ collapsed: sidebarCollapsed }">
      <template v-if="sidebarCollapsed">
        <button
          type="button"
          class="panel-rail"
          :title="t('chat.expandConvList')"
          @click="toggleSidebar"
        >
          <el-icon><DArrowRight /></el-icon>
          <span class="rail-text">{{ t('nav.chat') }}</span>
        </button>
      </template>
      <template v-else>
        <div class="panel-toolbar">
          <span class="panel-label">{{ t('chat.convList') }}</span>
          <button type="button" class="panel-toggle" :title="t('chat.collapseConvList')" @click="toggleSidebar">
            <el-icon><DArrowLeft /></el-icon>
          </button>
        </div>
        <div class="panel-body">
          <ChatSidebar />
        </div>
      </template>
    </aside>

    <div class="chat-center">
      <div class="mobile-bar mobile-only">
        <el-button class="touch-target" text @click="showSidebar = true">
          <el-icon><Menu /></el-icon>
          <span>{{ t('nav.chat') }}</span>
        </el-button>
        <span class="mobile-title">{{ currentTitle }}</span>
        <el-button class="touch-target" text @click="showConfig = true">
          <el-icon><Setting /></el-icon>
          <span>{{ t('chat.config') }}</span>
        </el-button>
      </div>

      <ChatMessageList class="chat-messages" />
      <ChatInput :mobile="isTablet" @send="onSend" />
    </div>

    <aside class="chat-config-wrap desktop-only" :class="{ collapsed: configCollapsed }">
      <template v-if="configCollapsed">
        <button type="button" class="panel-rail" :title="t('chat.expandConfig')" @click="toggleConfig">
          <el-icon><DArrowLeft /></el-icon>
          <span class="rail-text">{{ t('chat.config') }}</span>
        </button>
      </template>
      <template v-else>
        <div class="panel-toolbar">
          <button type="button" class="panel-toggle" :title="t('chat.collapseConfig')" @click="toggleConfig">
            <el-icon><DArrowRight /></el-icon>
          </button>
          <span class="panel-label">{{ t('chat.modelConfig') }}</span>
        </div>
        <div class="panel-body">
          <el-scrollbar>
            <ModelPanel />
          </el-scrollbar>
        </div>
      </template>
    </aside>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { Menu, Setting, DArrowLeft, DArrowRight } from '@element-plus/icons-vue'
import ChatSidebar from '@/components/chat/ChatSidebar.vue'
import ChatMessageList from '@/components/chat/ChatMessageList.vue'
import ChatInput from '@/components/chat/ChatInput.vue'
import ModelPanel from '@/components/chat/ModelPanel.vue'
import MobileDrawer from '@/components/mobile/MobileDrawer.vue'
import { USE_MOCK } from '@/api/request'
import { useChatStore } from '@/stores/chat'
import { useSettingsStore } from '@/stores/settings'
import { useBreakpoint } from '@/composables/useBreakpoint'
import { getItem, setItem } from '@/utils/storage'

import { useI18n } from '@/composables/useI18n'

const chatStore = useChatStore()
const settingsStore = useSettingsStore()
const showSidebar = ref(false)
const showConfig = ref(false)
const { isTablet } = useBreakpoint()
const { t } = useI18n()

const sidebarCollapsed = ref(getItem('chatSidebarCollapsed', false))
const configCollapsed = ref(getItem('chatConfigCollapsed', false))

const currentTitle = computed(() => {
  const conv = chatStore.getActive()
  const title = conv?.title
  if (!title || title === '新对话' || title === 'New Chat') return t('chat.defaultTitle')
  return title
})

function toggleSidebar() {
  sidebarCollapsed.value = !sidebarCollapsed.value
  setItem('chatSidebarCollapsed', sidebarCollapsed.value)
}

function toggleConfig() {
  configCollapsed.value = !configCollapsed.value
  setItem('chatConfigCollapsed', configCollapsed.value)
}

onMounted(async () => {
  await settingsStore.loadModels()
  if (!USE_MOCK) {
    await chatStore.fetchConversations()
  }
  await chatStore.ensureActive()
})

function onSend(content, images) {
  chatStore.sendMessage(content, images)
}
</script>

<style scoped lang="scss">
.chat-root {
  height: 100%;
  overflow: hidden;
}

.chat-page {
  --panel-rail-w: 44px;
  --sidebar-col: var(--sidebar-w);
  --config-col: var(--config-w);

  display: grid;
  grid-template-columns: var(--sidebar-col) 1fr var(--config-col);
  height: 100%;
  overflow: hidden;
  transition: grid-template-columns 0.2s ease;
}

.chat-page.is-sidebar-collapsed {
  --sidebar-col: var(--panel-rail-w);
}

.chat-page.is-config-collapsed {
  --config-col: var(--panel-rail-w);
}

.chat-sidebar-wrap,
.chat-config-wrap {
  position: relative;
  display: flex;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: var(--sidebar-bg);
}

.chat-sidebar-wrap {
  border-right: 1px solid var(--border);
}

.chat-config-wrap {
  border-left: 1px solid var(--border);
}

.chat-sidebar-wrap,
.chat-config-wrap {
  flex-direction: column;
}

.panel-toolbar {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  height: 48px;
  padding: 0 12px;
  border-bottom: 1px solid var(--border);
  background: var(--sidebar-bg);
}

.chat-config-wrap .panel-toolbar {
  flex-direction: row-reverse;
}

.panel-label {
  font-size: 14px;
  font-weight: 500;
  line-height: 22px;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.panel-body {
  flex: 1;
  min-width: 0;
  min-height: 0;
  width: 100%;
  overflow: hidden;
}

.chat-config-wrap .panel-body :deep(.el-scrollbar) {
  height: 100%;
}

.panel-toggle,
.panel-rail {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  transition: color 0.2s, background 0.2s;

  &:hover {
    color: var(--accent);
    background: var(--hover-bg);
  }

  .el-icon {
    font-size: 16px;
  }
}

.panel-toggle {
  flex-shrink: 0;
  width: 28px;
  height: 28px;
  border-radius: 6px;
}

.panel-rail {
  flex: 1;
  flex-direction: column;
  width: 100%;
  min-height: 120px;
  padding: 12px 4px;
  border-radius: 0;
}

.rail-text {
  font-size: 12px;
  writing-mode: vertical-rl;
  letter-spacing: 2px;
  margin-top: 4px;
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
  padding: 0 12px;
  height: 48px;
  background: var(--sidebar-bg);
  border-bottom: 1px solid var(--border);

  .el-button {
    flex-shrink: 0;
    padding: 8px 10px;
    font-size: 13px;
    color: var(--text-body);
  }

  .mobile-title {
    flex: 1;
    min-width: 0;
    text-align: center;
    font-weight: 500;
    font-size: 16px;
    line-height: 24px;
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    padding: 0 4px;
  }
}

@media (max-width: 1200px) {
  .chat-page:not(.is-sidebar-collapsed):not(.is-config-collapsed) {
    grid-template-columns: 220px 1fr 260px;
  }

  .chat-page.is-sidebar-collapsed:not(.is-config-collapsed) {
    grid-template-columns: var(--panel-rail-w) 1fr 260px;
  }

  .chat-page:not(.is-sidebar-collapsed).is-config-collapsed {
    grid-template-columns: 220px 1fr var(--panel-rail-w);
  }
}

@media (max-width: 992px) {
  .chat-page,
  .chat-page.is-sidebar-collapsed,
  .chat-page.is-config-collapsed {
    display: flex;
    flex-direction: column;
    grid-template-columns: unset;
  }

  .chat-center {
    flex: 1;
    width: 100%;
    min-height: 0;
  }
}
</style>
