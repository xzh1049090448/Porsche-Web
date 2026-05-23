<template>
  <div class="model-panel">
    <div class="panel-title">
      <el-icon><Cpu /></el-icon>
      模型选择
    </div>

    <el-radio-group
      :model-value="settings.selectedModelId"
      class="model-grid"
      :disabled="settings.compareMode"
      @change="settings.setModel"
    >
      <el-radio
        v-for="m in settings.models"
        :key="m.id"
        :value="m.id"
        border
        class="model-radio"
      >
        <span class="model-icon">{{ m.icon }}</span>
        <span class="model-name">{{ m.name }}</span>
        <el-tag v-if="m.multimodal" size="small" type="info">多模态</el-tag>
      </el-radio>
    </el-radio-group>

    <el-divider />

    <div class="panel-subtitle">参数调整</div>
    <div class="param-item">
      <span>温度 Temperature</span>
      <el-slider
        :model-value="settings.modelParams.temperature"
        :min="0"
        :max="1"
        :step="0.1"
        show-input
        :show-input-controls="false"
        @update:model-value="(v) => settings.setModelParams({ temperature: v })"
      />
    </div>
    <div class="param-item">
      <span>最大输出 Token</span>
      <el-input-number
        :model-value="settings.modelParams.maxTokens"
        :min="256"
        :max="8192"
        :step="256"
        size="small"
        @update:model-value="(v) => settings.setModelParams({ maxTokens: v })"
      />
    </div>
    <div class="param-item">
      <span>上下文轮数</span>
      <el-input-number
        :model-value="settings.modelParams.contextWindow"
        :min="1"
        :max="50"
        size="small"
        @update:model-value="(v) => settings.setModelParams({ contextWindow: v })"
      />
    </div>

    <el-divider />

    <div class="compare-row">
      <span>模型对比</span>
      <el-switch
        :model-value="settings.compareMode"
        @change="onCompareToggle"
      />
    </div>
    <template v-if="settings.compareMode">
      <p class="hint">同一问题将同时调用所选模型</p>
      <el-checkbox-group
        :model-value="settings.compareModelIds"
        class="compare-check"
        @change="settings.setCompareModels"
      >
        <el-checkbox v-for="m in settings.models" :key="m.id" :label="m.id">
          {{ m.name }}
        </el-checkbox>
      </el-checkbox-group>
    </template>
  </div>
</template>

<script setup>
import { onMounted } from 'vue'
import { Cpu } from '@element-plus/icons-vue'
import { useSettingsStore } from '@/stores/settings'
import { useChatStore } from '@/stores/chat'

const settings = useSettingsStore()
const chatStore = useChatStore()

onMounted(() => {
  if (!settings.modelsLoaded) settings.loadModels()
})

function onCompareToggle(val) {
  settings.toggleCompare(val)
  if (!val) chatStore.clearCompare()
}
</script>

<style scoped lang="scss">
.model-panel {
  padding: 12px;
}

.panel-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: 600;
  font-size: 14px;
  margin-bottom: 12px;
}

.panel-subtitle {
  font-size: 13px;
  font-weight: 500;
  margin-bottom: 8px;
}

.model-grid {
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 100%;

  :deep(.el-radio) {
    margin-right: 0;
    width: 100%;
    height: auto;
    padding: 8px 10px;
  }
}

.model-radio {
  display: flex;
  align-items: center;
  gap: 6px;
}

.model-icon {
  width: 22px;
  height: 22px;
  border-radius: 4px;
  background: #ecf5ff;
  color: var(--accent);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 700;
}

.model-name {
  flex: 1;
  font-size: 13px;
}

.param-item {
  margin-bottom: 12px;

  > span {
    display: block;
    font-size: 12px;
    color: var(--text-secondary);
    margin-bottom: 4px;
  }
}

.compare-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 13px;
  font-weight: 500;
}

.hint {
  font-size: 12px;
  color: var(--text-secondary);
  margin: 8px 0;
}

.compare-check {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 160px;
  overflow-y: auto;
}
</style>
