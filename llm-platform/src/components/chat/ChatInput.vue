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
        <el-button class="touch-target" :icon="Picture" circle />
      </el-upload>
      <el-input
        v-model="text"
        type="textarea"
        :rows="mobile ? 1 : 2"
        :placeholder="placeholder"
        resize="none"
        :disabled="chatStore.streaming"
        @keydown="onKeydown"
      />
      <el-button
        type="primary"
        class="send-btn touch-target"
        :icon="Promotion"
        :loading="chatStore.streaming"
        :disabled="!canSend"
        @click="send"
      >
        <span v-if="!mobile">发送</span>
      </el-button>
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
  padding: 12px 20px 16px;
  background: #fff;
  border-top: 1px solid var(--border);
}

.chat-input.is-mobile {
  padding: 10px 12px 12px;
  position: sticky;
  bottom: 0;
  z-index: 100;
  background: var(--panel-bg);
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
    background: #fff;
    border-radius: 50%;
    cursor: pointer;
    color: #f56c6c;
  }
}

.input-row {
  display: flex;
  gap: 8px;
  align-items: flex-end;

  .el-textarea {
    flex: 1;
  }

  :deep(.el-textarea__inner) {
    padding: 10px 12px;
    max-height: 120px;
    line-height: 1.5;
  }
}

.is-mobile .input-row {
  :deep(.el-textarea__inner) {
    font-size: 16px;
  }

  .send-btn {
    min-width: 44px;
    height: 44px;
    padding: 0 14px;
  }
}

.input-hint {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--accent-green);
  margin-top: 8px;
}

@media (max-width: 768px) {
  .input-hint {
    font-size: 11px;
  }
}
</style>
