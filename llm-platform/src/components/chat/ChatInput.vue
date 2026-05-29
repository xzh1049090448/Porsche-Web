<template>
  <div class="chat-input">
    <div v-if="pendingImages.length" class="preview-row">
      <div v-for="(img, i) in pendingImages" :key="i" class="preview-item">
        <el-image :src="img.url" fit="cover" class="preview-img" />
        <el-icon class="remove" @click="removeImage(i)"><Close /></el-icon>
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
        <el-button :icon="Picture" circle />
      </el-upload>
      <el-input
        v-model="text"
        type="textarea"
        :rows="2"
        placeholder="输入问题，Enter 发送，Shift+Enter 换行"
        resize="none"
        :disabled="chatStore.streaming"
        @keydown="onKeydown"
      />
      <el-button
        type="primary"
        :icon="Promotion"
        :loading="chatStore.streaming"
        :disabled="!canSend"
        @click="send"
      >
        发送
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
/** 后端暂未提供独立上传接口，多模态图片以本地预览展示 */

const emit = defineEmits(['send'])

const chatStore = useChatStore()
const settings = useSettingsStore()
const text = ref('')
const pendingImages = ref([])

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
}

.input-hint {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--accent-green);
  margin-top: 8px;
}
</style>
