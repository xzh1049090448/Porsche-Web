<template>
  <div class="model-panel">
    <div class="panel-title">
      <el-icon><Cpu /></el-icon>
      模型选择
      <span v-if="settings.compareMode" class="panel-lock-hint">对比模式下不可选</span>
    </div>

    <div
      class="model-select-block"
      :class="{ 'is-locked': settings.compareMode }"
    >
      <el-radio-group
        v-if="settings.models.length"
        :model-value="settings.selectedModelId"
        class="model-grid"
        :disabled="settings.compareMode"
        @change="onSingleModelChange"
      >
        <el-radio
          v-for="m in settings.models"
          :key="m.id"
          :value="m.id"
          :disabled="settings.compareMode || !m.registered"
          border
          class="model-radio"
        >
        <span class="model-icon">{{ m.icon }}</span>
        <span class="model-name">{{ m.name }}</span>
        <el-tag v-if="!m.registered" size="small" type="warning">未注册</el-tag>
        <el-tag v-else-if="m.multimodal" size="small" type="info">多模态</el-tag>
      </el-radio>
    </el-radio-group>
    </div>

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

    <template v-if="settings.models.length > 1">
      <el-divider />
      <div class="compare-section">
        <div class="compare-header">
          <div class="panel-subtitle">模型对比</div>
          <el-switch
            :model-value="settings.compareMode"
            @change="settings.setCompareMode"
          />
        </div>
        <template v-if="settings.compareMode">
          <p class="hint">勾选要对比的模型，发送时将并行生成多个回复</p>
          <el-checkbox-group
            :model-value="settings.compareModelIds"
            class="model-grid"
            @change="onCompareModelsChange"
          >
            <el-checkbox
              v-for="m in settings.models"
              :key="m.id"
              :value="m.id"
              :disabled="!m.registered"
              border
              class="model-check"
            >
              <span class="model-icon">{{ m.icon }}</span>
              <span class="model-name">{{ m.name }}</span>
              <el-tag v-if="!m.registered" size="small" type="warning">未注册</el-tag>
            </el-checkbox>
          </el-checkbox-group>
        </template>
      </div>
    </template>
  </div>
</template>

<script setup>
import { ElMessage } from 'element-plus'
import { Cpu } from '@element-plus/icons-vue'
import { useSettingsStore } from '@/stores/settings'
import { SCENARIO_PRESETS } from '@/constants/scenario-presets'

const settings = useSettingsStore()

function onSingleModelChange(id) {
  if (settings.compareMode) return
  settings.setModel(id)
}

function onCompareModelsChange(ids) {
  if (!ids.length) {
    ElMessage.warning('至少选择 1 个模型')
    return
  }
  settings.setCompareModelIds(ids)
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
  flex-wrap: wrap;
  font-weight: 600;
  font-size: 14px;
  margin-bottom: 12px;
}

.panel-lock-hint {
  font-size: 12px;
  font-weight: 400;
  color: var(--text-secondary);
}

.model-select-block.is-locked {
  opacity: 0.55;
  pointer-events: none;
  user-select: none;

  :deep(.el-radio) {
    cursor: not-allowed;
  }
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

  :deep(.el-radio),
  :deep(.el-checkbox) {
    margin-right: 0;
    width: 100%;
    height: auto;
    padding: 8px 10px;
  }
}

.model-radio,
.model-check {
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

.compare-section {
  .compare-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 8px;

    .panel-subtitle {
      margin-bottom: 0;
    }
  }
}

.hint {
  font-size: 12px;
  color: var(--text-secondary);
  margin: 0 0 8px;
}
</style>
