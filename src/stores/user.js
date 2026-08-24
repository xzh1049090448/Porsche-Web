import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { getItem, setItem, removeItem } from '@/utils/storage'
import { loginAndLoadProfile, loginByCode, loginByPassword } from '@/api/auth'
import { getProfile, updateProfile as apiUpdateProfile } from '@/api/users'

export const useUserStore = defineStore('user', () => {
  const token = ref(getItem('token'))
  const user = ref(getItem('user'))

  const isLoggedIn = computed(() => !!token.value)
  const totalTokensUsed = computed(() => user.value?.totalTokensUsed ?? 0)

  function setSession({ token: t, user: u }) {
    token.value = t
    user.value = u
    setItem('token', t)
    setItem('user', u)
  }

  function clearSession() {
    token.value = null
    user.value = null
    removeItem('token')
    removeItem('user')
  }

  async function loginSms(payload) {
    const res = await loginAndLoadProfile(loginByCode, payload)
    setSession({ token: res.token, user: res.user })
    return res
  }

  async function loginPassword(payload) {
    const res = await loginAndLoadProfile(loginByPassword, {
      phone: payload.phone || payload.account,
      password: payload.password,
    })
    setSession({ token: res.token, user: res.user })
    return res
  }

  async function fetchProfile() {
    const u = await getProfile()
    if (u) {
      user.value = u
      setItem('user', u)
    }
    return u
  }

  async function updateProfile(data) {
    const u = await apiUpdateProfile(data)
    user.value = u
    setItem('user', u)
    return u
  }

  function logout() {
    clearSession()
  }

  /** 对话完成后更新累计 Token（优先使用服务端 total_tokens_used） */
  function applyTokensUsed(tokens = 0, totalFromServer = null) {
    if (!user.value) return
    const next = { ...user.value }
    if (totalFromServer != null && !Number.isNaN(Number(totalFromServer))) {
      next.totalTokensUsed = Number(totalFromServer)
    } else if (tokens > 0) {
      next.totalTokensUsed = (next.totalTokensUsed || 0) + tokens
    } else {
      return
    }
    user.value = next
    setItem('user', next)
  }

  async function refreshUsage() {
    const { getUsageStats } = await import('@/api/billing')
    const stats = await getUsageStats()
    if (user.value) {
      user.value = {
        ...user.value,
        totalTokensUsed: stats.totalTokens,
        datasetCalls: stats.datasetCalls,
      }
      setItem('user', user.value)
    }
    return stats
  }

  return {
    token,
    user,
    isLoggedIn,
    totalTokensUsed,
    setSession,
    clearSession,
    loginSms,
    loginPassword,
    fetchProfile,
    updateProfile,
    applyTokensUsed,
    refreshUsage,
    logout,
  }
})
