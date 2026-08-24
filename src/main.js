import { createApp } from 'vue'
import { createPinia } from 'pinia'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import * as ElementPlusIconsVue from '@element-plus/icons-vue'

import App from './App.vue'
import router from './router'
import './styles/global.scss'
import './styles/mobile.scss'
import { initViewportHeight } from './utils/viewport-height'
import { readStoredTheme, applyTheme } from './stores/theme'
import { readStoredLocale, applyLocale } from './stores/locale'

applyTheme(readStoredTheme())
applyLocale(readStoredLocale())
initViewportHeight()

const app = createApp(App)

for (const [key, component] of Object.entries(ElementPlusIconsVue)) {
  app.component(key, component)
}

app.use(createPinia())
app.use(router)
app.use(ElementPlus)

app.mount('#app')
