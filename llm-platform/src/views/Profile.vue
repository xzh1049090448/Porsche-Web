<template>
  <div class="profile-page page-container">
    <h1 class="page-title">个人中心</h1>

    <el-row :gutter="20">
      <el-col :xs="24" :md="14">
        <el-card shadow="never">
          <template #header>基本信息</template>
          <el-form :model="form" label-width="100px">
            <el-form-item label="昵称">
              <el-input v-model="form.nickname" />
            </el-form-item>
            <el-form-item label="手机号">
              <el-input v-model="form.phone" disabled />
            </el-form-item>
            <el-form-item>
              <el-button type="primary" :loading="saving" @click="saveProfile">保存</el-button>
            </el-form-item>
          </el-form>
        </el-card>

        <el-card shadow="never" class="mt-card">
          <template #header>修改密码</template>
          <el-form :model="pwdForm" label-width="100px">
            <el-form-item label="原密码">
              <el-input v-model="pwdForm.oldPassword" type="password" show-password />
            </el-form-item>
            <el-form-item label="新密码">
              <el-input v-model="pwdForm.newPassword" type="password" show-password />
            </el-form-item>
            <el-form-item label="确认密码">
              <el-input v-model="pwdForm.confirm" type="password" show-password />
            </el-form-item>
            <el-form-item>
              <el-button type="primary" @click="changePwd">修改密码</el-button>
            </el-form-item>
          </el-form>
        </el-card>
      </el-col>

      <el-col :xs="24" :md="10">
        <el-card shadow="never">
          <template #header>
            <span>实名认证</span>
            <el-tag v-if="user?.verified" type="success" size="small" style="margin-left: 8px">
              已认证
            </el-tag>
          </template>
          <el-alert
            v-if="user?.verified"
            type="success"
            :closable="false"
            show-icon
            title="您已完成实名认证，可正常使用平台全部功能。"
          />
          <el-form v-else :model="verifyForm" label-width="80px">
            <el-form-item label="姓名">
              <el-input v-model="verifyForm.name" placeholder="真实姓名" />
            </el-form-item>
            <el-form-item label="身份证号">
              <el-input v-model="verifyForm.idCard" placeholder="18 位身份证号" maxlength="18" />
            </el-form-item>
            <el-form-item>
              <el-button type="primary" :loading="verifying" @click="submitVerify">
                提交认证
              </el-button>
            </el-form-item>
          </el-form>
        </el-card>

        <el-card shadow="never" class="mt-card">
          <template #header>用量概览</template>
          <el-descriptions :column="1" border>
            <el-descriptions-item label="累计 Token">{{ usage.totalTokens?.toLocaleString() }}</el-descriptions-item>
            <el-descriptions-item label="数据集调用">{{ usage.datasetCalls }} 次</el-descriptions-item>
            <el-descriptions-item label="今日剩余额度">
              {{ usage.remainingQuota }} / {{ usage.dailyLimit }}
            </el-descriptions-item>
            <el-descriptions-item label="当前套餐">{{ planLabel }}</el-descriptions-item>
          </el-descriptions>
          <el-button type="primary" link style="margin-top: 12px" @click="$router.push('/billing')">
            查看套餐与充值 →
          </el-button>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { useUserStore } from '@/stores/user'
import { changePassword, submitRealName } from '@/api/users'
import { getUsageStats } from '@/api/billing'

const userStore = useUserStore()
const user = computed(() => userStore.user)
const saving = ref(false)
const verifying = ref(false)
const usage = ref({})

const form = reactive({ nickname: '', phone: '' })
const pwdForm = reactive({ oldPassword: '', newPassword: '', confirm: '' })
const verifyForm = reactive({ name: '', idCard: '' })

const planMap = {
  free: '免费版',
  professional: '专业版',
  pro: '专业版',
  enterprise: '企业版',
}
const planLabel = computed(() => planMap[usage.value.plan || user.value?.plan] || '免费版')

onMounted(async () => {
  if (user.value) {
    form.nickname = user.value.nickname || ''
    form.phone = user.value.phone || ''
  }
  usage.value = await getUsageStats()
})

async function saveProfile() {
  saving.value = true
  try {
    await userStore.updateProfile({ ...form })
    ElMessage.success('保存成功')
  } finally {
    saving.value = false
  }
}

async function changePwd() {
  if (!pwdForm.newPassword || pwdForm.newPassword !== pwdForm.confirm) {
    ElMessage.warning('请确认新密码一致')
    return
  }
  await changePassword({
    oldPassword: pwdForm.oldPassword,
    newPassword: pwdForm.newPassword,
  })
  ElMessage.success('密码已修改')
  pwdForm.oldPassword = ''
  pwdForm.newPassword = ''
  pwdForm.confirm = ''
}

async function submitVerify() {
  verifying.value = true
  try {
    await submitRealName({ ...verifyForm })
    await userStore.fetchProfile()
    ElMessage.success('实名认证成功')
  } finally {
    verifying.value = false
  }
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

.mt-card {
  margin-top: 16px;
}
</style>
