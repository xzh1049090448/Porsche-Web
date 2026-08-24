<template>
  <el-tooltip :content="tooltip" placement="bottom">
    <el-button
      class="theme-toggle touch-target"
      text
      circle
      :icon="isDark ? Sunny : Moon"
      :aria-label="tooltip"
      @click="themeStore.toggleTheme()"
    />
  </el-tooltip>
</template>

<script setup>
import { computed } from 'vue'
import { Moon, Sunny } from '@element-plus/icons-vue'
import { useThemeStore } from '@/stores/theme'
import { useI18n } from '@/composables/useI18n'

const themeStore = useThemeStore()
const { t } = useI18n()
const isDark = computed(() => themeStore.isDark)
const tooltip = computed(() => (isDark.value ? t('theme.toLight') : t('theme.toDark')))
</script>

<style scoped lang="scss">
.theme-toggle {
  color: var(--text-secondary);
  font-size: 18px;

  &:hover {
    color: var(--accent);
    background: var(--hover-bg);
  }
}
</style>
