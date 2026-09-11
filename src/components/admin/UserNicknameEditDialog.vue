<template>
  <el-dialog
    :model-value="editStore.isOpen"
    :title="t('editUser.title')"
    width="min(520px, 92vw)"
    trap-focus
    :close-on-click-modal="false"
    :close-on-press-escape="true"
    @open="onOpen"
    @open-auto-focus="focusNickname"
    @close="requestClose"
    @closed="onClosed"
    @keydown.esc="requestClose"
  >
    <template v-if="editStore.target">
      <el-alert v-if="editStore.state === 'conflict'" ref="errorAlert" tabindex="-1" type="warning" :closable="false" show-icon :title="t('editUser.conflictRefreshing')" />
      <el-alert v-else-if="editStore.failureCode" ref="errorAlert" tabindex="-1" type="error" :closable="false" show-icon :title="failureMessage" />
      <el-form id="admin-user-nickname-edit-form" ref="formRef" :model="form" :rules="rules" label-position="top" scroll-to-error @submit.prevent="submit">
        <el-form-item prop="nickname" :label="t('editUser.nickname')">
          <el-input ref="nicknameInput" v-model="form.nickname" autocomplete="off" :disabled="busy" />
          <p class="field-help">{{ t('editUser.clearHelp') }}</p>
        </el-form-item>
      </el-form>
    </template>
    <template #footer>
      <el-button @click="requestClose">{{ t('editUser.cancel') }}</el-button>
      <el-button type="primary" native-type="submit" form="admin-user-nickname-edit-form" :loading="busy" :disabled="!canSubmit">{{ submitLabel }}</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue'
import { useAdminUserEditStore } from '@/stores/admin-user-edit'
import { normalizeAdminUserEditRequest } from '@/api/admin-user-edit'
import { useI18n } from '@/composables/useI18n'

const props = defineProps({ owner: { type: Object, default: null } })
const emit = defineEmits(['closed', 'succeeded', 'conflict', 'failed'])
const editStore = useAdminUserEditStore()
const { t } = useI18n()
const formRef = ref(null)
const nicknameInput = ref(null)
const errorAlert = ref(null)
const form = reactive({ nickname: '' })
let visibleOwner = null
let closingOwner = null

const busy = computed(() => editStore.state === 'submitting')
const canSubmit = computed(() => Boolean(editStore.target) && ['idle', 'failed'].includes(editStore.state))
const submitLabel = computed(() => editStore.state === 'failed' ? t('editUser.retry') : t('editUser.submit'))
const knownFailures = new Set(['authentication_failed', 'forbidden', 'not_found', 'unavailable'])
const failureMessage = computed(() => t(`editUser.failures.${knownFailures.has(editStore.failureCode) ? editStore.failureCode : 'request_failed'}`))

function normalizedRequest() {
  const nickname = typeof form.nickname === 'string' && form.nickname.trim() === '' ? null : form.nickname
  return normalizeAdminUserEditRequest({ targetGuid: editStore.target?.guid, nickname, expectedAuthVersion: editStore.target?.authVersion })
}
function validateNickname(_rule, _value, done) {
  try { normalizedRequest(); done() } catch { done(new Error(t('editUser.nicknameInvalid'))) }
}
const rules = computed(() => ({ nickname: [{ validator: validateNickname, trigger: ['blur', 'change'] }] }))
function clearForm() { form.nickname = ''; formRef.value?.clearValidate?.() }
function syncForm() { form.nickname = editStore.target?.nickname ?? ''; formRef.value?.clearValidate?.() }
function focusNickname(event) {
  event?.preventDefault?.()
  const token = props.owner
  if (!token) return
  nextTick(() => nextTick(() => { if (editStore.owns(token)) nicknameInput.value?.focus?.() }))
}
function focusError(token) { nextTick(() => { if (editStore.owns(token)) errorAlert.value?.$el?.focus?.() }) }
function onOpen() { visibleOwner = props.owner; syncForm(); focusNickname() }
function closeOwned(token) { if (!editStore.owns(token)) return false; closingOwner = token; return editStore.close(token) }
function requestClose() { const token = props.owner; if (token) closeOwned(token) }
function onClosed() {
  const token = closingOwner ?? visibleOwner
  closingOwner = null
  if (editStore.isOpen) return
  visibleOwner = null
  clearForm()
  emit('closed', token)
}
async function submit() {
  const token = props.owner
  if (!token || !editStore.owns(token) || !canSubmit.value) return
  if (editStore.state === 'failed' && !editStore.reset(token)) return
  try { await formRef.value?.validate?.() } catch {
    if (editStore.owns(token)) nextTick(() => { if (editStore.owns(token)) nicknameInput.value?.focus?.() })
    return
  }
  if (!editStore.owns(token)) return
  let request
  try { request = normalizedRequest() } catch { return }
  const result = await editStore.submit(token, { nickname: request.nickname })
  if (!editStore.owns(token) || !result) return
  if (result.state === 'succeeded') {
    emit('succeeded', result.user, token)
    closeOwned(token)
  } else if (result.state === 'conflict') emit('conflict', token)
  else if (result.state === 'failed') { emit('failed', result.failureCode, token); focusError(token) }
}

watch(() => editStore.dialogRevision, () => { if (editStore.isOpen) { visibleOwner = props.owner; syncForm(); focusNickname() } })
watch(() => editStore.target, () => { if (editStore.isOpen) syncForm() })
watch(() => editStore.isOpen, (open, previous) => { if (!open && previous && !closingOwner) closingOwner = visibleOwner ?? props.owner })
onMounted(() => { if (editStore.isOpen) onOpen(); else clearForm() })
</script>

<style scoped>
.field-help { margin: 4px 0 0; color: var(--el-text-color-secondary); font-size: 13px; }
</style>
