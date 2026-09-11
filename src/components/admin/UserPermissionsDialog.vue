<script>
import { normalizeRolePermissionOverrides } from '../../api/admin-user-roles-permissions.js'
function validText(value) {
  if (typeof value !== 'string' || /[\uD800-\uDFFF]/u.test(value)) throw new TypeError('invalid_role_permission_dialog_input')
  return value
}
export function normalizePermissionsDialogInput(input) {
  const reason = validText(input?.reason).trim()
  const currentPassword = validText(input?.currentPassword)
  if (!reason || [...reason].length > 200 || !currentPassword) throw new TypeError('invalid_role_permission_dialog_input')
  return { reason, currentPassword, overrides: normalizeRolePermissionOverrides(input?.overrides).map(item => ({ ...item })) }
}
</script>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useAdminUserRolePermissionsStore } from '../../stores/admin-user-role-permissions.js'
import UserPermissionEditor, { buildPermissionEditorModel } from './UserPermissionEditor.vue'

const props = defineProps({ owner:{ type:Object, default:null }, catalog:{ type:Object, required:true }, policy:{ type:Object, required:true } })
const emit = defineEmits(['succeeded','conflict','failed','closed'])
const rolePermissionStore = useAdminUserRolePermissionsStore()
const formRef = ref(null); const reasonInput = ref(null); const passwordInput = ref(null); const errorAlert = ref(null)
const validating = ref(false); const form = reactive({ reason:'', currentPassword:'' }); const overrides = ref([])
let visibleOwner = null; let closingOwner = null
const visible = computed(()=>rolePermissionStore.isOpen && rolePermissionStore.action==='users.permissions.write' && rolePermissionStore.owns(props.owner))
const busy = computed(() => validating.value || ['verifying','executing','querying'].includes(rolePermissionStore.phase))
const editorValid = computed(() => props.policy?.user_guid===rolePermissionStore.target?.guid && buildPermissionEditorModel(props.catalog,props.policy,overrides.value).valid)
const canSubmit = computed(() => Boolean(rolePermissionStore.target) && rolePermissionStore.phase === 'idle' && !busy.value && editorValid.value)
const failureMessage = computed(() => ({ authentication_failed:'认证会话已失效，请重新登录。', action_verification_rejected:'验证被拒绝，请确认当前密码。', action_operation_rejected:'当前操作已被拒绝。', action_dependency_unavailable:'服务暂不可用，请稍后重新发起。', action_rate_limited:'请求过于频繁，请稍后重新发起。' }[rolePermissionStore.failureCode] || '请求失败，请重新发起。'))
function initialOverrides() { return props.policy?.capabilities?.flatMap(item => item?.override === 'allow' || item?.override === 'deny' ? [{ capability:item.name, effect:item.override }] : []) ?? [] }
function nativePassword() { return passwordInput.value?.input ?? passwordInput.value?.$el?.querySelector?.('input') }
function clearPassword() { form.currentPassword=''; const input=nativePassword(); if (input) input.value='' }
function clearForm() { clearPassword(); form.reason=''; overrides.value=[]; formRef.value?.clearValidate?.() }
function resetForm() { clearPassword(); form.reason=''; overrides.value=initialOverrides(); formRef.value?.clearValidate?.() }
function normalizedInput() { return normalizePermissionsDialogInput({ reason:form.reason, currentPassword:form.currentPassword, overrides:overrides.value }) }
function validReason() { try { const value=validText(form.reason).trim(); return Boolean(value)&&[...value].length<=200 } catch { return false } }
function validateReason(_rule,_value,done) { validReason() ? done() : done(new Error('请输入 1–200 个字符的原因。')) }
function validatePassword(_rule,value,done) { typeof value === 'string' && value.length > 0 && !/[\uD800-\uDFFF]/u.test(value) ? done() : done(new Error('请输入当前密码。')) }
const rules={ reason:[{validator:validateReason,trigger:['blur','change']}], currentPassword:[{validator:validatePassword,trigger:['blur','change']}] }
function focusFirst(event) { event?.preventDefault?.(); const token=props.owner; nextTick(()=>nextTick(()=>{ if(rolePermissionStore.owns(token)) reasonInput.value?.focus?.() })) }
function focusError(token) { nextTick(()=>{ if(!rolePermissionStore.owns(token))return;const root=errorAlert.value?.$el;const alert=root?.matches?.('[role="alert"]')?root:root?.querySelector?.('[role="alert"]');if(alert){alert.tabIndex=-1;alert.focus()} }) }
function onOpen() { visibleOwner=props.owner; resetForm(); focusFirst() }
function closeOwned(token) { if(!rolePermissionStore.owns(token)) return false; closingOwner=token; clearForm(); validating.value=false; return rolePermissionStore.close(token) }
function requestClose() { if(props.owner) closeOwned(props.owner) }
function onClosed() { const token=closingOwner ?? visibleOwner; closingOwner=null; if(rolePermissionStore.isOpen) return; visibleOwner=null; clearForm(); emit('closed',token) }
function consumeInput() { try { return normalizedInput() } finally { clearPassword() } }
async function submit() {
  const token=props.owner
  if(!token || !rolePermissionStore.owns(token) || !canSubmit.value) return
  validating.value=true
  try { await formRef.value?.validate?.() } catch { nextTick(()=>{ if(rolePermissionStore.owns(token)) reasonInput.value?.focus?.() }); return } finally { validating.value=false }
  if(!rolePermissionStore.owns(token)) return
  const running=rolePermissionStore.submit(token,consumeInput); if(!running) return
  const result=await running
  if(!rolePermissionStore.owns(token) || !result) return
  if(result.phase==='succeeded') { emit('succeeded',result,token); closeOwned(token) }
  else if(result.phase==='conflict') { emit('conflict',token); focusError(token) }
  else if(result.phase==='failed') { emit('failed',result.failureCode,token); focusError(token) }
}
watch(()=>rolePermissionStore.dialogRevision,()=>{ if(visible.value) onOpen() })
watch(visible,(open,previous)=>{ if(!open&&previous){ clearPassword(); if(!closingOwner) closingOwner=visibleOwner??props.owner } },{flush:'sync'})
onMounted(()=>{ if(visible.value) onOpen(); else clearForm() })
onBeforeUnmount(()=>{ const token=props.owner; clearForm(); if(rolePermissionStore.owns(token)) rolePermissionStore.close(token) })
</script>

<template>
  <el-dialog :model-value="visible" title="修改管理员权限" width="min(720px, 94vw)" trap-focus :close-on-click-modal="false" :close-on-press-escape="true" @open="onOpen" @open-auto-focus="focusFirst" @close="requestClose" @closed="onClosed" @keydown.esc="requestClose">
    <template v-if="rolePermissionStore.target">
      <el-alert v-if="rolePermissionStore.phase==='pending_recovery'" ref="errorAlert" tabindex="-1" type="warning" :closable="false" show-icon title="结果待确认，请稍后重新查询，切勿重复提交。" />
      <el-alert v-else-if="rolePermissionStore.phase==='conflict'" ref="errorAlert" tabindex="-1" type="warning" :closable="false" show-icon title="用户或权限状态已变化，请刷新后重新确认。" />
      <el-alert v-else-if="rolePermissionStore.phase==='failed'" ref="errorAlert" tabindex="-1" type="error" :closable="false" show-icon :title="failureMessage" />
      <p>目标：<strong>{{ rolePermissionStore.target.username || rolePermissionStore.target.guid }}</strong></p>
      <el-alert type="warning" :closable="false" show-icon title="保存权限会使目标管理员的全部现有会话立即失效，需要重新登录。" />
      <el-form id="admin-user-permissions-form" ref="formRef" :model="form" :rules="rules" label-position="top" scroll-to-error @submit.prevent="submit">
        <el-form-item prop="reason" label="操作原因"><el-input ref="reasonInput" v-model="form.reason" type="textarea" :rows="3" autocomplete="off" :disabled="busy" /></el-form-item>
        <UserPermissionEditor v-model="overrides" :catalog="catalog" :policy="policy" />
        <el-form-item prop="currentPassword" label="Root 当前密码"><el-input ref="passwordInput" v-model="form.currentPassword" type="password" autocomplete="current-password" :disabled="busy" /></el-form-item>
      </el-form>
    </template>
    <template #footer><el-button @click="requestClose">取消</el-button><el-button type="primary" native-type="submit" form="admin-user-permissions-form" :loading="busy" :disabled="!canSubmit">保存权限</el-button></template>
  </el-dialog>
</template>

<style scoped>
p { margin:12px 0; }
</style>
