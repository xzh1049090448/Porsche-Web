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
    <button
      v-if="showRetry"
      type="button"
      class="retry-button"
      :disabled="retrying || status !== 'disconnected'"
      :aria-label="t('chat.retryGeneration')"
      @click="retry"
    >
      {{ t(retrying ? 'chat.retryingGeneration' : 'chat.retryGeneration') }}
    </button>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useChatStore } from '@/stores/chat'
import { useI18n } from '@/composables/useI18n'
import { canCancelGeneration, generationLifecycleStatus } from '@/components/chat/generation-ui'

const chatStore = useChatStore()
const { t } = useI18n()
const rawStatus = computed(() => generationLifecycleStatus(chatStore.generationState))
const status = ref(rawStatus.value)
let statusRevision = 0
let recoveryTimer = null
watch(rawStatus, next => {
  const revision = ++statusRevision
  if (recoveryTimer !== null) {
    clearTimeout(recoveryTimer)
    recoveryTimer = null
  }
  if (next === 'recovering' && status.value === 'disconnected') {
    recoveryTimer = setTimeout(() => {
      recoveryTimer = null
      if (statusRevision === revision && rawStatus.value === next) status.value = next
    }, 0)
    return
  }
  status.value = next
}, { flush: 'sync' })
onBeforeUnmount(() => {
  if (recoveryTimer !== null) clearTimeout(recoveryTimer)
})
const stoppable = computed(() => chatStore.streaming && canCancelGeneration(chatStore.generationState))
const showStop = computed(() => stoppable.value || status.value === 'cancelling')
const retrying = ref(false)
const showRetry = computed(() => status.value === 'disconnected' || retrying.value)

function stop() {
  if (!stoppable.value) return
  void chatStore.cancelStream()
}

async function retry() {
  if (retrying.value || status.value !== 'disconnected') return
  retrying.value = true
  try {
    await chatStore.retryPendingGeneration()
  } finally {
    retrying.value = false
  }
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

.stop-button,
.retry-button {
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
