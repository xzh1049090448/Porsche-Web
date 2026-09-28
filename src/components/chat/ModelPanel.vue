<template>
  <div class="model-panel model-surface">
    <p v-if="settings.modelLoadError" class="catalog-status is-error">{{ t('model.catalogUnavailable') }}</p>
    <p v-else-if="settings.catalogStale" class="catalog-status">{{ t('model.catalogStale') }}</p>
    <div class="panel-title">
      <el-icon><Cpu /></el-icon>
      {{ t('model.select') }}
      <span v-if="settings.compareMode" class="panel-lock-hint">{{ t('model.compareLocked') }}</span>
    </div>

    <el-input
      v-if="settings.modelsLoaded"
      v-model="searchTerm"
      clearable
      class="model-search"
      :placeholder="t('model.searchPlaceholder')"
      :aria-label="t('model.searchAria')"
    />

    <div
      class="model-select-block"
      :class="{ 'is-locked': settings.compareMode }"
      role="radiogroup"
      :aria-label="t('model.selectAria')"
    >
      <button
        v-for="m in filteredModels"
        :key="m.id"
        type="button"
        role="radio"
        class="model-item"
        :class="{ active: settings.selectedModelId === m.id }"
        :aria-checked="settings.selectedModelId === m.id"
        :disabled="disabled || settings.compareMode || chatStore.streaming"
        @click="onSingleModelChange(m.id)"
      >
        <span class="model-icon">{{ m.icon }}</span>
        <span class="model-info">
          <span class="model-name">{{ m.name }}</span>
          <span class="model-desc">{{ modelDesc(m) }}</span>
        </span>
        <span class="type-tag" :style="{ background: typeTag(m).color }">
          {{ typeTag(m).label }}
        </span>
      </button>
    </div>
    <el-empty
      v-if="searchTerm.trim() && !filteredModels.length"
      :description="t('model.searchEmpty')"
      :image-size="80"
    />

    <el-divider />

    <div class="panel-subtitle">{{ t('model.scenarios') }}</div>
    <div class="scenario-list">
      <button
        v-for="s in localizedScenarios"
        :key="s.id"
        type="button"
        class="scenario-btn"
        :class="{ active: settings.selectedScenarioId === s.id }"
        :disabled="disabled || chatStore.streaming"
        @click="settings.setScenario(s.id)"
      >
        <span class="scenario-name">{{ s.name }}</span>
        <span class="scenario-desc">{{ s.desc }}</span>
      </button>
    </div>

    <template v-if="settings.models.length > 1 || settings.compareMode">
      <el-divider />
      <div class="compare-section">
        <div class="compare-header">
          <div class="panel-subtitle">{{ t('model.compare') }}</div>
          <el-switch
            :model-value="settings.compareMode"
            :disabled="disabled || chatStore.streaming"
            @change="settings.setCompareMode"
          />
        </div>
        <template v-if="settings.compareMode">
          <p class="hint">{{ t('model.compareHint') }}</p>
          <p
            id="compare-model-validation"
            class="compare-validation"
            :class="{ 'is-error': !compareValidation.valid }"
            role="status"
            aria-live="polite"
          >
            {{ compareValidationText }}
          </p>
          <el-checkbox-group
            v-if="filteredModels.length"
            :model-value="settings.compareModelIds"
            class="compare-grid"
            :disabled="disabled || chatStore.streaming"
            :aria-invalid="!compareValidation.valid"
            aria-describedby="compare-model-validation"
            @change="onCompareModelsChange"
          >
            <el-checkbox
              v-for="m in filteredModels"
              :key="m.id"
              :value="m.id"
              class="compare-check"
              :disabled="disabled || chatStore.streaming || (!settings.compareModelIds.includes(m.id) && settings.compareModelIds.length >= 3)"
            >
              <span class="model-icon sm">{{ m.icon }}</span>
              <span class="model-name">{{ m.name }}</span>
            </el-checkbox>
          </el-checkbox-group>
          <el-empty
            v-else-if="searchTerm.trim()"
            :description="t('model.searchEmpty')"
            :image-size="80"
          />
        </template>
      </div>
    </template>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { Cpu } from '@element-plus/icons-vue'
import { useSettingsStore } from '@/stores/settings'
import { useChatStore } from '@/stores/chat'
import { SCENARIO_PRESETS } from '@/constants/scenario-presets'
import { useI18n } from '@/composables/useI18n'
import { filterModels } from '@/utils/model-search'
import { validateGenerationSelection } from '@/components/chat/generation-ui'

defineProps({
  disabled: { type: Boolean, default: false },
})

const MODEL_TYPE_TAGS = {
  chat: { color: 'var(--tag-chat)' },
  multimodal: { color: 'var(--tag-multimodal)' },
}

const settings = useSettingsStore()
const chatStore = useChatStore()
const { t } = useI18n()
const searchTerm = ref('')
const filteredModels = computed(() => filterModels(settings.models, searchTerm.value))
const compareValidation = computed(() => validateGenerationSelection(settings))
const compareValidationText = computed(() => compareValidation.value.valid
  ? t('model.compareValid', { count: compareValidation.value.models.length })
  : t(selectionMessageKey(compareValidation.value.code)))

function selectionMessageKey(code) {
  if (code === 'compare_duplicate') return 'model.compareDuplicate'
  if (code === 'compare_cardinality') return 'model.compareCardinality'
  if (code === 'invalid_model') return 'model.invalidModel'
  return 'model.invalidSelection'
}

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
  settings.setModel(id)
}

function onCompareModelsChange(ids) {
  const validation = validateGenerationSelection({ ...settings, compareMode: true, compareModelIds: ids })
  if (!validation.valid) {
    ElMessage.warning(t(selectionMessageKey(validation.code)))
    return
  }
  settings.setCompareModelIds(validation.models)
}
</script>

<style scoped lang="scss">
.model-panel {
  padding: 16px 12px;
}

.catalog-status {
  margin: 0 0 12px;
  font-size: 12px;
  line-height: 18px;
  color: var(--text-secondary);

  &.is-error {
    color: var(--danger);
  }
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

.model-search {
  margin: 0 0 12px;
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

.compare-validation {
  margin: 0 0 8px;
  color: var(--text-secondary);
  font-size: 12px;
  line-height: 18px;

  &.is-error {
    color: var(--danger);
  }
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
