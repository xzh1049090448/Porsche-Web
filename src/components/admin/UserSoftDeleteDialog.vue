<template>
  <el-dialog
    :model-value="actionStore.isOpen"
    :title="t('deleteUser.title')"
    width="min(560px, 92vw)"
    trap-focus
    :close-on-click-modal="false"
    :close-on-press-escape="true"
    @open="focusReason"
    @close="requestClose"
    @closed="onClosed"
    @keydown.esc="onEscape"
  >
    <template v-if="actionStore.target">
      <el-alert type="error" :closable="false" show-icon :title="t('deleteUser.irreversible')">
        <p>{{ t('deleteUser.usernameOccupied') }}</p>
        <p>{{ t('deleteUser.credentialsInvalidated') }}</p>
      </el-alert>
      <el-descriptions :column="1" border class="target">
        <el-descriptions-item :label="t('deleteUser.username')">{{ actionStore.target.username || t('deleteUser.unsetUsername') }}</el-descriptions-item>
        <el-descriptions-item label="GUID"><code>{{ actionStore.target.guid }}</code></el-descriptions-item>
      </el-descriptions>
      <el-alert v-if="actionStore.state === 'pending_recovery'" ref="errorAlert" tabindex="-1" type="warning" :closable="false" show-icon :title="t('deleteUser.pendingRecovery')">
        <p v-if="actionStore.operationRef">{{ t('deleteUser.operationReference') }}: <code>{{ actionStore.operationRef }}</code></p>
      </el-alert>
      <el-alert v-else-if="actionStore.failureCode" ref="errorAlert" type="error" tabindex="-1" :closable="false" show-icon :title="failureMessage" />
      <el-form ref="formRef" :model="form" :rules="rules" label-position="top" scroll-to-error @submit.prevent="submit">
        <el-form-item prop="reason" :label="t('deleteUser.reason')">
          <el-input ref="reasonInput" v-model="form.reason" type="textarea" maxlength="200" show-word-limit :disabled="busy" @input="actionStore.setReason" />
        </el-form-item>
        <el-form-item prop="password" :label="t('deleteUser.currentPassword')">
          <el-input ref="passwordInput" v-model="form.password" type="password" autocomplete="current-password" :disabled="busy" @input="actionStore.setPassword" />
        </el-form-item>
      </el-form>
    </template>
    <template #footer>
      <el-button @click="requestClose">{{ t('deleteUser.cancel') }}</el-button>
      <el-button type="danger" :loading="busy" :disabled="!canSubmit" @click="submit">{{ submitLabel }}</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { computed, nextTick, reactive, ref, watch } from 'vue'
import { useAdminUserActionsStore } from '@/stores/admin-user-actions'
import { canSubmitUserDelete, focusDeleteError, isDeleteBusy } from '@/stores/admin-user-actions'
import { useI18n } from '@/composables/useI18n'

const emit = defineEmits(['closed'])
const actionStore = useAdminUserActionsStore()
const { t } = useI18n()
const formRef = ref(null)
const reasonInput = ref(null)
const passwordInput = ref(null)
const errorAlert = ref(null)
const form = reactive({ reason: '', password: '' })
const busy = computed(() => isDeleteBusy(actionStore.state))
const canSubmit = computed(() => canSubmitUserDelete({ state: actionStore.state, target: actionStore.target }))
const rules = computed(() => ({
  reason: [{ required: true, whitespace: true, message: t('deleteUser.reasonRequired'), trigger: 'blur' }],
  password: [{ required: true, message: t('deleteUser.passwordRequired'), trigger: 'blur' }],
}))
const knownFailures = new Set(['authentication_failed', 'target_version_conflict', 'target_state_conflict', 'action_verification_conflict'])
const failureMessage = computed(() => t(`deleteUser.failures.${knownFailures.has(actionStore.failureCode) ? actionStore.failureCode : 'request_failed'}`))
const submitLabel = computed(() => busy.value ? t(`deleteUser.states.${actionStore.state}`) : t('deleteUser.confirm'))

function clearForm() {
  form.reason = ''
  form.password = ''
  actionStore.setReason('')
  actionStore.setPassword('')
  formRef.value?.clearValidate?.()
}
function requestClose() { actionStore.close() }
function onEscape() { requestClose() }
function onClosed() { clearForm(); emit('closed') }
function focusReason() { nextTick(() => reasonInput.value?.focus?.()) }
function focusError() { focusDeleteError({ errorAlert, nextTick }) }
async function submit() {
  if (!canSubmit.value) return
  try { await formRef.value?.validate?.() } catch {
    nextTick(() => (form.reason.trim() ? passwordInput.value : reasonInput.value)?.focus?.())
    return
  }
  actionStore.setReason(form.reason)
  actionStore.setPassword(form.password)
  form.password = ''
  const result = await actionStore.submit()
  if (result?.state === 'succeeded') actionStore.close()
  else if (result?.state === 'failed' || result?.state === 'pending_recovery') focusError()
}
watch(() => actionStore.isOpen, open => { if (!open) clearForm() })
</script>

<style scoped>
.target { margin: 16px 0; }
p { margin: 4px 0; }
code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; overflow-wrap: anywhere; }
</style>
