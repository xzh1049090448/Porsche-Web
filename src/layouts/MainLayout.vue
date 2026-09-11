<template>
  <el-container class="main-layout console-shell">
    <AuthStatus />
    <el-header class="app-header console-topbar" height="var(--header-height)">
      <div class="header-left">
        <el-button v-if="isTablet" text class="mobile-menu-btn touch-target" :icon="Menu" :aria-label="t('nav.openMenu')" @click="showMobileMenu = true" />
        <el-button v-if="isTablet && route.path !== '/chat'" text class="header-back-btn touch-target" :icon="ArrowLeft" :aria-label="t('nav.back')" @click="goBack" />
        <AppBrand :title="t('app.title')" :subtitle="t('app.subtitle')" />
      </div>
      <div class="header-right">
        <LocaleToggle /><ThemeToggle />
        <span v-if="userStore.totalTokensUsed" class="token-stat plan-tag-mobile-hide" :title="t('user.tokenUsage')">{{ formatTokens(userStore.totalTokensUsed) }} Token</span>
        <el-tag v-if="user?.plan" size="small" :type="planTagType" class="plan-tag-mobile-hide">{{ planLabel }}</el-tag>
        <el-dropdown trigger="click" @command="onUserCommand">
          <span class="user-trigger touch-target"><el-avatar :size="32">{{ avatarText }}</el-avatar><span class="user-name">{{ user?.nickname || t('user.defaultName') }}</span><el-icon><ArrowDown /></el-icon></span>
          <template #dropdown><el-dropdown-menu>
            <el-dropdown-item command="profile">{{ t('nav.profile') }}</el-dropdown-item><el-dropdown-item command="billing">{{ t('nav.billingShort') }}</el-dropdown-item><el-dropdown-item command="api-keys">{{ t('nav.apiKeys') }}</el-dropdown-item><el-dropdown-item divided command="logout">{{ t('user.logout') }}</el-dropdown-item>
          </el-dropdown-menu></template>
        </el-dropdown>
      </div>
    </el-header>
    <div class="console-body">
      <ConsoleSidebar :items="navigation" :active-route="activeMenu">
        <template #item="{ item }">
          <el-menu-item v-if="canManageUsers && item.to === '/users'" index="/users" :aria-current="activeMenu === item.to ? 'page' : undefined"><el-icon><component :is="item.icon" /></el-icon><span>{{ item.label }}</span></el-menu-item>
          <el-menu-item v-else-if="isRoot && item.to === '/admin/public-models'" index="/admin/public-models" :aria-current="activeMenu === item.to ? 'page' : undefined"><el-icon><component :is="item.icon" /></el-icon><span>{{ item.label }}</span></el-menu-item>
          <el-menu-item v-else-if="isRoot && item.to === '/admin/public-pricing'" index="/admin/public-pricing" :aria-current="activeMenu === item.to ? 'page' : undefined"><el-icon><component :is="item.icon" /></el-icon><span>{{ item.label }}</span></el-menu-item>
          <el-menu-item v-else-if="isRoot && item.to === '/admin/public-content'" index="/admin/public-content" :aria-current="activeMenu === item.to ? 'page' : undefined"><el-icon><component :is="item.icon" /></el-icon><span>{{ item.label }}</span></el-menu-item>
          <el-menu-item v-else-if="isRoot && item.to === '/admin/notifications'" index="/admin/notifications" :aria-current="activeMenu === item.to ? 'page' : undefined"><el-icon><component :is="item.icon" /></el-icon><RootNotificationBadge :unread-count="rootNotificationsStore.unreadCount"><span>{{ item.label }}</span></RootNotificationBadge></el-menu-item>
          <el-menu-item v-else :index="item.to" :aria-current="activeMenu === item.to ? 'page' : undefined"><el-icon><component :is="item.icon" /></el-icon><span>{{ item.label }}</span></el-menu-item>
        </template>
      </ConsoleSidebar>
      <MobileDrawer v-model:show="showMobileMenu" position="left" :title="t('nav.navigation')">
        <el-menu class="drawer-nav-menu" :default-active="activeMenu" router @select="showMobileMenu = false">
          <template v-for="item in navigation" :key="item.to">
            <el-menu-item v-if="isRoot && item.to === '/admin/notifications'" index="/admin/notifications" :aria-current="activeMenu === item.to ? 'page' : undefined"><el-icon><component :is="item.icon" /></el-icon><RootNotificationBadge :unread-count="rootNotificationsStore.unreadCount"><span>{{ item.label }}</span></RootNotificationBadge></el-menu-item>
            <el-menu-item v-else :index="item.to" :aria-current="activeMenu === item.to ? 'page' : undefined"><el-icon><component :is="item.icon" /></el-icon><span>{{ item.label }}</span></el-menu-item>
          </template>
        </el-menu>
      </MobileDrawer>
      <main id="console-content" class="console-workspace" tabindex="-1"><router-view :key="userStore.identityEpoch" /></main>
    </div>
  </el-container>
</template>
<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowDown, ArrowLeft, Menu, ChatDotRound, Wallet, Key, User, Setting, Bell } from '@element-plus/icons-vue'
import { ElMessageBox } from 'element-plus'
import { useUserStore } from '@/stores/user'
import { useSettingsStore } from '@/stores/settings'
import { usePublicModelAdminStore } from '@/stores/publicModelAdmin'
import { useRootNotificationsStore } from '@/stores/rootNotifications'
import MobileDrawer from '@/components/mobile/MobileDrawer.vue'
import AppBrand from '@/components/shell/AppBrand.vue'
import ConsoleSidebar from '@/components/shell/ConsoleSidebar.vue'
import ThemeToggle from '@/components/ThemeToggle.vue'
import LocaleToggle from '@/components/LocaleToggle.vue'
import AuthStatus from '@/components/AuthStatus.vue'
import RootNotificationBadge from '@/components/RootNotificationBadge.vue'
import { useBreakpoint } from '@/composables/useBreakpoint'
import { useI18n } from '@/composables/useI18n'
import { installRuntimeRootGuard } from '@/router/runtime-root-guard.js'

const route = useRoute(), router = useRouter(), userStore = useUserStore()
const publicModelAdminStore = usePublicModelAdminStore(), rootNotificationsStore = useRootNotificationsStore(), settingsStore = useSettingsStore()
const showMobileMenu = ref(false), { isTablet } = useBreakpoint(), { t } = useI18n()
watch(() => userStore.isLoggedIn, value => { if (!value) void router.replace('/login') })
installRuntimeRootGuard({ route, userStore, router, cancelAdmin: () => { publicModelAdminStore.setMutationContext('unauthorized'); publicModelAdminStore.cancel() } })
const user = computed(() => userStore.user), activeMenu = computed(() => route.path)
const avatarText = computed(() => (user.value?.nickname || 'U').slice(0, 1))
const canManageUsers = computed(() => user.value?.admin_permissions?.includes('users.read') === true)
const isRoot = computed(() => user.value?.role === 'root')
const navigation = computed(() => [
  { to: '/chat', label: t('nav.chat'), icon: ChatDotRound, group: 'workspace', visible: true },
  { to: '/billing', label: t('nav.billing'), icon: Wallet, group: 'workspace', visible: true },
  { to: '/api-keys', label: t('nav.apiKeys'), icon: Key, group: 'workspace', visible: true },
  { to: '/profile', label: t('nav.profile'), icon: User, group: 'workspace', visible: true },
  { to: '/users', label: '用户管理', icon: User, group: 'administration', visible: canManageUsers.value },
  { to: '/admin/public-models', label: t('publicModelsAdmin.nav'), icon: Setting, group: 'root', visible: isRoot.value },
  { to: '/admin/public-pricing', label: t('publicPricingAdmin.nav'), icon: Setting, group: 'root', visible: isRoot.value },
  { to: '/admin/public-content', label: t('publicContentAdmin.nav'), icon: Setting, group: 'root', visible: isRoot.value },
  { to: '/admin/notifications', label: t('rootNotifications.nav'), icon: Bell, group: 'root', visible: isRoot.value },
].filter(item => item.visible))
const planLabel = computed(() => { const p = user.value?.plan; if (p === 'professional' || p === 'pro') return t('plan.pro'); if (p === 'enterprise') return t('plan.enterprise'); return t('plan.free') })
const planTagType = computed(() => { const p = user.value?.plan; if (p === 'professional' || p === 'pro') return 'success'; if (p === 'enterprise') return 'warning'; return 'info' })
function formatTokens(n) { return Number(n || 0).toLocaleString() }
onMounted(() => { settingsStore.loadModels().catch(() => {}); if (userStore.isLoggedIn) userStore.refreshUsage().catch(() => {}) })
function goBack() { if (window.history.length > 1) router.back(); else router.push('/chat') }
function onUserCommand(cmd) {
  if (cmd === 'logout') { ElMessageBox.confirm(t('user.logoutConfirm'), t('user.tip'), { type: 'warning' }).then(async () => { try { await userStore.logout() } finally { await router.push('/login') } }).catch(() => {}); return }
  router.push(cmd === 'profile' ? '/profile' : cmd === 'api-keys' ? '/api-keys' : '/billing')
}
</script>
