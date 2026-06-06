<template>
  <div class="dataset-panel">
    <div class="panel-title">
      <el-icon><Collection /></el-icon>
      专属数据集
    </div>

    <el-radio-group
      :model-value="settings.useDataset"
      class="dataset-mode"
      @change="settings.setUseDataset"
    >
      <el-radio :value="false" border>仅使用模型通用知识</el-radio>
      <el-radio :value="true" border>使用跨境电商专属 Token 数据集</el-radio>
    </el-radio-group>

    <template v-if="settings.useDataset">
      <el-divider />
      <div class="panel-subtitle">子数据集（可多选）</div>
      <el-skeleton v-if="!settings.datasetsLoaded" :rows="3" animated />
      <el-checkbox-group
        v-else
        :model-value="settings.selectedDatasetIds"
        class="dataset-list"
        @change="settings.setDatasetIds"
      >
        <el-checkbox
          v-for="d in settings.datasets"
          :key="d.id"
          :label="d.id"
          class="dataset-check"
        >
          <div class="ds-item">
            <span>{{ d.icon }} {{ d.name }}</span>
            <p>{{ d.desc }}</p>
          </div>
        </el-checkbox>
      </el-checkbox-group>
      <el-alert
        type="success"
        :closable="false"
        show-icon
        class="trust-tip"
        :title="DATASET_BADGE_TEXT"
      />
    </template>
  </div>
</template>

<script setup>
import { Collection } from '@element-plus/icons-vue'
import { useSettingsStore } from '@/stores/settings'
import { DATASET_BADGE_TEXT } from '@/constants/datasets'

const settings = useSettingsStore()
</script>

<style scoped lang="scss">
.dataset-panel {
  padding: 16px 12px;
  border-top: 1px solid var(--border);
}

.panel-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: 500;
  font-size: 16px;
  line-height: 24px;
  color: var(--text-primary);
  margin-bottom: 16px;
}

.panel-subtitle {
  font-size: 14px;
  font-weight: 500;
  line-height: 22px;
  color: var(--text-primary);
  margin-bottom: 8px;
}

.dataset-mode {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;

  :deep(.el-radio) {
    margin-right: 0;
    width: 100%;
    height: auto;
    padding: 10px 12px;
    white-space: normal;
    background: transparent;
    border-color: var(--border);
    border-radius: 8px;
    transition: background 0.2s, border-color 0.2s;

    &:hover {
      background: var(--hover-bg);
    }

    &.is-checked {
      background: var(--component-bg);
      border-color: var(--accent);
    }

    .el-radio__label {
      color: var(--text-body);
    }
  }
}

.dataset-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.dataset-check {
  width: 100%;
  margin-right: 0;
  height: auto;
  align-items: flex-start;
  padding: 8px;
  border-radius: 6px;
  transition: background 0.2s;

  &:hover {
    background: var(--hover-bg);
  }

  :deep(.el-checkbox__label) {
    white-space: normal;
    line-height: 1.4;
    color: var(--text-body);
  }
}

.ds-item {
  p {
    margin: 4px 0 0;
    font-size: 11px;
    color: var(--text-secondary);
    font-weight: normal;
  }
}

.trust-tip {
  margin-top: 12px;

  :deep(.el-alert__title) {
    font-size: 12px;
    line-height: 1.4;
  }
}
</style>
