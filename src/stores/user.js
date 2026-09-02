import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { authSession } from '@/api/request'
import { login, logout as apiLogout } from '@/api/auth'
import { getProfile, updateProfile as apiUpdateProfile, getUsageStats } from '@/api/users'
import { createProfileState, mergeProfileDisplay } from '@/api/profile-state'

export const useUserStore = defineStore('user', () => {
  const token = ref(authSession.accessToken())
  const authUser = ref(authSession.user())
  const authState = ref(authSession.state())
  const identityEpoch = ref(authSession.capture().epoch)
  const profile = ref(null)
  const profileError = ref(false)
  const profileState = createProfileState(authSession)
  profileState.subscribe(value => { profile.value = value; profileError.value = false })
  authSession.subscribe(next => {
    token.value = next.accessToken; authUser.value = next.user
    authState.value = next.state; identityEpoch.value = next.epoch
  })
  const user = computed(() => mergeProfileDisplay(authUser.value, profile.value))
  const initialized = computed(() => authState.value !== 'initializing')
  const isLoggedIn = computed(() => Boolean(token.value && authUser.value))
  const totalTokensUsed = computed(() => profile.value?.totalTokensUsed ?? 0)
  const setSession = ({ token: accessToken, user: nextUser }) => authSession.setSession({ accessToken, user: nextUser })
  const clearSession = () => authSession.clearSession()
  const restoreSession = () => authSession.ensureSession()
  const ensureSession = restoreSession
  async function fetchProfile() {
    try { return await profileState.load(getProfile) }
    catch (error) { if (error.code !== 'identity_changed') profileError.value = true; throw error }
  }
  async function loginUsername(payload) {
    const result = await login(payload)
    // Successful authentication is independent of profile availability.
    void fetchProfile().catch(() => {})
    return result
  }
  async function updateProfile(data) { return profileState.load(() => apiUpdateProfile(data)) }
  const logout = () => apiLogout()
  function applyTokensUsed(tokens = 0, totalFromServer = null) {
    const total = totalFromServer != null && Number.isFinite(Number(totalFromServer))
      ? Number(totalFromServer) : totalTokensUsed.value + Math.max(0, Number(tokens) || 0)
    profileState.patch({ totalTokensUsed: total })
  }
  async function refreshUsage() {
    const context = authSession.capture()
    const stats = await getUsageStats()
    authSession.assertCurrent(context)
    profileState.patch({ totalTokensUsed: stats.totalTokens })
    return stats
  }
  return { token, user, authUser, profile, profileError, authState, identityEpoch, initialized, isLoggedIn, totalTokensUsed,
    setSession, clearSession, restoreSession, ensureSession, loginUsername, fetchProfile, updateProfile, applyTokensUsed, refreshUsage, logout }
})
