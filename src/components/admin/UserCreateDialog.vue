<template>
  <el-dialog
    :model-value="createStore.isOpen"
    :title="t('createUser.title')"
    width="min(680px, 94vw)"
    trap-focus
    :close-on-click-modal="false"
    :close-on-press-escape="true"
    @open="focusUsername"
    @open-auto-focus="focusUsername"
    @close="requestClose"
    @closed="onClosed"
    @keydown.esc="requestClose"
  >
    <el-alert v-if="createStore.state === 'pending_recovery'" ref="errorAlert" tabindex="-1" type="warning" :closable="false" show-icon :title="t('createUser.pendingRecovery')">
      <p v-if="createStore.operationRef">{{ t('createUser.operationReference') }}: <code>{{ createStore.operationRef }}</code></p>
    </el-alert>
    <el-alert v-else-if="createStore.failureCode" ref="errorAlert" tabindex="-1" type="error" :closable="false" show-icon :title="failureMessage" />

    <el-form ref="formRef" :model="form" :rules="rules" label-position="top" scroll-to-error @submit.prevent="submit">
      <el-form-item prop="username" :label="t('createUser.username')">
        <el-input ref="usernameInput" v-model="form.username" autocomplete="off" maxlength="20" :disabled="busy" />
      </el-form-item>
      <el-form-item prop="nickname" :label="t('createUser.nickname')">
        <el-input ref="nicknameInput" v-model="form.nickname" autocomplete="off" maxlength="64" :disabled="busy" />
      </el-form-item>
      <div class="field-grid">
        <el-form-item prop="password" :label="t('createUser.password')">
          <el-input ref="passwordInput" v-model="form.password" type="password" autocomplete="new-password" :disabled="busy" />
        </el-form-item>
        <el-form-item prop="confirmPassword" :label="t('createUser.confirmPassword')">
          <el-input ref="confirmPasswordInput" v-model="form.confirmPassword" type="password" autocomplete="new-password" :disabled="busy" />
        </el-form-item>
      </div>

      <el-form-item prop="role" :label="t('createUser.role')">
        <el-select v-if="createStore.actorRole === 'root'" v-model="form.role" :disabled="busy" @change="changeRole">
          <el-option :label="t('createUser.roles.user')" value="user" />
          <el-option :label="t('createUser.roles.admin')" value="admin" />
        </el-select>
        <el-input v-else :model-value="t('createUser.roles.user')" disabled />
      </el-form-item>

      <el-form-item prop="groupGuid" :label="t('createUser.group')">
        <el-select v-if="hasGroupDirectory" v-model="form.groupGuid" :loading="createStore.groupsLoading" :disabled="busy || createStore.groupsError">
          <el-option v-for="group in createStore.groups" :key="group.key" :label="group.displayName" :value="group.guid" :disabled="!canChooseGroup(group)" />
        </el-select>
        <el-input v-else :model-value="t('createUser.defaultGroup')" disabled />
        <p v-if="createStore.groupsError" class="field-error">{{ t('createUser.groupsUnavailable') }}</p>
        <p v-else-if="!hasGroupDirectory" class="field-help">{{ t('createUser.defaultGroupHelp') }}</p>
      </el-form-item>

      <el-form-item prop="planType" :label="t('createUser.plan')">
        <el-select v-model="form.planType" :disabled="busy">
          <el-option :label="t('createUser.plans.free')" value="free" />
          <el-option :label="t('createUser.plans.professional')" value="professional" :disabled="!canChoosePlan('professional')" />
          <el-option :label="t('createUser.plans.enterprise')" value="enterprise" :disabled="!canChoosePlan('enterprise')" />
        </el-select>
      </el-form-item>

      <section v-if="form.role === 'admin'" class="permissions" :aria-label="t('createUser.permissions')">
        <h3>{{ t('createUser.permissions') }}</h3>
        <el-skeleton v-if="createStore.catalogLoading" :rows="4" animated />
        <el-alert v-else-if="createStore.catalogError" type="error" :closable="false" :title="t('createUser.catalogUnavailable')">
          <template #default><el-button link type="primary" @click="retryCatalog">{{ t('createUser.retry') }}</el-button></template>
        </el-alert>
        <div v-else class="permission-list">
          <div v-for="row in permissionRows" :key="row.name" class="permission-row">
            <span><code>{{ row.name }}</code><small>{{ row.admin_default ? t('createUser.defaultAllow') : t('createUser.defaultDeny') }}</small></span>
            <el-select v-model="permissionEffects[row.name]" :disabled="busy" :aria-label="row.name">
              <el-option :label="t('createUser.effects.inherit')" value="inherit" />
              <el-option :label="t('createUser.effects.allow')" value="allow" />
              <el-option :label="t('createUser.effects.deny')" value="deny" />
            </el-select>
          </div>
        </div>
        <el-form-item prop="currentPassword" :label="t('createUser.currentPassword')">
          <el-input ref="currentPasswordInput" v-model="form.currentPassword" type="password" autocomplete="current-password" :disabled="busy" />
        </el-form-item>
      </section>
    </el-form>

    <template #footer>
      <el-button @click="requestClose">{{ t('createUser.cancel') }}</el-button>
      <el-button type="primary" :loading="busy" :disabled="!canSubmit" @click="submit">{{ submitLabel }}</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useAdminUserCreateStore, buildAdminPermissionOverrides, canChooseAdminUserCreateGroup, canChooseAdminUserCreatePlan, canSubmitAdminUserCreate, clearAdminUserCreateSecrets, focusAdminUserCreateError, focusAdminUserCreateInvalidField, isAdminUserCreateBusy, normalizeAdminUserCreateFormAuthorization, settleAdminUserCreateClosed, settleAdminUserCreateDialog } from '@/stores/admin-user-create'
import { useI18n } from '@/composables/useI18n'

const emit = defineEmits(['closed'])
const createStore = useAdminUserCreateStore()
const { t } = useI18n()
const formRef = ref(null)
const usernameInput = ref(null)
const nicknameInput = ref(null)
const passwordInput = ref(null)
const confirmPasswordInput = ref(null)
const currentPasswordInput = ref(null)
const errorAlert = ref(null)
const form = reactive({ username: '', nickname: '', password: '', confirmPassword: '', role: 'user', groupGuid: null, planType: 'free', currentPassword: '' })
const permissionEffects = reactive({})
const busy = computed(() => createStore.authorizing || isAdminUserCreateBusy(createStore.state))
const canSubmit = computed(() => canSubmitAdminUserCreate({ state: createStore.state, role: form.role, catalog: createStore.catalog, authorizing: createStore.authorizing }))
const hasGroupDirectory = computed(() => createStore.capabilities.includes('groups.read'))
const permissionRows = computed(() => createStore.catalog?.capabilities?.filter(item => item.grantable && !item.root_only && item.available) ?? [])
const knownFailures = new Set(['username_conflict', 'action_group_not_found', 'policy_version_conflict', 'action_verification_conflict', 'idempotency_conflict', 'authentication_failed'])
const weakPasswords = new Set(['password', 'password123', '12345678', 'qwerty123', 'porsche', 'porsche@2026'])
const failureMessage = computed(() => t(`createUser.failures.${knownFailures.has(createStore.failureCode) ? createStore.failureCode : 'request_failed'}`))
const submitLabel = computed(() => busy.value ? t(`createUser.states.${createStore.state}`) : t('createUser.submit'))

const validateUsername = (_rule, value, callback) => /^[A-Za-z0-9_-]{3,20}$/.test(value.trim()) ? callback() : callback(new Error(t('createUser.usernameInvalid')))
const validateNickname = (_rule, value, callback) => value === '' || value.trim() && [...value.trim()].length <= 64 ? callback() : callback(new Error(t('createUser.nicknameInvalid')))
const validatePassword = (_rule, value, callback) => [...value].length >= 8 && [...value].length <= 20 && !weakPasswords.has(value.trim().toLowerCase()) ? callback() : callback(new Error(t('createUser.passwordInvalid')))
const validateConfirmation = (_rule, value, callback) => value === form.password ? callback() : callback(new Error(t('createUser.passwordMismatch')))
const validateCurrentPassword = (_rule, value, callback) => form.role !== 'admin' || value.length > 0 ? callback() : callback(new Error(t('createUser.currentPasswordRequired')))
const rules = computed(() => ({
  username: [{ validator: validateUsername, trigger: 'blur' }],
  nickname: [{ validator: validateNickname, trigger: 'blur' }],
  password: [{ validator: validatePassword, trigger: 'blur' }],
  confirmPassword: [{ required: true, message: t('createUser.confirmPasswordRequired'), trigger: 'blur' }, { validator: validateConfirmation, trigger: 'blur' }],
  currentPassword: [{ validator: validateCurrentPassword, trigger: 'blur' }],
}))

function resetPermissionEffects() {
  for (const key of Object.keys(permissionEffects)) delete permissionEffects[key]
  for (const row of permissionRows.value) permissionEffects[row.name] = 'inherit'
}
function clearSecrets() {
  clearAdminUserCreateSecrets({
    form,
    passwordInputs: [passwordInput, confirmPasswordInput, currentPasswordInput],
    clearValidate: () => formRef.value?.clearValidate?.(['password', 'confirmPassword', 'currentPassword']),
  })
}
function clearForm() {
  clearSecrets()
  form.username = ''
  form.nickname = ''
  form.role = 'user'
  form.groupGuid = null
  form.planType = 'free'
  resetPermissionEffects()
  formRef.value?.clearValidate?.()
}
function requestClose() {
  const token = createStore.captureOwnership()
  if (token) createStore.closeDialog(token)
}
function onClosed() {
  settleAdminUserCreateClosed({ currentToken: createStore.captureOwnership(), clearForm, emitClosed: () => emit('closed') })
}
function focusUsername(event) {
  event?.preventDefault?.()
  const token = createStore.captureOwnership()
  if (!token) return
  nextTick(() => nextTick(() => { if (createStore.owns(token)) usernameInput.value?.focus?.() }))
}
function focusError(token) { focusAdminUserCreateError({ token, owns: createStore.owns, errorAlert, nextTick }) }
const canChoosePlan = plan => canChooseAdminUserCreatePlan(createStore.capabilities, plan)
const canChooseGroup = group => canChooseAdminUserCreateGroup(createStore.capabilities, group)
async function changeRole(role) {
  const token = createStore.captureOwnership()
  if (!token) return
  clearSecrets()
  resetPermissionEffects()
  if (!await createStore.setRole(token, role) && createStore.owns(token)) form.role = createStore.role
}
async function retryCatalog() {
  const token = createStore.captureOwnership()
  if (token) await createStore.refreshCatalog(token)
}
async function submit() {
  if (!canSubmit.value) return
  const token = createStore.captureOwnership()
  if (!token) return
  try { await formRef.value?.validate?.() } catch (invalidFields) {
    focusAdminUserCreateInvalidField({
      token,
      owns: createStore.owns,
      invalidFields,
      formRef,
      controls: { username: usernameInput, nickname: nicknameInput, password: passwordInput, confirmPassword: confirmPasswordInput, currentPassword: currentPasswordInput },
      nextTick,
    })
    return
  }
  if (!createStore.owns(token)) return
  let permissionOverrides
  try { permissionOverrides = buildAdminPermissionOverrides({ role: form.role, catalog: createStore.catalog, effects: permissionEffects }) } catch {
    focusError(token)
    return
  }
  const running = createStore.submit(token, {
    username: form.username,
    nickname: form.nickname === '' ? null : form.nickname,
    password: form.password,
    role: form.role,
    groupGuid: form.groupGuid,
    planType: form.planType,
    permissionOverrides,
    currentPassword: form.role === 'admin' ? form.currentPassword : null,
  })
  clearSecrets()
  if (!running) return
  const result = await running
  settleAdminUserCreateDialog({ token, result, owns: createStore.owns, close: createStore.closeDialog, focusError })
}

watch(permissionRows, resetPermissionEffects)
watch(() => createStore.authorizing, active => { if (active) clearSecrets() }, { flush: 'sync' })
watch(() => createStore.authorizationRevision, () => normalizeAdminUserCreateFormAuthorization({
  form,
  permissionEffects,
  actorRole: createStore.actorRole,
  role: createStore.role,
  capabilities: createStore.capabilities,
  groups: createStore.groups,
  catalog: createStore.catalog,
}))
watch(() => createStore.groups, groups => {
  if (!createStore.isOpen) return
  if (!hasGroupDirectory.value) {
    form.groupGuid = null
    return
  }
  if (!groups.some(group => group.guid === form.groupGuid)) form.groupGuid = groups.find(group => group.key === 'default')?.guid ?? null
})
watch(() => createStore.role, role => { if (form.role !== role) { clearSecrets(); form.role = role; resetPermissionEffects() } })
watch(() => createStore.dialogRevision, () => {
  clearForm()
  form.role = createStore.role
  if (createStore.isOpen) focusUsername()
})
watch(() => createStore.isOpen, open => { if (!open && !createStore.captureOwnership()) clearSecrets() })
onMounted(() => {
  const token = createStore.captureOwnership()
  nextTick(() => {
    if (token && createStore.owns(token)) clearForm()
    else if (!token) clearForm()
  })
})
onBeforeUnmount(() => {
  clearSecrets()
  const token = createStore.captureOwnership()
  if (token) createStore.disposeDialog(token)
})
</script>

<style scoped>
.field-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.permissions{border-top:1px solid var(--border-color);margin-top:8px;padding-top:12px}.permissions h3{margin:0 0 12px}.permission-list{display:grid;gap:8px;margin-bottom:16px;max-height:260px;overflow:auto}.permission-row{display:grid;grid-template-columns:minmax(0,1fr) 150px;gap:12px;align-items:center}.permission-row span{display:flex;flex-direction:column;min-width:0}.permission-row code{overflow-wrap:anywhere}.permission-row small,.field-help{color:var(--text-secondary)}.field-error{color:var(--el-color-danger)}p{margin:4px 0}code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}@media(max-width:640px){.field-grid,.permission-row{grid-template-columns:1fr}}
</style>
