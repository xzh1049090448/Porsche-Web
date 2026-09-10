<template>
  <el-container class="main-layout">
    <AuthStatus />
    <el-header class="app-header" height="var(--header-h)">
      <div class="header-left">
        <el-button
          v-if="isTablet"
          text
          class="mobile-menu-btn touch-target"
          :icon="Menu"
          :aria-label="t('nav.openMenu')"
          @click="showMobileMenu = true"
        />
        <el-button
          v-if="isTablet && route.path !== '/chat'"
          text
          class="header-back-btn touch-target"
          :icon="ArrowLeft"
          :aria-label="t('nav.back')"
          @click="goBack"
        />
        <div class="logo">
          <img src="/logo.png" alt="" class="logo-icon" />
          <div>
            <div class="logo-title">{{ t('app.title') }}</div>
            <div class="logo-sub">{{ t('app.subtitle') }}</div>
          </div>
        </div>
      </div>
      <el-menu
        mode="horizontal"
        :default-active="activeMenu"
        class="header-menu desktop-only"
        :ellipsis="false"
        router
      >
        <el-menu-item index="/chat">{{ t('nav.chat') }}</el-menu-item>
        <el-menu-item index="/billing">{{ t('nav.billing') }}</el-menu-item>
        <el-menu-item index="/api-keys">{{ t('nav.apiKeys') }}</el-menu-item>
        <el-menu-item index="/profile">{{ t('nav.profile') }}</el-menu-item>
        <el-menu-item v-if="canManageUsers" index="/users">用户管理</el-menu-item>
        <el-menu-item v-if="isRoot" index="/admin/public-models">{{ t('publicModelsAdmin.nav') }}</el-menu-item>
      </el-menu>
      <div class="header-right">
        <LocaleToggle />
        <ThemeToggle />
        <span
          v-if="userStore.totalTokensUsed"
          class="token-stat plan-tag-mobile-hide"
          :title="t('user.tokenUsage')"
        >
          {{ formatTokens(userStore.totalTokensUsed) }} Token
        </span>
        <el-tag
          v-if="user?.plan"
          size="small"
          :type="planTagType"
          class="plan-tag-mobile-hide"
        >
          {{ planLabel }}
        </el-tag>
        <el-dropdown trigger="click" @command="onUserCommand">
          <span class="user-trigger touch-target">
            <el-avatar :size="32">{{ avatarText }}</el-avatar>
            <span class="user-name">{{ user?.nickname || t('user.defaultName') }}</span>
            <el-icon><ArrowDown /></el-icon>
          </span>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="profile">{{ t('nav.profile') }}</el-dropdown-item>
              <el-dropdown-item command="billing">{{ t('nav.billingShort') }}</el-dropdown-item>
              <el-dropdown-item command="api-keys">{{ t('nav.apiKeys') }}</el-dropdown-item>
              <el-dropdown-item divided command="logout">{{ t('user.logout') }}</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </div>
    </el-header>

    <MobileDrawer v-model:show="showMobileMenu" position="left" :title="t('nav.navigation')">
      <el-menu
        class="drawer-nav-menu"
        :default-active="activeMenu"
        router
        @select="showMobileMenu = false"
      >
        <el-menu-item index="/chat">
          <el-icon><ChatDotRound /></el-icon>
          <span>{{ t('nav.chat') }}</span>
        </el-menu-item>
        <el-menu-item index="/billing">
          <el-icon><Wallet /></el-icon>
          <span>{{ t('nav.billing') }}</span>
        </el-menu-item>
        <el-menu-item index="/api-keys">
          <el-icon><Key /></el-icon>
          <span>{{ t('nav.apiKeys') }}</span>
        </el-menu-item>
        <el-menu-item index="/profile">
          <el-icon><User /></el-icon>
          <span>{{ t('nav.profile') }}</span>
        </el-menu-item>
        <el-menu-item v-if="canManageUsers" index="/users"><el-icon><User /></el-icon><span>用户管理</span></el-menu-item>
        <el-menu-item v-if="isRoot" index="/admin/public-models"><el-icon><Setting /></el-icon><span>{{ t('publicModelsAdmin.nav') }}</span></el-menu-item>
      </el-menu>
    </MobileDrawer>

    <el-main class="app-main">
      <router-view :key="userStore.identityEpoch" />
    </el-main>
  </el-container>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  ArrowDown,
  ArrowLeft,
  Menu,
  ChatDotRound,
  Wallet,
  Key,
  User,
  Setting,
} from '@element-plus/icons-vue'
import { useUserStore } from '@/stores/user'
import { useSettingsStore } from '@/stores/settings'
import { ElMessageBox } from 'element-plus'
import MobileDrawer from '@/components/mobile/MobileDrawer.vue'
import ThemeToggle from '@/components/ThemeToggle.vue'
import LocaleToggle from '@/components/LocaleToggle.vue'
import AuthStatus from '@/components/AuthStatus.vue'
import { useBreakpoint } from '@/composables/useBreakpoint'
import { useI18n } from '@/composables/useI18n'

const route = useRoute()
const router = useRouter()
const userStore = useUserStore()
const settingsStore = useSettingsStore()
const showMobileMenu = ref(false)
const { isTablet } = useBreakpoint()
const { t } = useI18n()

watch(() => userStore.isLoggedIn, value => { if (!value) void router.replace('/login') })

const user = computed(() => userStore.user)
const activeMenu = computed(() => route.path)
const avatarText = computed(() => (user.value?.nickname || 'U').slice(0, 1))
const canManageUsers = computed(() => user.value?.admin_permissions?.includes('users.read') === true)
const isRoot = computed(() => user.value?.role === 'root')

const planLabel = computed(() => {
  const p = user.value?.plan
  if (p === 'professional' || p === 'pro') return t('plan.pro')
  if (p === 'enterprise') return t('plan.enterprise')
  return t('plan.free')
})
const planTagType = computed(() => {
  const p = user.value?.plan
  if (p === 'professional' || p === 'pro') return 'success'
  if (p === 'enterprise') return 'warning'
  return 'info'
})

function formatTokens(n) {
  return Number(n || 0).toLocaleString()
}

onMounted(() => {
  settingsStore.loadModels().catch(() => {})
  if (userStore.isLoggedIn) {
    userStore.refreshUsage().catch(() => {})
  }
})

function goBack() {
  if (window.history.length > 1) {
    router.back()
  } else {
    router.push('/chat')
  }
}

function onUserCommand(cmd) {
  if (cmd === 'logout') {
    ElMessageBox.confirm(t('user.logoutConfirm'), t('user.tip'), { type: 'warning' }).then(async () => {
      try { await userStore.logout() } finally { await router.push('/login') }
    }).catch(() => {})
    return
  }
  router.push(cmd === 'profile' ? '/profile' : cmd === 'api-keys' ? '/api-keys' : '/billing')
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
  padding: 0 24px;
  height: var(--header-h);
  background: var(--sidebar-bg);
  border-bottom: 1px solid var(--border);
  box-shadow: var(--header-shadow);
}

.header-left {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
  min-width: 0;
}

.mobile-menu-btn,
.header-back-btn {
  display: none;
}

.logo {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.logo-icon {
  width: 32px;
  height: 32px;
  object-fit: contain;
  flex-shrink: 0;
}

.logo-title {
  font-size: 16px;
  font-weight: 600;
  line-height: 24px;
  color: var(--text-primary);
}

.logo-sub {
  font-size: 11px;
  line-height: 16px;
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

.token-stat {
  font-size: 12px;
  color: var(--text-secondary);
  white-space: nowrap;
}

.user-trigger {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 8px;
  transition: background 0.2s;

  &:hover {
    background: var(--hover-bg);
  }
}

.user-name {
  font-size: 14px;
  color: var(--text-body);
  max-width: 100px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.app-main {
  padding: 0;
  height: calc(var(--vh, 1vh) * 100 - var(--header-h));
  overflow: hidden;
}
@media (max-width: 768px) {
  .app-header { padding: 0 8px; gap: 4px; }
  .header-left { flex: 1; min-width: 0; flex-shrink: 1; overflow: hidden; }
  .logo { min-width: 0; gap: 4px; }
  .logo-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100px; font-size: 13px; }
  .logo-icon { width: 28px; height: 28px; }
  .header-right { gap: 0; }
  .user-trigger { padding: 4px; }
  .user-name, .logo-sub { display: none; }
}
</style>
