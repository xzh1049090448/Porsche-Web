<template>
  <div class="api-keys-page page-container">
    <div class="page-heading">
      <div>
        <h1 class="page-title">{{ t('apiKeys.title') }}</h1>
        <p class="page-description">{{ t('apiKeys.description') }}</p>
      </div>
      <el-button type="primary" @click="openCreate">{{ t('apiKeys.create') }}</el-button>
    </div>

    <el-row :gutter="16" class="summary-cards">
      <el-col :xs="24" :sm="8"><el-card shadow="never"><el-statistic :title="t('apiKeys.active')" :value="summary.active" /></el-card></el-col>
      <el-col :xs="24" :sm="8"><el-card shadow="never"><el-statistic :title="t('apiKeys.revoked')" :value="summary.revoked" /></el-card></el-col>
      <el-col :xs="24" :sm="8"><el-card shadow="never"><el-statistic :title="t('apiKeys.expiring')" :value="summary.expiring" /></el-card></el-col>
    </el-row>

    <el-card shadow="never" class="token-list-card">
      <template #header>{{ t('apiKeys.listTitle') }}</template>
      <el-alert v-if="loadError" type="error" :closable="false" show-icon>
        <template #title>
          {{ t('apiKeys.loadFailed') }}
          <el-button link type="primary" @click="loadTokens">{{ t('apiKeys.retry') }}</el-button>
        </template>
      </el-alert>
      <el-table v-else v-loading="loading" :data="rows" class="token-table">
        <template #empty><el-empty :description="t('apiKeys.empty')" /></template>
        <el-table-column prop="name" :label="t('apiKeys.name')" min-width="140" />
        <el-table-column prop="tokenPrefix" :label="t('apiKeys.prefix')" min-width="130" />
        <el-table-column :label="t('apiKeys.models')" min-width="180">
          <template #default="{ row }">{{ modelSummary(row) }}</template>
        </el-table-column>
        <el-table-column :label="t('apiKeys.ipAllowlist')" min-width="170">
          <template #default="{ row }">{{ ipSummary(row) }}</template>
        </el-table-column>
        <el-table-column :label="t('apiKeys.status')" width="100">
          <template #default="{ row }"><el-tag :type="statusTagType(row)">{{ statusText(row) }}</el-tag></template>
        </el-table-column>
        <el-table-column :label="t('apiKeys.expiresAt')" min-width="160">
          <template #default="{ row }">{{ formatDate(row.expires_at) }}</template>
        </el-table-column>
        <el-table-column :label="t('apiKeys.createdAt')" min-width="160">
          <template #default="{ row }">{{ formatDate(row.created_at) }}</template>
        </el-table-column>
        <el-table-column :label="t('apiKeys.actions')" width="150" fixed="right">
          <template #default="{ row }">
            <el-button v-if="row.status !== 'revoked'" link type="primary" @click="openEdit(row)">{{ t('apiKeys.edit') }}</el-button>
            <el-button v-if="row.status !== 'revoked'" link type="danger" @click="confirmRevoke(row)">{{ t('apiKeys.revoke') }}</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-drawer v-model="drawerVisible" :title="isEditing ? t('apiKeys.editTitle') : t('apiKeys.createTitle')" size="min(520px, 100%)" @closed="resetForm">
      <el-form ref="formRef" :model="form" :rules="rules" label-position="top">
        <el-form-item :label="t('apiKeys.name')" prop="name"><el-input v-model="form.name" maxlength="128" show-word-limit /></el-form-item>
        <el-form-item :label="t('apiKeys.models')" prop="allowedModels">
          <el-select v-model="form.allowedModels" multiple clearable filterable :placeholder="t('apiKeys.allModels')" class="full-width">
            <el-option v-for="model in availableModels" :key="model.id" :label="model.name || model.id" :value="model.id" />
          </el-select>
          <div class="field-help">{{ t('apiKeys.modelsHelp') }}</div>
        </el-form-item>
        <el-form-item :label="t('apiKeys.ipAllowlist')" prop="ipAllowlistText">
          <el-input v-model="form.ipAllowlistText" type="textarea" :rows="4" :placeholder="t('apiKeys.ipPlaceholder')" />
          <div class="field-help">{{ t('apiKeys.ipHelp') }}</div>
        </el-form-item>
        <el-form-item :label="t('apiKeys.expiresAt')"><el-date-picker v-model="form.expiresAt" type="datetime" class="full-width" :placeholder="t('apiKeys.noExpiry')" /></el-form-item>
        <el-form-item v-if="isEditing" :label="t('apiKeys.status')">
          <el-radio-group v-model="form.status"><el-radio value="active">{{ t('apiKeys.active') }}</el-radio><el-radio value="disabled">{{ t('apiKeys.disabled') }}</el-radio></el-radio-group>
        </el-form-item>
        <el-button type="primary" :loading="submitting" @click="submitForm">{{ t('apiKeys.save') }}</el-button>
        <el-button @click="drawerVisible = false">{{ t('apiKeys.cancel') }}</el-button>
      </el-form>
    </el-drawer>

    <el-dialog v-model="secretVisible" :title="t('apiKeys.secretTitle')" :close-on-click-modal="false" :close-on-press-escape="false" :show-close="false" width="min(520px, 92vw)" @closed="clearSecret">
      <el-alert type="warning" :closable="false" show-icon :title="t('apiKeys.secretWarning')" />
      <el-input ref="secretInput" class="secret-value" :model-value="createdSecret" readonly>
        <template #append><el-button @click="copySecret">{{ t('apiKeys.copy') }}</el-button></template>
      </el-input>
      <template #footer><el-button type="primary" @click="secretVisible = false">{{ t('apiKeys.secretConfirm') }}</el-button></template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { createGatewayToken, getGatewayToken, listGatewayTokens, revokeGatewayToken, updateGatewayToken } from '@/api/gatewayTokens'
import { apiKeySummary, isLiteralIP, tokenRows, tokenStatus } from '@/utils/gateway-token-presentation'
import { copyText } from '@/utils/clipboard'
import { useSettingsStore } from '@/stores/settings'
import { useI18n } from '@/composables/useI18n'

const { t } = useI18n()
const settingsStore = useSettingsStore()
const rows = ref([])
const loading = ref(false)
const loadError = ref(false)
const drawerVisible = ref(false)
const secretVisible = ref(false)
const createdSecret = ref('')
const secretInput = ref()
let pendingCopy = null
const editingGuid = ref(null)
const initialExpiry = ref(null)
const submitting = ref(false)
const formRef = ref()
const form = reactive({ name: '', allowedModels: [], ipAllowlistText: '', expiresAt: null, status: 'active' })

const summary = computed(() => apiKeySummary(rows.value))
const isEditing = computed(() => editingGuid.value !== null)
const availableModels = computed(() => settingsStore.models)
const rules = {
  name: [{ required: true, message: () => t('apiKeys.nameRequired'), trigger: 'blur' }],
  ipAllowlistText: [{ validator: validateIPAllowlist, trigger: 'blur' }],
}

onMounted(() => {
  loadTokens()
  settingsStore.loadModels().catch(() => {})
})
onBeforeUnmount(clearSecret)
watch(secretVisible, (visible) => { if (!visible) clearSecret() }, { flush: 'sync' })

async function loadTokens() {
  loading.value = true
  loadError.value = false
  try {
    const data = await listGatewayTokens()
    rows.value = tokenRows(Array.isArray(data) ? data : [])
  } catch {
    loadError.value = true
  } finally {
    loading.value = false
  }
}

function openCreate() {
  resetForm()
  drawerVisible.value = true
}

async function openEdit(row) {
  try {
    const token = tokenRows([await getGatewayToken(row.guid)])[0]
    editingGuid.value = token.guid
    form.name = token.name || ''
    form.allowedModels = [...token.allowedModels]
    form.ipAllowlistText = token.ipAllowlist.join('\n')
    form.expiresAt = token.expires_at ? new Date(token.expires_at) : null
    initialExpiry.value = token.expires_at || null
    form.status = token.status === 'disabled' ? 'disabled' : 'active'
    drawerVisible.value = true
  } catch {}
}

function resetForm() {
  editingGuid.value = null
  initialExpiry.value = null
  Object.assign(form, { name: '', allowedModels: [], ipAllowlistText: '', expiresAt: null, status: 'active' })
  formRef.value?.clearValidate()
}

async function submitForm() {
  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid) return
  submitting.value = true
  try {
    const payload = payloadFromForm()
    if (isEditing.value) {
      const updated = await updateGatewayToken(editingGuid.value, payload)
      replaceRow(updated)
      drawerVisible.value = false
      ElMessage.success(t('apiKeys.saved'))
    } else {
      const created = await createGatewayToken(payload)
      replaceRow(created)
      createdSecret.value = typeof created.token === 'string' ? created.token : ''
      drawerVisible.value = false
      if (createdSecret.value) secretVisible.value = true
    }
  } catch {
    // The shared HTTP client presents a generic, non-secret server error.
  } finally {
    submitting.value = false
  }
}

function payloadFromForm() {
  const payload = {
    name: form.name.trim(),
    allowed_models: [...form.allowedModels],
    ip_allowlist: parseIPAllowlist(form.ipAllowlistText),
  }
  if (form.expiresAt) payload.expires_at = form.expiresAt.toISOString()
  else if (isEditing.value && initialExpiry.value) payload.expires_at = ''
  if (isEditing.value) payload.status = form.status
  return payload
}

function replaceRow(token) {
  const sanitized = tokenRows([token])[0]
  const index = rows.value.findIndex((row) => row.guid === sanitized.guid)
  if (index >= 0) rows.value.splice(index, 1, sanitized)
  else rows.value.unshift(sanitized)
}

async function confirmRevoke(row) {
  try {
    await ElMessageBox.confirm(t('apiKeys.revokeConfirm', { name: row.name }), t('apiKeys.revokeTitle'), { type: 'warning' })
    await revokeGatewayToken(row.guid)
    replaceRow({ ...row, status: 'revoked' })
    ElMessage.success(t('apiKeys.revokedSuccess'))
  } catch {}
}

async function copySecret() {
  pendingCopy?.abort()
  const request = new AbortController()
  pendingCopy = request
  const copied = await copyText(createdSecret.value, {
    navigator, document, signal: request.signal, container: secretInput.value?.$el,
  })
  if (request.signal.aborted || !secretVisible.value) return
  pendingCopy = null
  if (copied) ElMessage.success(t('apiKeys.copied'))
  else ElMessage.warning(t('apiKeys.copyFailed'))
}

function clearSecret() {
  pendingCopy?.abort()
  pendingCopy = null
  createdSecret.value = ''
}

function parseIPAllowlist(value) {
  return value.split('\n').map((ip) => ip.trim()).filter(Boolean)
}

function validateIPAllowlist(_rule, value, callback) {
  const invalid = parseIPAllowlist(value).find((ip) => !isLiteralIP(ip))
  callback(invalid ? new Error(t('apiKeys.ipInvalid')) : undefined)
}

function modelSummary(row) { return row.allowedModels.length ? row.allowedModels.join(', ') : t('apiKeys.allModels') }
function ipSummary(row) { return row.ipAllowlist.length ? row.ipAllowlist.join(', ') : t('apiKeys.anyIp') }
function formatDate(value) { return value ? new Date(value).toLocaleString() : t('apiKeys.noExpiry') }
function statusTagType(row) { const status = tokenStatus(row); return status === 'active' ? 'success' : status === 'revoked' ? 'danger' : status === 'expired' ? 'warning' : 'info' }
function statusText(row) { const status = tokenStatus(row); return status === 'active' ? t('apiKeys.active') : status === 'revoked' ? t('apiKeys.revoked') : status === 'expired' ? t('apiKeys.expired') : t('apiKeys.disabled') }
</script>

<style scoped lang="scss">
.page-container { padding: 24px; max-width: 1280px; margin: 0 auto; height: 100%; overflow-y: auto; }
.page-heading { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; margin-bottom: 20px; }
.page-title { margin: 0; color: var(--text-primary); }
.page-description, .field-help { color: var(--text-secondary); font-size: 13px; line-height: 1.5; }
.page-description { margin: 8px 0 0; }
.summary-cards { margin-bottom: 16px; }
.token-list-card { min-width: 0; }
.token-table { width: 100%; }
.full-width { width: 100%; }
.secret-value { margin-top: 16px; }
@media (max-width: 767px) { .page-container { padding: 16px; } .page-heading { align-items: stretch; flex-direction: column; } .page-heading :deep(.el-button) { width: 100%; } }
</style>
