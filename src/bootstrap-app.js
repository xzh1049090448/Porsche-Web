function renderMinimalError() {
  try {
    const host = document.querySelector('#app')
    if (host) host.textContent = '页面暂时无法加载，请刷新后重试。'
  } catch {}
}

/** UI-only loading: authentication remains in the existing beforeEach guard. */
export function createAuthUiLoader({ app, loadGuestUi, loadConsoleUi }) {
  let guestLoading
  let consoleLoading
  const install = load => Promise.resolve().then(load).then(installUi => { installUi(app) })
  return {
    installGuest: () => guestLoading ??= install(loadGuestUi),
    beforeResolve: to => {
      if (!to.meta.requiresAuth) return undefined
      return consoleLoading ??= install(loadConsoleUi)
    },
  }
}

/** Render an already-resolved first route without an initial enter animation. */
export async function mountAfterRouterReady(app, router) {
  app.use(router)
  await router.isReady()
  return app.mount('#app')
}

export async function bootstrapApplication({ mode, loadAuthApp, mountPublicApp, recover, fallback }) {
  try {
    if (mode === 'auth') {
      const mountAuthApp = await loadAuthApp()
      await mountAuthApp()
    } else {
      await mountPublicApp()
    }
    return true
  } catch (error) {
    let recovered = false
    try { recovered = recover?.(error) === true } catch {}
    if (!recovered) {
      try { fallback ? fallback() : renderMinimalError() }
      catch { renderMinimalError() }
    }
    return false
  }
}
