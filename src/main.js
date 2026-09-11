import { createApp } from 'vue'
import App from './App.vue'
import { bootstrapApplication } from './bootstrap-app.js'
import router, { bootstrapModeForPath, createLazyLoadFailureHandler, renderSafeLoadError } from './router'
import './styles/tokens.scss'
import './styles/foundations.scss'
import './styles/public-bootstrap.css'

const bootstrapMode = bootstrapModeForPath(router, window.location.pathname)

async function loadAuthApp() {
  const [
    { createPinia },
    { default: ElementPlus },
    ElementPlusIconsVue,
    { default: AuthApp },
    { initViewportHeight },
    theme,
    locale,
  ] = await Promise.all([
    import('pinia'),
    import('element-plus'),
    import('@element-plus/icons-vue'),
    import('./bootstrap/AuthApp.vue'),
    import('./utils/viewport-height'),
    import('./stores/theme'),
    import('./stores/locale'),
    import('element-plus/dist/index.css'),
    import('./styles/global.scss'),
    import('./styles/mobile.scss'),
    import('./styles/console-shell.scss'),
  ])
  theme.applyTheme(theme.readStoredTheme())
  locale.applyLocale(locale.readStoredLocale())
  initViewportHeight()
  return () => {
    const app = createApp(AuthApp)
    for (const [key, component] of Object.entries(ElementPlusIconsVue)) app.component(key, component)
    app.use(createPinia())
    app.use(router)
    app.use(ElementPlus)
    app.mount('#app')
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
    return createApp(App).use(createPinia()).use(router).mount('#app')
  },
  recover,
  fallback: () => renderSafeLoadError(),
})
