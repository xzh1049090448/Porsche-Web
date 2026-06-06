<template>
  <div class="model-panel">
    <div class="panel-title">
      <el-icon><Cpu /></el-icon>
      {{ t('model.select') }}
      <span v-if="settings.compareMode" class="panel-lock-hint">{{ t('model.compareLocked') }}</span>
    </div>

    <div
      class="model-select-block"
      :class="{ 'is-locked': settings.compareMode }"
      role="radiogroup"
      :aria-label="t('model.selectAria')"
    >
      <button
        v-for="m in settings.models"
        :key="m.id"
        type="button"
        role="radio"
        class="model-item"
        :class="{ active: settings.selectedModelId === m.id }"
        :aria-checked="settings.selectedModelId === m.id"
        :disabled="settings.compareMode || (settings.modelsLoaded && m.registered === false)"
        @click="onSingleModelChange(m.id)"
      >
        <span class="model-icon">{{ m.icon }}</span>
        <span class="model-info">
          <span class="model-name">{{ m.name }}</span>
          <span class="model-desc">{{ modelDesc(m) }}</span>
        </span>
        <span
          v-if="settings.modelsLoaded && m.registered === false"
          class="type-tag tag-warning"
        >{{ t('model.unregistered') }}</span>
        <span v-else class="type-tag" :style="{ background: typeTag(m).color }">
          {{ typeTag(m).label }}
        </span>
      </button>
    </div>

    <el-divider />

    <div class="panel-subtitle">{{ t('model.scenarios') }}</div>
    <div class="scenario-list">
      <button
        v-for="s in localizedScenarios"
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
          <div class="panel-subtitle">{{ t('model.compare') }}</div>
          <el-switch
            :model-value="settings.compareMode"
            @change="settings.setCompareMode"
          />
        </div>
        <template v-if="settings.compareMode">
          <p class="hint">{{ t('model.compareHint') }}</p>
          <el-checkbox-group
            :model-value="settings.compareModelIds"
            class="compare-grid"
            @change="onCompareModelsChange"
          >
            <el-checkbox
              v-for="m in settings.models"
              :key="m.id"
              :value="m.id"
              :disabled="settings.modelsLoaded && m.registered === false"
              class="compare-check"
            >
              <span class="model-icon sm">{{ m.icon }}</span>
              <span class="model-name">{{ m.name }}</span>
            </el-checkbox>
          </el-checkbox-group>
        </template>
      </div>
    </template>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { ElMessage } from 'element-plus'
import { Cpu } from '@element-plus/icons-vue'
import { useSettingsStore } from '@/stores/settings'
import { SCENARIO_PRESETS } from '@/constants/scenario-presets'
import { MODEL_TYPE_TAGS } from '@/constants/models'
import { useI18n } from '@/composables/useI18n'

const settings = useSettingsStore()
const { t } = useI18n()

const localizedScenarios = computed(() =>
  SCENARIO_PRESETS.map((s) => ({
    ...s,
    name: t(`scenarios.${s.id}.name`),
    desc: t(`scenarios.${s.id}.desc`),
  }))
)

function modelDesc(m) {
  const key = `models.${m.id}.desc`
  const translated = t(key)
  return translated === key ? m.desc || m.vendor : translated
}

function typeTag(m) {
  const type = m.multimodal ? 'multimodal' : m.type || 'chat'
  return {
    label: t(`modelType.${type}`),
    color: MODEL_TYPE_TAGS[type]?.color || MODEL_TYPE_TAGS.chat.color,
  }
}

function onSingleModelChange(id) {
  if (settings.compareMode) return
  if (settings.modelsLoaded && settings.models.find((m) => m.id === id)?.registered === false) return
  settings.setModel(id)
}

function onCompareModelsChange(ids) {
  if (!ids.length) {
    ElMessage.warning(t('model.compareMin'))
    return
  }
  settings.setCompareModelIds(ids)
}
</script>

<style scoped lang="scss">
.model-panel {
  padding: 16px 12px;
}

.panel-title {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  font-weight: 500;
  font-size: 16px;
  line-height: 24px;
  color: var(--text-primary);
  margin-bottom: 16px;
}

.panel-lock-hint {
  font-size: 12px;
  font-weight: 400;
  color: var(--text-secondary);
}

.model-select-block.is-locked {
  opacity: 0.5;
  pointer-events: none;
  user-select: none;
}

.model-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  height: 72px;
  padding: 12px;
  margin-bottom: 4px;
  border: none;
  border-left: 3px solid transparent;
  border-radius: 0;
  background: transparent;
  cursor: pointer;
  text-align: left;
  transition: background 0.2s, border-color 0.2s;

  &:hover:not(:disabled) {
    background: var(--hover-bg);
  }

  &.active {
    background: var(--active-item-bg);
    border-left-color: var(--accent);

    .model-name {
      color: var(--text-primary);
    }
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
}

.model-icon {
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  border-radius: 6px;
  background: var(--model-icon-bg);
  color: var(--accent);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  font-weight: 700;

  &.sm {
    width: 22px;
    height: 22px;
    font-size: 11px;
  }
}

.model-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.model-name {
  font-size: 16px;
  font-weight: 500;
  line-height: 24px;
  color: var(--text-body);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.model-desc {
  font-size: 12px;
  line-height: 18px;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.type-tag {
  flex-shrink: 0;
  height: 20px;
  padding: 0 8px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 500;
  line-height: 20px;
  color: #fff;
  white-space: nowrap;

  &.tag-warning {
    background: var(--accent-yellow);
    color: #1f2937;
  }
}

.panel-subtitle {
  font-size: 14px;
  font-weight: 500;
  line-height: 22px;
  color: var(--text-primary);
  margin-bottom: 8px;
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
  border-left: 3px solid transparent;
  border-radius: 8px;
  background: transparent;
  cursor: pointer;
  text-align: left;
  transition: border-color 0.2s, background 0.2s;

  &:hover {
    background: var(--hover-bg);
  }

  &.active {
    border-color: var(--border);
    border-left-color: var(--accent);
    background: var(--active-item-bg);
  }
}

.scenario-name {
  font-size: 14px;
  font-weight: 500;
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
  line-height: 18px;
}

.compare-grid {
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 100%;
}

.compare-check {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  margin-right: 0;
  height: auto;
  padding: 8px 10px;
  border-radius: 6px;
  background: transparent;
  transition: background 0.2s;

  &:hover {
    background: var(--hover-bg);
  }

  :deep(.el-checkbox__label) {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--text-body);
  }
}
</style>
