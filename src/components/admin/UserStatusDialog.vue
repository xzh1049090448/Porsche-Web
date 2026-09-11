<template>
  <el-dialog :model-value="statusStore.isOpen" :title="title" width="min(560px, 92vw)" trap-focus
    :close-on-click-modal="false" :close-on-press-escape="true" @open="onOpen" @open-auto-focus="focusFirst" @close="requestClose" @closed="onClosed" @keydown.esc="requestClose">
    <template v-if="statusStore.target">
      <el-alert v-if="statusStore.state === 'conflict'" ref="errorAlert" tabindex="-1" type="warning" :closable="false" show-icon title="用户状态已变化，正在刷新，请重新确认。" />
      <el-alert v-else-if="statusStore.failureCode" ref="errorAlert" tabindex="-1" type="error" :closable="false" show-icon :title="failureMessage" />
      <p>目标：<strong>{{ statusStore.target.username || statusStore.target.guid }}</strong></p>
      <el-alert :type="isDisable ? 'warning' : 'info'" :closable="false" show-icon :title="consequence" />
      <el-form id="admin-user-status-form" ref="formRef" :model="form" :rules="rules" label-position="top" scroll-to-error @submit.prevent="submit">
        <el-form-item v-if="isDisable" prop="reason" label="禁用原因">
          <el-input ref="reasonInput" v-model="form.reason" type="textarea" :rows="3" autocomplete="off" :disabled="busy" />
          <span class="reason-count" aria-live="polite">{{ reasonCodePointCount }}/200</span>
        </el-form-item>
        <el-form-item prop="confirmed">
          <el-checkbox ref="confirmInput" v-model="form.confirmed" :disabled="busy">{{ confirmation }}</el-checkbox>
        </el-form-item>
      </el-form>
    </template>
    <template #footer>
      <el-button @click="requestClose">取消</el-button>
      <el-button :type="isDisable ? 'danger' : 'primary'" native-type="submit" form="admin-user-status-form" :loading="busy" :disabled="!canSubmit">{{ submitLabel }}</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useAdminUserStatusStore } from '@/stores/admin-user-status'
import { normalizeAdminUserStatusRequest } from '@/api/admin-user-status'

const props = defineProps({ owner: { type: Object, default: null } })
const emit = defineEmits(['closed', 'succeeded', 'conflict', 'failed'])
const statusStore = useAdminUserStatusStore()
const formRef = ref(null); const reasonInput = ref(null); const confirmInput = ref(null); const errorAlert = ref(null)
const form = reactive({ reason: '', confirmed: false })
const validating = ref(false)
let visibleOwner = null; let closingOwner = null
const isDisable = computed(() => statusStore.intendedStatus === 'disabled')
const reasonCodePointCount = computed(() => [...form.reason].length)
const title = computed(() => isDisable.value ? '禁用用户' : '启用用户')
const consequence = computed(() => isDisable.value
  ? '禁用会撤销全部会话并立即阻断该账户的 API Key 调用；重新启用不会恢复旧会话。'
  : '启用后用户需要重新登录；已撤销或过期的 API Key 不会恢复。')
const confirmation = computed(() => isDisable.value ? '我已了解禁用影响并确认继续' : '我确认启用该用户')
const busy = computed(() => validating.value || statusStore.state === 'submitting')
const canSubmit = computed(() => Boolean(statusStore.target) && form.confirmed && !busy.value && ['idle', 'failed'].includes(statusStore.state))
const submitLabel = computed(() => statusStore.state === 'failed' ? '重新提交' : (isDisable.value ? '确认禁用' : '确认启用'))
const failureMessage = computed(() => ({ authentication_failed:'认证会话已失效', forbidden:'当前无权执行此操作', not_found:'用户不存在或不可见', unavailable:'服务暂不可用，请重新填写并重试', request_too_large:'请求内容过大', request_failed:'请求失败，请重新填写并重试' }[statusStore.failureCode] || '请求失败，请刷新后重试'))

function normalizedRequest() {
  return normalizeAdminUserStatusRequest({ targetGuid: statusStore.target?.guid, status: statusStore.intendedStatus,
    reason: isDisable.value ? form.reason : null, expectedAuthVersion: statusStore.target?.authVersion })
}
function validateReason(_rule, _value, done) { try { normalizedRequest(); done() } catch { done(new Error('请输入 1–200 个字符的禁用原因')) } }
function validateConfirmed(_rule, value, done) { value === true ? done() : done(new Error('请完成二次确认')) }
const rules = computed(() => ({ reason: isDisable.value ? [{ validator:validateReason, trigger:['blur','change'] }] : [], confirmed:[{ validator:validateConfirmed, trigger:'change' }] }))
function clearForm() {
  form.reason = ''; form.confirmed = false
  const nativeReason = reasonInput.value?.textarea ?? reasonInput.value?.$el?.querySelector?.('textarea')
  if (nativeReason) nativeReason.value = ''
  formRef.value?.clearValidate?.()
}
function focusConfirmation() { confirmInput.value?.$el?.querySelector?.('input[type="checkbox"]')?.focus?.() }
function focusFirst(event) { event?.preventDefault?.(); const token = props.owner; nextTick(() => nextTick(() => { if (!statusStore.owns(token)) return; if (isDisable.value) reasonInput.value?.focus?.(); else focusConfirmation() })) }
function focusError(token) { nextTick(() => { if (statusStore.owns(token)) errorAlert.value?.$el?.focus?.() }) }
function onOpen() { visibleOwner = props.owner; clearForm(); focusFirst() }
function closeOwned(token) { if (!statusStore.owns(token)) return false; closingOwner = token; clearForm(); validating.value = false; return statusStore.close(token) }
function requestClose() { if (props.owner) closeOwned(props.owner) }
function onClosed() { const token = closingOwner ?? visibleOwner; closingOwner = null; if (statusStore.isOpen) return; visibleOwner = null; clearForm(); emit('closed', token) }
async function submit() {
  const token = props.owner
  if (!token || !statusStore.owns(token) || !canSubmit.value) return
  if (statusStore.state === 'failed' && !statusStore.reset(token)) return
  validating.value = true
  try { await formRef.value?.validate?.() } catch {
    nextTick(() => { if (!statusStore.owns(token)) return; if (isDisable.value) reasonInput.value?.focus?.(); else focusConfirmation() })
    return
  } finally { validating.value = false }
  if (!statusStore.owns(token)) return
  let request
  try { request = normalizedRequest() } catch { return }
  const result = await statusStore.submit(token, { reason: request.reason })
  if (!statusStore.owns(token) || !result) return
  clearForm()
  if (result.state === 'succeeded') { emit('succeeded', result.user, token); closeOwned(token) }
  else if (result.state === 'conflict') emit('conflict', token)
  else if (result.state === 'failed') { emit('failed', result.failureCode, token); focusError(token) }
}
watch(() => statusStore.dialogRevision, () => { if (statusStore.isOpen) onOpen() })
watch(() => statusStore.isOpen, (open, previous) => {
  if (!open && previous) { clearForm(); validating.value = false; if (!closingOwner) closingOwner = visibleOwner ?? props.owner }
}, { flush: 'sync' })
onMounted(() => { if (statusStore.isOpen) onOpen(); else clearForm() })
onBeforeUnmount(() => { validating.value = false; clearForm() })
</script>

<style scoped>
.reason-count { display: block; width: 100%; color: var(--el-text-color-secondary); text-align: right; font-size: 12px; }
</style>
