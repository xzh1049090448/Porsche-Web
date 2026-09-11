<template>
  <div v-if="status" class="generation-status" :class="`is-${status}`">
    <p class="status-copy" aria-live="polite" aria-atomic="true">
      {{ t(`chat.generationStates.${status}`) }}
    </p>
    <button
      v-if="showStop"
      type="button"
      class="stop-button"
      :disabled="!stoppable"
      :aria-label="t('chat.stopGeneration')"
      @click="stop"
    >
      {{ t(status === 'cancelling' ? 'chat.stoppingGeneration' : 'chat.stopGeneration') }}
    </button>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useChatStore } from '@/stores/chat'
import { useI18n } from '@/composables/useI18n'
import { canCancelGeneration, generationLifecycleStatus } from '@/components/chat/generation-ui'

const chatStore = useChatStore()
const { t } = useI18n()
const status = computed(() => generationLifecycleStatus(chatStore.generationState))
const stoppable = computed(() => chatStore.streaming && canCancelGeneration(chatStore.generationState))
const showStop = computed(() => stoppable.value || status.value === 'cancelling')

function stop() {
  if (!stoppable.value) return
  void chatStore.cancelStream()
}
</script>

<style scoped lang="scss">
.generation-status {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  min-height: 42px;
  padding: 6px 16px;
  border-top: 1px solid var(--border);
  background: var(--component-bg);
}

.status-copy {
  margin: 0;
  color: var(--text-secondary);
  font-size: 13px;
  line-height: 20px;
}

.is-failed .status-copy,
.is-disconnected .status-copy {
  color: var(--danger);
}

.stop-button {
  min-width: 96px;
  min-height: 34px;
  padding: 6px 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: transparent;
  color: var(--text-primary);
  cursor: pointer;

  &:disabled {
    color: var(--text-disabled);
    cursor: not-allowed;
  }
}

@media (max-width: 768px) {
  .generation-status {
    justify-content: space-between;
    padding-inline: 12px;
  }
}
</style>
