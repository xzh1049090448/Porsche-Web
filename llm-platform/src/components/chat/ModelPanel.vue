<template>
  <div class="model-panel">
    <div class="panel-title">
      <el-icon><Cpu /></el-icon>
      模型选择
    </div>

    <div v-if="settings.models.length === 1" class="model-single">
      <span class="model-icon">{{ settings.models[0].icon }}</span>
      <div class="model-single-info">
        <span class="model-name">{{ settings.models[0].name }}</span>
        <span class="model-vendor">{{ settings.models[0].vendor }}</span>
      </div>
      <el-tag v-if="settings.models[0].multimodal" size="small" type="info">多模态</el-tag>
    </div>
    <el-radio-group
      v-else
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

    <div class="panel-subtitle">使用场景</div>
    <div class="scenario-list">
      <button
        v-for="s in SCENARIO_PRESETS"
        :key="s.id"
        type="button"
        class="scenario-btn"
        :class="{ active: settings.selectedScenarioId === s.id }"
        @click="settings.setScenario(s.id)"
      >
        <span class="scenario-name">{{ s.name }}</span>
        <span class="scenario-desc">{{ s.desc }}</span>
      </button>
    </div>

    <el-divider />

    <template v-if="settings.models.length > 1">
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
    </template>
  </div>
</template>

<script setup>
import { onMounted, watch } from 'vue'
import { Cpu } from '@element-plus/icons-vue'
import { useSettingsStore } from '@/stores/settings'
import { useChatStore } from '@/stores/chat'
import { SCENARIO_PRESETS } from '@/constants/scenario-presets'

const settings = useSettingsStore()
const chatStore = useChatStore()

function applySingleModelDefaults() {
  if (settings.models.length === 1) {
    settings.setModel(settings.models[0].id)
    if (settings.compareMode) {
      settings.toggleCompare(false)
      chatStore.clearCompare()
    }
  }
}

onMounted(() => {
  if (settings.modelsLoaded) applySingleModelDefaults()
})

watch(
  () => settings.modelsLoaded,
  (loaded) => {
    if (loaded) applySingleModelDefaults()
  }
)

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

.model-single {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: #fafafa;
}

.model-single-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;

  .model-name {
    font-weight: 600;
    font-size: 14px;
  }
}

.model-vendor {
  font-size: 12px;
  color: var(--text-secondary);
}

.scenario-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.scenario-btn {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: #fff;
  cursor: pointer;
  text-align: left;
  transition: border-color 0.15s, background 0.15s;

  &:hover {
    border-color: #c6e2ff;
    background: #f5f9ff;
  }

  &.active {
    border-color: var(--accent);
    background: #ecf5ff;
    box-shadow: inset 3px 0 0 var(--accent);
  }
}

.scenario-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}

.scenario-desc {
  font-size: 12px;
  line-height: 1.4;
  color: var(--text-secondary);
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
