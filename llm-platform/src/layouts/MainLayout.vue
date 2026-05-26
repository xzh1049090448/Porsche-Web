<template>
  <el-container class="main-layout">
    <el-header class="app-header" height="var(--header-h)">
      <div class="header-left">
        <div class="logo">
          <span class="logo-icon">AI</span>
          <div>
            <div class="logo-title">国内大模型聚合平台</div>
            <div class="logo-sub">跨境电商专属 · 智谱 GLM-5.1</div>
          </div>
        </div>
      </div>
      <el-menu
        mode="horizontal"
        :default-active="activeMenu"
        class="header-menu"
        :ellipsis="false"
        router
      >
        <el-menu-item index="/">对话</el-menu-item>
        <el-menu-item index="/billing">套餐与用量</el-menu-item>
        <el-menu-item index="/profile">个人中心</el-menu-item>
      </el-menu>
      <div class="header-right">
        <el-tag v-if="user?.plan" size="small" :type="planTagType">{{ planLabel }}</el-tag>
        <el-dropdown trigger="click" @command="onUserCommand">
          <span class="user-trigger">
            <el-avatar :size="32">{{ avatarText }}</el-avatar>
            <span class="user-name">{{ user?.nickname || '用户' }}</span>
            <el-icon><ArrowDown /></el-icon>
          </span>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="profile">个人中心</el-dropdown-item>
              <el-dropdown-item command="billing">套餐用量</el-dropdown-item>
              <el-dropdown-item divided command="logout">退出登录</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </div>
    </el-header>
    <el-main class="app-main">
      <router-view />
    </el-main>
  </el-container>
</template>

<script setup>
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowDown } from '@element-plus/icons-vue'
import { useUserStore } from '@/stores/user'
import { ElMessageBox } from 'element-plus'

const route = useRoute()
const router = useRouter()
const userStore = useUserStore()

const user = computed(() => userStore.user)
const activeMenu = computed(() => route.path)
const avatarText = computed(() => (user.value?.nickname || 'U').slice(0, 1))

const planMap = {
  free: '免费版',
  professional: '专业版',
  pro: '专业版',
  enterprise: '企业版',
}
const planLabel = computed(() => planMap[user.value?.plan] || '免费版')
const planTagType = computed(() => {
  const p = user.value?.plan
  if (p === 'professional' || p === 'pro') return 'success'
  if (p === 'enterprise') return 'warning'
  return 'info'
})

function onUserCommand(cmd) {
  if (cmd === 'logout') {
    ElMessageBox.confirm('确定退出登录？', '提示', { type: 'warning' }).then(() => {
      userStore.logout()
      router.push('/login')
    })
    return
  }
  router.push(cmd === 'profile' ? '/profile' : '/billing')
}
</script>

<style scoped lang="scss">
.main-layout {
  height: 100%;
  flex-direction: column;
}

.app-header {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 0 20px;
  background: var(--panel-bg);
  border-bottom: 1px solid var(--border);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.04);
}

.header-left {
  flex-shrink: 0;
}

.logo {
  display: flex;
  align-items: center;
  gap: 10px;
}

.logo-icon {
  width: 36px;
  height: 36px;
  border-radius: 8px;
  background: linear-gradient(135deg, #409eff, #67c23a);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 13px;
}

.logo-title {
  font-size: 15px;
  font-weight: 600;
  line-height: 1.2;
}

.logo-sub {
  font-size: 11px;
  color: var(--text-secondary);
}

.header-menu {
  flex: 1;
  border-bottom: none;
  min-width: 0;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-shrink: 0;
}

.user-trigger {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
}

.user-name {
  font-size: 14px;
  max-width: 100px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.app-main {
  padding: 0;
  height: calc(100vh - var(--header-h));
  overflow: hidden;
}

@media (max-width: 768px) {
  .logo-sub,
  .user-name {
    display: none;
  }
}
</style>
