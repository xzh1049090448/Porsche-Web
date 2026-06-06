<template>
  <el-tooltip :content="tooltip" placement="bottom">
    <el-button
      class="locale-toggle touch-target"
      text
      circle
      :aria-label="tooltip"
      @click="localeStore.toggleLocale()"
    >
      {{ isEn ? '中' : 'EN' }}
    </el-button>
  </el-tooltip>
</template>

<script setup>
import { computed } from 'vue'
import { useLocaleStore } from '@/stores/locale'
import { useI18n } from '@/composables/useI18n'

const localeStore = useLocaleStore()
const { isEn, t } = useI18n()
const tooltip = computed(() => (isEn.value ? t('locale.toZh') : t('locale.toEn')))
</script>

<style scoped lang="scss">
.locale-toggle {
  min-width: 36px;
  height: 36px;
  padding: 0;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: var(--text-secondary);

  &:hover {
    color: var(--accent);
    background: var(--hover-bg);
  }
}
</style>
