import { createApp } from 'vue'
import App from './App.vue'
import router, { bootstrapModeForPath } from './router'
import './styles/public-bootstrap.css'

const bootstrapMode = bootstrapModeForPath(window.location.pathname)

async function bootstrap() {
  if (bootstrapMode === 'auth') {
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
    ])
    theme.applyTheme(theme.readStoredTheme())
    locale.applyLocale(locale.readStoredLocale())
    initViewportHeight()
    const app = createApp(AuthApp)
    for (const [key, component] of Object.entries(ElementPlusIconsVue)) app.component(key, component)
    app.use(createPinia())
    app.use(router)
    app.use(ElementPlus)
    app.mount('#app')
    return
  }

  createApp(App).use(router).mount('#app')
}

void bootstrap()
