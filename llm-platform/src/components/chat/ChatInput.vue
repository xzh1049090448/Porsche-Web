<template>
  <div class="chat-input" :class="{ 'is-mobile': mobile }">
    <div v-if="pendingImages.length" class="preview-row">
      <div v-for="(img, i) in pendingImages" :key="i" class="preview-item">
        <el-image :src="img.url" fit="cover" class="preview-img" lazy />
        <el-icon class="remove touch-target" @click="removeImage(i)"><Close /></el-icon>
      </div>
    </div>
    <div class="input-row">
      <el-upload
        v-if="canMultimodal"
        :show-file-list="false"
        accept="image/*"
        :auto-upload="false"
        :on-change="onImageSelect"
      >
        <el-button class="attach-btn touch-target" :icon="Picture" circle />
      </el-upload>
      <el-input
        v-model="text"
        type="textarea"
        :rows="mobile ? 1 : 2"
        :placeholder="placeholder"
        resize="none"
        :disabled="chatStore.streaming"
        class="chat-textarea"
        @keydown="onKeydown"
      />
      <el-button
        type="primary"
        class="send-btn touch-target"
        :icon="Promotion"
        circle
        :loading="chatStore.streaming"
        :disabled="!canSend"
        aria-label="发送"
        @click="send"
      />
    </div>
    <div v-if="settings.useDataset" class="input-hint">
      <el-icon><InfoFilled /></el-icon>
      已启用跨境电商专属数据集
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import { Picture, Promotion, Close, InfoFilled } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { useChatStore } from '@/stores/chat'
import { useSettingsStore } from '@/stores/settings'

const props = defineProps({
  mobile: { type: Boolean, default: false },
})

const emit = defineEmits(['send'])

const chatStore = useChatStore()
const settings = useSettingsStore()
const text = ref('')
const pendingImages = ref([])

const placeholder = computed(() =>
  props.mobile ? '输入问题…' : '输入问题，Enter 发送，Shift+Enter 换行'
)

const canMultimodal = computed(
  () => !settings.compareMode && settings.currentModel()?.multimodal
)

const canSend = computed(
  () => (text.value.trim() || pendingImages.value.length) && !chatStore.streaming
)

function onKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    send()
  }
}

function onImageSelect(file) {
  if (!canMultimodal.value) {
    ElMessage.warning('当前模型不支持多模态')
    return
  }
  pendingImages.value.push({
    url: URL.createObjectURL(file.raw),
    name: file.name,
  })
}

function removeImage(i) {
  pendingImages.value.splice(i, 1)
}

function send() {
  if (!canSend.value) return
  emit('send', text.value, [...pendingImages.value])
  text.value = ''
  pendingImages.value = []
}

defineExpose({
  setText(val) {
    text.value = val
  },
})
</script>

<style scoped lang="scss">
.chat-input {
  flex-shrink: 0;
  min-height: var(--input-h);
  padding: 16px 24px;
  background: var(--app-bg);
  border-top: 1px solid var(--border);
}

.chat-input.is-mobile {
  padding: 12px;
  position: sticky;
  bottom: 0;
  z-index: 100;
}

.preview-row {
  display: flex;
  gap: 8px;
  margin-bottom: 8px;
}

.preview-item {
  position: relative;

  .preview-img {
    width: 64px;
    height: 64px;
    border-radius: 6px;
  }

  .remove {
    position: absolute;
    top: -4px;
    right: -4px;
    background: var(--component-bg);
    border-radius: 50%;
    cursor: pointer;
    color: var(--accent-red);
  }
}

.input-row {
  display: flex;
  gap: 12px;
  align-items: flex-end;
}

.chat-textarea {
  flex: 1;

  :deep(.el-textarea__inner) {
    min-height: 48px !important;
    max-height: 120px;
    padding: 12px;
    line-height: 22px;
    font-size: 14px;
    border-radius: 8px;
    background: var(--component-bg);
    border-color: var(--border);
    color: var(--text-body);
    box-shadow: none;

    &::placeholder {
      color: var(--text-disabled);
    }

    &:hover {
      border-color: var(--border-subtle);
    }

    &:focus {
      border-color: var(--accent);
    }
  }
}

.attach-btn {
  flex-shrink: 0;
  width: 40px;
  height: 40px;
  background: var(--component-bg);
  border-color: var(--border);
  color: var(--text-secondary);

  &:hover {
    background: var(--hover-bg);
    border-color: var(--border-subtle);
    color: var(--text-primary);
  }
}

.send-btn {
  flex-shrink: 0;
  width: 44px;
  height: 44px;
  font-size: 18px;
  transition: transform 0.2s, background 0.2s;

  &:hover:not(:disabled) {
    transform: scale(1.06);
  }

  &:active:not(:disabled) {
    transform: scale(0.96);
  }
}

.input-hint {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  line-height: 18px;
  color: var(--accent-green);
  margin-top: 8px;
}

@media (max-width: 768px) {
  .input-hint {
    font-size: 11px;
  }

  .chat-textarea :deep(.el-textarea__inner) {
    font-size: 16px;
  }
}
</style>
