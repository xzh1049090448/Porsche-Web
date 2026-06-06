<template>
  <div class="billing-page page-container">
    <h1 class="page-title">{{ t('billing.title') }}</h1>

    <el-row :gutter="16" class="usage-cards">
      <el-col :xs="12" :sm="8">
        <el-statistic :title="t('billing.totalTokens')" :value="usage.totalTokens || 0" />
      </el-col>
      <el-col :xs="12" :sm="8">
        <el-statistic
          :title="t('billing.remainingToday')"
          :value="usage.remainingQuota ?? 0"
          :suffix="t('billing.times')"
        />
      </el-col>
      <el-col :xs="12" :sm="8">
        <el-statistic
          :title="t('billing.dailyLimit')"
          :value="usage.dailyLimit ?? 0"
          :suffix="t('billing.times')"
        />
      </el-col>
    </el-row>

    <h2 class="section-title">{{ t('billing.choosePlan') }}</h2>
    <el-row v-loading="plansLoading" :gutter="16">
      <el-col v-for="plan in displayPlans" :key="plan.id" :xs="24" :sm="8">
        <el-card
          shadow="hover"
          class="plan-card"
          :class="{ recommended: plan.recommended, active: currentPlan === plan.id }"
        >
          <div v-if="plan.recommended" class="badge">{{ t('billing.recommended') }}</div>
          <h3>{{ plan.name }}</h3>
          <div class="price">
            <template v-if="plan.id === 'enterprise'">{{ t('billing.contactSales') }}</template>
            <template v-else-if="plan.price > 0">¥{{ plan.price }}</template>
            <template v-else>{{ t('billing.free') }}</template>
          </div>
          <p class="quota">{{ plan.description }}</p>
          <ul>
            <li v-for="f in plan.features" :key="f">{{ f }}</li>
          </ul>
          <el-button
            :type="plan.recommended ? 'primary' : 'default'"
            :disabled="currentPlan === plan.id || plan.id === 'free'"
            :loading="purchasing === plan.id"
            class="plan-btn"
            @click="buy(plan)"
          >
            {{ planButtonLabel(plan) }}
          </el-button>
        </el-card>
      </el-col>
    </el-row>

    <el-row :gutter="20" class="mt-section">
      <el-col :xs="24" :md="12">
        <el-card shadow="never">
          <template #header>{{ t('billing.invoice') }}</template>
          <el-form label-width="90px" size="small">
            <el-form-item :label="t('billing.selectOrder')">
              <el-select v-model="invoiceOrderId" :placeholder="t('billing.paidOrders')" style="width: 100%">
                <el-option
                  v-for="o in paidOrders"
                  :key="o.id"
                  :label="`${o.orderNo} · ${o.plan} · ¥${o.amount}`"
                  :value="o.id"
                />
              </el-select>
            </el-form-item>
            <el-form-item>
              <el-button type="primary" :disabled="!invoiceOrderId" @click="submitInvoice">
                {{ t('billing.submitInvoice') }}
              </el-button>
            </el-form-item>
          </el-form>
        </el-card>
      </el-col>
    </el-row>

    <h2 class="section-title">{{ t('billing.orderHistory') }}</h2>
    <el-table :data="orders" stripe>
      <el-table-column prop="orderNo" :label="t('billing.orderNo')" width="180" />
      <el-table-column prop="plan" :label="t('billing.plan')" />
      <el-table-column prop="amount" :label="t('billing.amount')">
        <template #default="{ row }">¥{{ row.amount }}</template>
      </el-table-column>
      <el-table-column prop="status" :label="t('billing.status')">
        <template #default="{ row }">
          <el-tag :type="row.status === 'paid' ? 'success' : 'warning'">
            {{ row.status === 'paid' ? t('billing.paid') : row.status }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column :label="t('billing.time')">
        <template #default="{ row }">
          {{ new Date(row.createdAt).toLocaleString(dateLocale) }}
        </template>
      </el-table-column>
      <el-table-column :label="t('billing.pay')" width="120">
        <template #default="{ row }">
          <el-button
            v-if="row.status !== 'paid'"
            type="primary"
            link
            size="small"
            @click="pay(row)"
          >
            {{ t('billing.pay') }}
          </el-button>
        </template>
      </el-table-column>
    </el-table>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  getUsageStats,
  getPlans,
  getOrders,
  purchaseAndPay,
  payOrder,
  applyInvoice,
} from '@/api/billing'
import { useUserStore } from '@/stores/user'
import { useI18n } from '@/composables/useI18n'

const userStore = useUserStore()
const { t, ta, dateLocale } = useI18n()
const usage = ref({})
const plans = ref([])
const orders = ref([])
const plansLoading = ref(false)
const purchasing = ref(null)
const invoiceOrderId = ref(null)

const currentPlan = computed(() => userStore.user?.plan || usage.value.plan || 'free')
const paidOrders = computed(() => orders.value.filter((o) => o.status === 'paid'))

const displayPlans = computed(() =>
  plans.value.map((plan) => {
    const localized = t(`billing.plans.${plan.id}.name`)
    const hasLocalized = localized !== `billing.plans.${plan.id}.name`
    if (!hasLocalized) return plan
    return {
      ...plan,
      name: localized,
      description: t(`billing.plans.${plan.id}.quota`),
      features: ta(`billing.plans.${plan.id}.features`),
    }
  })
)

function planButtonLabel(plan) {
  if (currentPlan.value === plan.id) return t('billing.currentPlan')
  if (plan.id === 'enterprise') return t('billing.consultEnterprise')
  if (plan.id === 'free') return t('billing.defaultPlan')
  return t('billing.buyAndPay')
}

onMounted(async () => {
  plansLoading.value = true
  try {
    const [u, p, o] = await Promise.all([getUsageStats(), getPlans(), getOrders()])
    usage.value = u
    plans.value = p.plans || []
    if (p.currentPlan) usage.value.plan = p.currentPlan
    orders.value = o
  } finally {
    plansLoading.value = false
  }
})

async function buy(plan) {
  if (plan.id === 'enterprise') {
    ElMessageBox.alert(t('billing.enterpriseConsultMsg'), t('billing.enterpriseConsultTitle'))
    return
  }
  if (plan.id === 'free') return

  purchasing.value = plan.id
  try {
    await purchaseAndPay(plan.id)
    await userStore.fetchProfile()
    usage.value = await getUsageStats()
    orders.value = await getOrders()
    ElMessage.success(t('billing.planActivated', { name: plan.name }))
  } finally {
    purchasing.value = null
  }
}

async function pay(order) {
  await payOrder(order.id)
  orders.value = await getOrders()
  await userStore.fetchProfile()
  ElMessage.success(t('billing.paySuccess'))
}

async function submitInvoice() {
  if (!invoiceOrderId.value) {
    ElMessage.warning(t('billing.selectOrderWarn'))
    return
  }
  const res = await applyInvoice(invoiceOrderId.value)
  ElMessage.success(res.message || t('billing.invoiceSubmitted'))
}
</script>

<style scoped lang="scss">
.page-container {
  padding: 24px;
  max-width: 1100px;
  margin: 0 auto;
  height: 100%;
  overflow-y: auto;
}

.usage-cards {
  margin-bottom: 24px;
}

.section-title {
  font-size: 16px;
  margin: 24px 0 12px;
}

.plan-card {
  position: relative;
  text-align: center;
  margin-bottom: 16px;

  &.recommended {
    border-color: var(--accent);
  }

  &.active {
    box-shadow: 0 0 0 2px var(--accent);
  }

  h3 {
    margin: 0 0 8px;
  }

  .price {
    font-size: 28px;
    font-weight: 700;
    color: var(--accent);
    min-height: 36px;
  }

  .quota {
    color: var(--text-secondary);
    font-size: 13px;
  }

  ul {
    text-align: left;
    padding-left: 20px;
    font-size: 13px;
    color: var(--text-secondary);
    min-height: 80px;
  }

  .plan-btn {
    width: 100%;
  }

  .badge {
    position: absolute;
    top: 12px;
    right: 12px;
    background: var(--accent);
    color: #fff;
    font-size: 11px;
    padding: 2px 8px;
    border-radius: 4px;
  }
}

.mt-section {
  margin-top: 8px;
}
</style>
