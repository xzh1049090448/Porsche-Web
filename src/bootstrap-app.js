export async function bootstrapApplication({ mode, loadAuthApp, mountPublicApp, recover }) {
  try {
    if (mode === 'auth') {
      const mountAuthApp = await loadAuthApp()
      await mountAuthApp()
    } else {
      await mountPublicApp()
    }
    return true
  } catch (error) {
    try { recover?.(error) } catch {}
    return false
  }
}
