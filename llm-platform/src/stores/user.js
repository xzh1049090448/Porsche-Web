import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { getItem, setItem, removeItem } from '@/utils/storage'
import { loginAndLoadProfile, loginByCode, loginByPassword } from '@/api/auth'
import { getProfile, updateProfile as apiUpdateProfile } from '@/api/users'

export const useUserStore = defineStore('user', () => {
  const token = ref(getItem('token'))
  const user = ref(getItem('user'))

  const isLoggedIn = computed(() => !!token.value)

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

  return {
    token,
    user,
    isLoggedIn,
    setSession,
    clearSession,
    loginSms,
    loginPassword,
    fetchProfile,
    updateProfile,
    logout,
  }
})
