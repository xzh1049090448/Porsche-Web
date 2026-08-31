import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { authSession } from '@/api/request'
import { login, logout as apiLogout, refreshSession } from '@/api/auth'
import { getProfile, updateProfile as apiUpdateProfile, getUsageStats } from '@/api/users'

export const useUserStore = defineStore('user', () => {
  const token = ref(authSession.accessToken())
  const user = ref(authSession.user())
  const initialized = ref(false)
  let restorePromise = null

  authSession.subscribe(({ accessToken, user: nextUser }) => {
    token.value = accessToken
    user.value = nextUser
  })

  const isLoggedIn = computed(() => Boolean(token.value && user.value))
  const totalTokensUsed = computed(() => user.value?.totalTokensUsed ?? user.value?.total_tokens_used ?? 0)

  /** Copies only transient credentials into the shared in-memory session. */
  function setSession({ token: accessToken, user: nextUser }) {
    initialized.value = true
    authSession.setSession({ accessToken, user: nextUser })
  }

  function clearSession() {
    initialized.value = true
    authSession.clearSession()
  }

  /** Performs at most one cookie-backed restore during a page lifetime. */
  async function restoreSession() {
    if (initialized.value) return isLoggedIn.value
    if (!restorePromise) {
      restorePromise = refreshSession()
        .then(() => true)
        .catch(() => false)
        .finally(() => { initialized.value = true })
    }
    return restorePromise
  }

  async function loginUsername(payload) {
    const response = await login(payload)
    setSession({ token: response.access_token, user: response.user })
    return response
  }

  async function fetchProfile() {
    const profile = await getProfile()
    if (profile && user.value) authSession.setSession({ accessToken: token.value, user: { ...user.value, ...profile } })
    return profile
  }

  async function updateProfile(data) {
    const profile = await apiUpdateProfile(data)
    if (profile && user.value) authSession.setSession({ accessToken: token.value, user: { ...user.value, ...profile } })
    return profile
  }

  async function logout() { await apiLogout() }

  /** Applies non-sensitive usage metadata from a completed gateway request. */
  function applyTokensUsed(tokens = 0, totalFromServer = null) {
    if (!user.value) return
    const total = totalFromServer != null && !Number.isNaN(Number(totalFromServer))
      ? Number(totalFromServer)
      : Number(user.value.totalTokensUsed || 0) + Math.max(0, Number(tokens) || 0)
    authSession.setSession({ accessToken: token.value, user: { ...user.value, totalTokensUsed: total } })
  }

  /** Keeps local usage display in sync without persisting account data. */
  async function refreshUsage() {
    const stats = await getUsageStats()
    if (user.value) authSession.setSession({
      accessToken: token.value,
      user: { ...user.value, totalTokensUsed: stats.totalTokens },
    })
    return stats
  }

  return { token, user, initialized, isLoggedIn, totalTokensUsed, setSession, clearSession, restoreSession, loginUsername, fetchProfile, updateProfile, applyTokensUsed, refreshUsage, logout }
})
