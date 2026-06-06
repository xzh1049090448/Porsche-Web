<template>
  <Teleport to="body">
    <Transition name="drawer">
      <div v-if="show" class="drawer-overlay" @click="close">
        <div
          class="drawer-content"
          :class="position"
          role="dialog"
          aria-modal="true"
          @click.stop
        >
          <div class="drawer-header">
            <div class="drawer-title">
              <slot name="header">{{ title }}</slot>
            </div>
            <button type="button" class="close-btn" aria-label="关闭" @click="close">
              <el-icon><Close /></el-icon>
            </button>
          </div>
          <div class="drawer-body">
            <slot />
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
import { watch, onUnmounted } from 'vue'
import { Close } from '@element-plus/icons-vue'

const props = defineProps({
  show: { type: Boolean, default: false },
  position: { type: String, default: 'left' },
  title: { type: String, default: '' },
})

const emit = defineEmits(['update:show', 'close'])

function close() {
  emit('update:show', false)
  emit('close')
}

watch(
  () => props.show,
  (open) => {
    document.body.style.overflow = open ? 'hidden' : ''
  }
)

onUnmounted(() => {
  document.body.style.overflow = ''
})
</script>

<style scoped lang="scss">
.drawer-overlay {
  position: fixed;
  inset: 0;
  z-index: 2000;
  background: var(--drawer-overlay);
}

.drawer-content {
  position: absolute;
  top: 0;
  bottom: 0;
  width: min(300px, 88vw);
  background: var(--panel-bg);
  box-shadow: var(--drawer-shadow);
  display: flex;
  flex-direction: column;
  will-change: transform;

  &.left {
    left: 0;
  }

  &.right {
    right: 0;
  }
}

.drawer-header {
  flex-shrink: 0;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  font-weight: 600;
  font-size: 16px;
}

.drawer-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.close-btn {
  flex-shrink: 0;
  width: 44px;
  height: 44px;
  margin: -8px -8px -8px 0;
  border: none;
  background: transparent;
  border-radius: 8px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--text-secondary);

  &:active {
    background: var(--hover-bg);
  }

  .el-icon {
    font-size: 20px;
  }
}

.drawer-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}

.drawer-enter-active,
.drawer-leave-active {
  transition: opacity 0.25s ease;

  .drawer-content {
    transition: transform 0.25s ease;
  }
}

.drawer-enter-from,
.drawer-leave-to {
  opacity: 0;

  .drawer-content.left {
    transform: translateX(-100%);
  }

  .drawer-content.right {
    transform: translateX(100%);
  }
}
</style>
