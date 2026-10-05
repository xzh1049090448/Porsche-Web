import { createApp } from 'vue'
import App from './App.vue'
import { bootstrapApplication, createAuthUiLoader, mountAfterRouterReady } from './bootstrap-app.js'
import router, { bootstrapModeForPath, createLazyLoadFailureHandler, renderSafeLoadError } from './router'
import './styles/tokens.scss'
import './styles/foundations.scss'
import './styles/public-bootstrap.css'
import './styles/public-shell.scss'

const bootstrapMode = bootstrapModeForPath(router, window.location.pathname)

async function loadAuthApp() {
  const [
    { createPinia },
    { installGuestUi },
    { default: AuthApp },
    { initViewportHeight },
    theme,
    locale,
  ] = await Promise.all([
    import('pinia'),
    import('./bootstrap/guest-ui.js'),
    import('./bootstrap/AuthApp.vue'),
    import('./utils/viewport-height'),
    import('./stores/theme'),
    import('./stores/locale'),
    import('./styles/global.scss'),
    import('./styles/mobile.scss'),
    import('./styles/console-shell.scss'),
  ])
  theme.applyTheme(theme.readStoredTheme())
  locale.applyLocale(locale.readStoredLocale())
  initViewportHeight()
  return async () => {
    const app = createApp(AuthApp)
    app.use(createPinia())
    const ui = createAuthUiLoader({
      app,
      loadGuestUi: async () => installGuestUi,
      loadConsoleUi: async () => {
        const [{ default: ElementPlus }, icons] = await Promise.all([
          import('element-plus'),
          import('@element-plus/icons-vue'),
          import('element-plus/dist/index.css'),
        ])
        return app => {
          for (const [key, component] of Object.entries(icons)) app.component(key, component)
          app.use(ElementPlus)
        }
      },
    })
    await ui.installGuest()
    router.beforeResolve(ui.beforeResolve)
    return mountAfterRouterReady(app, router)
  }
}

let storage = null
try { storage = window.sessionStorage } catch {}
const recover = createLazyLoadFailureHandler({
  storage,
  reload: () => window.location.reload(),
  fallback: () => renderSafeLoadError(),
})

void bootstrapApplication({
  mode: bootstrapMode,
  loadAuthApp,
  mountPublicApp: async () => {
    const { createPinia } = await import('pinia')
    return mountAfterRouterReady(createApp(App).use(createPinia()), router)
  },
  recover,
  fallback: () => renderSafeLoadError(),
})
