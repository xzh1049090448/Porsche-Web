/** Private account metadata, intentionally distinct from the AuthUser whitelist. */
export function createProfileState(auth) {
  let profile = null
  const listeners = new Set()
  const set = next => { profile = next; listeners.forEach(fn => fn(profile)) }
  auth.onInvalidate(() => set(null))
  return {
    value: () => profile,
    subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn) },
    async load(loader) {
      const context = auth.capture()
      const result = await loader()
      auth.assertCurrent(context)
      set(result)
      return result
    },
    patch(value) { if (auth.user()) set({ ...profile, ...value }) },
  }
}

/** Combines display metadata with the authoritative authentication identity. */
export function mergeProfileDisplay(authUser, profile) {
  if (!authUser) return null
  return { ...profile, ...authUser, nickname: typeof profile?.nickname === 'string' ? profile.nickname : authUser.nickname }
}
