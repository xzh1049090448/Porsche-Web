function renderMinimalError() {
  try {
    const host = document.querySelector('#app')
    if (host) host.textContent = '页面暂时无法加载，请刷新后重试。'
  } catch {}
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
