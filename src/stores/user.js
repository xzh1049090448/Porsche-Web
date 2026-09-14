import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { authSession } from '@/api/request'
import { login, logout as apiLogout, getSelf } from '@/api/auth'
import { getProfileWithProjection, updateProfile as apiUpdateProfile, getUsageStats } from '@/api/users'
import { createProfileState, mergeProfileDisplay } from '@/api/profile-state'
import { mapPermissionProjection } from '@/api/admin-users'

export const useUserStore = defineStore('user', () => {
  const token = ref(authSession.accessToken())
  const authUser = ref(authSession.user())
  const authState = ref(authSession.state())
  const authIssue = ref(authSession.authIssue())
  const identityEpoch = ref(authSession.capture().epoch)
  const permissionRevision = ref(authSession.capture().permissionRevision)
  const profile = ref(null)
  const permissionProjection = ref(null)
  const profileError = ref(false)
  const profileState = createProfileState(authSession)
  profileState.subscribe(value => { profile.value = value; profileError.value = false })
  authSession.subscribe(next => {
    token.value = next.accessToken; authUser.value = next.user
    authState.value = next.state; authIssue.value = next.issue
    identityEpoch.value = next.epoch; permissionRevision.value = next.permissionRevision
    permissionProjection.value = next.user ? mapPermissionProjection(next.user) : null
  })
  const user = computed(() => { const value = mergeProfileDisplay(authUser.value, profile.value); return value && permissionProjection.value ? { ...value, ...permissionProjection.value } : value })
  const initialized = computed(() => authState.value !== 'initializing')
  const isLoggedIn = computed(() => Boolean(token.value && authUser.value))
  const totalTokensUsed = computed(() => profile.value?.totalTokensUsed ?? 0)
  const setSession = ({ token: accessToken, user: nextUser }) => authSession.setSession({ accessToken, user: nextUser })
  const clearSession = () => authSession.clearSession()
  async function restoreSession() {
    const before = authSession.state()
    const restored = await authSession.ensureSession()
    if (restored && before !== 'authenticated') await fetchSelf().catch(() => {})
    return restored
  }
  const ensureSession = restoreSession
  async function fetchProfile() {
    const fallbackContext = authSession.capture()
    let result
    try {
      const profile = await profileState.load(async () => {
        result = await getProfileWithProjection(fallbackContext)
        return { value: result.profile, authContext: result.authContext }
      }, { finalSnapshot: true })
      authSession.replacePermissionProjection(result.authContext, result.projection)
      return profile
    } catch (error) { if (error.code !== 'identity_changed') profileError.value = true; throw error }
  }
  async function fetchSelf() {
    const result = await getSelf()
    authSession.replacePermissionProjection(result.authContext, result.data?.user ?? result.data)
    return result.data
  }
  async function loginUsername(payload) {
    const result = await login(payload)
    // Successful authentication is independent of profile availability.
    void fetchSelf().then(() => fetchProfile()).catch(() => {})
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
  return { token, user, authUser, profile, permissionProjection, permissionRevision, profileError, authState, authIssue, identityEpoch, initialized, isLoggedIn, totalTokensUsed,
    setSession, clearSession, restoreSession, ensureSession, loginUsername, fetchProfile, fetchSelf, updateProfile, applyTokensUsed, refreshUsage, logout }
})
