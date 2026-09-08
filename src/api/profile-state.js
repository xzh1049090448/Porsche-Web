/** Private account metadata, intentionally distinct from the AuthUser whitelist. */
export function createProfileState(auth) {
  let profile = null
  const listeners = new Set()
  const set = next => { profile = next; listeners.forEach(fn => fn(profile)) }
  auth.onInvalidate(() => set(null))
  return {
    value: () => profile,
    subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn) },
    async load(loader, { finalSnapshot = false } = {}) {
      const context = auth.capture()
      const result = await loader()
      const finalContext = finalSnapshot ? result?.authContext : context
      ;(auth.assertSnapshot ?? auth.assertCurrent)(finalContext)
      const value = finalSnapshot ? result?.value : result
      set(value)
      return value
    },
    patch(value) { if (auth.user()) set({ ...profile, ...value }) },
  }
}

/** Combines display metadata with the authoritative authentication identity. */
export function mergeProfileDisplay(authUser, profile) {
  if (!authUser) return null
  return { ...profile, ...authUser, nickname: typeof profile?.nickname === 'string' ? profile.nickname : authUser.nickname }
}
