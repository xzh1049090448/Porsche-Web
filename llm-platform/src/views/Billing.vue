<template>
  <div class="billing-page page-container">
    <h1 class="page-title">套餐与用量</h1>

    <el-row :gutter="16" class="usage-cards">
      <el-col :xs="12" :sm="6">
        <el-statistic title="累计 Token" :value="usage.totalTokens || 0" />
      </el-col>
      <el-col :xs="12" :sm="6">
        <el-statistic title="数据集调用次数" :value="usage.datasetCalls || 0" />
      </el-col>
      <el-col :xs="12" :sm="6">
        <el-statistic title="今日剩余" :value="usage.remainingQuota ?? 0" suffix="次" />
      </el-col>
      <el-col :xs="12" :sm="6">
        <el-statistic title="每日限额" :value="usage.dailyLimit ?? 0" suffix="次" />
      </el-col>
    </el-row>

    <h2 class="section-title">选择套餐</h2>
    <el-row v-loading="plansLoading" :gutter="16">
      <el-col v-for="plan in plans" :key="plan.id" :xs="24" :sm="8">
        <el-card
          shadow="hover"
          class="plan-card"
          :class="{ recommended: plan.recommended, active: currentPlan === plan.id }"
        >
          <div v-if="plan.recommended" class="badge">推荐</div>
          <h3>{{ plan.name }}</h3>
          <div class="price">
            <template v-if="plan.id === 'enterprise'">联系商务</template>
            <template v-else-if="plan.price > 0">¥{{ plan.price }}</template>
            <template v-else>免费</template>
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
            {{
              currentPlan === plan.id
                ? '当前套餐'
                : plan.id === 'enterprise'
                  ? '咨询企业版'
                  : plan.id === 'free'
                    ? '默认套餐'
                    : '购买并支付'
            }}
          </el-button>
        </el-card>
      </el-col>
    </el-row>

    <el-row :gutter="20" class="mt-section">
      <el-col :xs="24" :md="12">
        <el-card shadow="never">
          <template #header>发票申请</template>
          <el-form label-width="90px" size="small">
            <el-form-item label="选择订单">
              <el-select v-model="invoiceOrderId" placeholder="已支付订单" style="width: 100%">
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
                提交申请
              </el-button>
            </el-form-item>
          </el-form>
        </el-card>
      </el-col>
    </el-row>

    <h2 class="section-title">订单记录</h2>
    <el-table :data="orders" stripe>
      <el-table-column prop="orderNo" label="订单号" width="180" />
      <el-table-column prop="plan" label="套餐" />
      <el-table-column prop="amount" label="金额">
        <template #default="{ row }">¥{{ row.amount }}</template>
      </el-table-column>
      <el-table-column prop="status" label="状态">
        <template #default="{ row }">
          <el-tag :type="row.status === 'paid' ? 'success' : 'warning'">
            {{ row.status === 'paid' ? '已支付' : row.status }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="时间">
        <template #default="{ row }">
          {{ new Date(row.createdAt).toLocaleString('zh-CN') }}
        </template>
      </el-table-column>
      <el-table-column label="操作" width="120">
        <template #default="{ row }">
          <el-button
            v-if="row.status !== 'paid'"
            type="primary"
            link
            size="small"
            @click="pay(row)"
          >
            支付
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

const userStore = useUserStore()
const usage = ref({})
const plans = ref([])
const orders = ref([])
const plansLoading = ref(false)
const purchasing = ref(null)
const invoiceOrderId = ref(null)

const currentPlan = computed(() => userStore.user?.plan || usage.value.plan || 'free')
const paidOrders = computed(() => orders.value.filter((o) => o.status === 'paid'))

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
    ElMessageBox.alert('请联系商务获取企业版定制方案与 API 授权。', '企业版咨询')
    return
  }
  if (plan.id === 'free') return

  purchasing.value = plan.id
  try {
    await purchaseAndPay(plan.id)
    await userStore.fetchProfile()
    usage.value = await getUsageStats()
    orders.value = await getOrders()
    ElMessage.success(`已开通 ${plan.name}`)
  } finally {
    purchasing.value = null
  }
}

async function pay(order) {
  await payOrder(order.id)
  orders.value = await getOrders()
  await userStore.fetchProfile()
  ElMessage.success('支付成功')
}

async function submitInvoice() {
  if (!invoiceOrderId.value) {
    ElMessage.warning('请选择订单')
    return
  }
  const res = await applyInvoice(invoiceOrderId.value)
  ElMessage.success(res.message || '发票申请已提交')
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
