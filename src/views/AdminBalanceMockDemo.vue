<template>
  <section class="mock-balance-page" :data-demo-marker="ADMIN_BALANCE_MOCK_MARKER">
    <el-page-header content="金额额度 Mock 演示" @back="$router.push('/users')" />
    <el-alert
      class="boundary-alert"
      type="warning"
      show-icon
      :closable="false"
      title="开发/测试专用 Mock"
      description="页面只使用合成用户与内存夹具；刷新会重置余额，不影响真实账户、调用次数、账单或资金。"
    />

    <el-card shadow="never">
      <template #header><span>合成用户</span><el-tag class="mock-tag" type="warning">Mock</el-tag></template>
      <el-descriptions :column="2" border>
        <el-descriptions-item label="用户标识"><code>{{ state.user.guid }}</code></el-descriptions-item>
        <el-descriptions-item label="用户名">{{ state.user.username }}</el-descriptions-item>
        <el-descriptions-item label="可用余额"><strong class="amount">¥ {{ money(state.balanceCents) }}</strong> <el-tag size="small" type="warning">Mock</el-tag></el-descriptions-item>
        <el-descriptions-item label="累计已用"><span class="amount">¥ {{ money(state.usedCents) }}</span> <el-tag size="small" type="warning">Mock</el-tag></el-descriptions-item>
        <el-descriptions-item label="币种">CNY</el-descriptions-item>
        <el-descriptions-item label="真实金额能力">未接入</el-descriptions-item>
      </el-descriptions>
      <div class="actions"><el-button type="primary" @click="openAdjustment">模拟调整</el-button></div>
    </el-card>

    <el-card shadow="never">
      <template #header>最近模拟调整记录 <el-tag class="mock-tag" type="warning">Mock</el-tag></template>
      <el-empty v-if="state.records.length === 0" description="暂无 Mock 调整记录" />
      <el-table v-else :data="state.records">
        <el-table-column label="动作" prop="mode"><template #default="scope">{{ modeLabel(scope.row.mode) }}</template></el-table-column>
        <el-table-column label="操作人" prop="operator" />
        <el-table-column label="原因" prop="reason" />
        <el-table-column label="调整前"><template #default="scope">¥ {{ money(scope.row.beforeCents) }}</template></el-table-column>
        <el-table-column label="调整后"><template #default="scope">¥ {{ money(scope.row.afterCents) }}</template></el-table-column>
        <el-table-column label="标记"><template #default><el-tag type="warning">Mock</el-tag></template></el-table-column>
      </el-table>
    </el-card>

    <el-dialog v-model="dialogOpen" title="模拟金额调整（Mock）" width="min(560px, calc(100vw - 32px))" @closed="clearForm">
      <el-alert type="info" :closable="false" title="模拟调整不影响真实账户" />
      <el-form ref="formRef" :model="form" label-position="top" @submit.prevent="submitAdjustment">
        <el-form-item label="调整方式">
          <el-radio-group v-model="form.mode">
            <el-radio-button value="add">增加</el-radio-button>
            <el-radio-button value="deduct">扣减</el-radio-button>
            <el-radio-button value="replace">覆盖</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="金额（CNY，最多两位小数）" :error="validationMessage">
          <el-input v-model="form.amount" inputmode="decimal" autocomplete="off" placeholder="0.00" />
        </el-form-item>
        <el-form-item label="原因">
          <el-input v-model="form.reason" type="textarea" maxlength="200" show-word-limit />
        </el-form-item>
        <el-form-item label="模拟结果">
          <el-select v-model="form.scenario">
            <el-option label="成功" value="success" />
            <el-option label="失败" value="failure" />
            <el-option label="超时" value="timeout" />
            <el-option label="版本冲突" value="conflict" />
          </el-select>
        </el-form-item>
        <div class="preview" aria-live="polite">
          <span>调整前：¥ {{ money(state.balanceCents) }}</span>
          <span>调整后：{{ previewText }}</span>
        </div>
      </el-form>
      <template #footer>
        <el-button :disabled="submitting" @click="dialogOpen = false">取消</el-button>
        <el-button type="primary" :loading="submitting" :disabled="Boolean(validationMessage) || !form.reason.trim()" @click="submitAdjustment">二次确认并模拟</el-button>
      </template>
    </el-dialog>
  </section>
</template>

<script setup>
import { computed, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import {
  ADMIN_BALANCE_MOCK_MARKER,
  createAdminBalanceMockFixture,
  formatCnyCents,
  previewMockBalance,
} from '@/demo/admin-balance-mock'

const fixture = createAdminBalanceMockFixture()
const state = ref(fixture.snapshot())
const dialogOpen = ref(false)
const submitting = ref(false)
let requestSequence = 0
const form = reactive({ mode: 'add', amount: '', reason: '', scenario: 'success' })

const messages = {
  invalid_amount: '请输入 0 至 999,999,999.99 的金额，最多两位小数。',
  positive_amount_required: '增加或扣减金额必须大于 0。',
  insufficient_mock_balance: '模拟余额不足，本次调整未执行。',
  mock_balance_limit_exceeded: '调整后金额超过演示上限。',
  mock_failure: '模拟调整失败，余额未改变。',
  mock_timeout: '模拟请求超时，余额未改变。',
  mock_conflict: '模拟版本冲突，请按当前余额重新确认。',
}

const preview = computed(() => {
  try { return previewMockBalance({ balanceCents: state.value.balanceCents, mode: form.mode, amount: form.amount }) }
  catch (error) { return error }
})
const validationMessage = computed(() => preview.value instanceof Error ? (messages[preview.value.code] ?? '输入无效。') : '')
const previewText = computed(() => preview.value instanceof Error ? '—' : `¥ ${formatCnyCents(preview.value)}`)
const money = formatCnyCents
const modeLabel = mode => ({ add: '增加', deduct: '扣减', replace: '覆盖' }[mode] ?? mode)

function openAdjustment() {
  clearForm()
  dialogOpen.value = true
}
function clearForm() {
  form.mode = 'add'; form.amount = ''; form.reason = ''; form.scenario = 'success'; submitting.value = false
}
async function submitAdjustment() {
  if (submitting.value || validationMessage.value || !form.reason.trim()) return
  submitting.value = true
  try {
    await fixture.adjust({
      requestKey: `mock-request-${String(++requestSequence).padStart(4, '0')}`,
      mode: form.mode,
      amount: form.amount,
      reason: form.reason,
      scenario: form.scenario,
    })
    state.value = fixture.snapshot()
    dialogOpen.value = false
    ElMessage.success('模拟调整完成，不影响真实账户')
  } catch (error) {
    ElMessage.error(messages[error?.code] ?? '模拟请求失败，余额未改变。')
  } finally {
    submitting.value = false
  }
}
</script>

<style scoped>
.mock-balance-page{max-width:1100px;margin:0 auto;padding:24px;overflow:auto;height:100%}.boundary-alert,.el-card{margin-top:18px}.mock-tag{margin-left:8px}.amount,code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}.actions{display:flex;justify-content:flex-end;margin-top:18px}.preview{display:flex;justify-content:space-between;gap:16px;padding:14px;border-radius:8px;background:var(--el-fill-color-light);font-family:ui-monospace,SFMono-Regular,Menlo,monospace}@media(max-width:600px){.mock-balance-page{padding:16px}.preview{flex-direction:column;gap:6px}}
</style>
