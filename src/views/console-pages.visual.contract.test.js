import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import test from 'node:test'

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8')

test('core console pages share the semantic page and surface vocabulary', async () => {
  const [login, register, chat, billing, apiKeys, profile, styles] = await Promise.all([
    read('./Login.vue'),
    read('./Register.vue'),
    read('./Chat.vue'),
    read('./Billing.vue'),
    read('./ApiKeys.vue'),
    read('./Profile.vue'),
    read('../styles/console-pages.scss'),
  ])

  assert.match(login, /class="auth-page login-page"/)
  assert.match(login, /class="auth-card login-card surface-card"/)
  assert.match(register, /class="auth-page register-page"/)
  assert.match(register, /class="auth-card register-card surface-card"/)
  assert.match(chat, /class="chat-root chat-workspace"/)
  for (const source of [billing, apiKeys, profile]) {
    assert.match(source, /console-page/)
    assert.match(source, /<PageHeader/)
    assert.match(source, /surface-card/)
  }
  assert.match(styles, /\.console-page/)
  assert.match(styles, /\.auth-card/)
  assert.match(styles, /\.chat-workspace/)
  assert.match(styles, /\.token-surface/)
})

test('visual composition retains security and behavior anchors', async () => {
  const [login, register, chat, apiKeys, billing, profile] = await Promise.all([
    read('./Login.vue'), read('./Register.vue'), read('./Chat.vue'),
    read('./ApiKeys.vue'), read('./Billing.vue'), read('./Profile.vue'),
  ])

  assert.match(login, /safeAuthRedirect/)
  assert.match(login, /<AuthStatus/)
  assert.match(register, /await register\(/)
  assert.match(register, /<img src="\/logo\.png" alt="" class="logo-icon"/)
  assert.match(register, /t\('app\.title'\)/)
  assert.match(register, /t\('app\.tagline'\)/)
  assert.match(register, /<LocaleToggle/)
  assert.match(register, /<ThemeToggle/)
  assert.match(register, /role="group" :aria-label="t\('app\.title'\)"/)
  assert.match(chat, /<GenerationStatus/)
  assert.match(apiKeys, /createdSecret\.value = ''/)
  assert.match(apiKeys, /onBeforeUnmount\(clearSecret\)/)
  assert.match(apiKeys, /tokenRows\(/)
  assert.match(billing, /getUsageStats\(\)/)
  assert.match(profile, /authSession\.capture\(\)/)

  const production = [login, register, chat, apiKeys, billing, profile].join('\n')
  assert.doesNotMatch(production, /sk-[A-Za-z0-9]{8,}/)
  assert.doesNotMatch(production, /Bearer\s+[A-Za-z0-9._-]{8,}/)
})

test('streaming lock and authoritative cancel controls remain wired', async () => {
  const [status, input] = await Promise.all([
    read('../components/chat/GenerationStatus.vue'),
    read('../components/chat/ChatInput.vue'),
  ])
  assert.match(status, /v-if="showStop"/)
  assert.match(status, /:aria-label="t\('chat\.stopGeneration'\)"/)
  assert.match(status, /@click="stop"/)
  assert.match(status, /void chatStore\.cancelStream\(\)/)
  assert.match(status, /canCancelGeneration\(chatStore\.generationState\)/)
  assert.match(input, /inputLocked = computed\(\(\) => props\.disabled \|\| chatStore\.streaming\)/)
  assert.match(input, /:readonly="inputLocked"/)
  assert.match(input, /:loading="chatStore\.streaming"/)
})

test('chat presentation components use the shared workspace surfaces', async () => {
  const [sidebar, messages, input, models] = await Promise.all([
    read('../components/chat/ChatSidebar.vue'),
    read('../components/chat/ChatMessageList.vue'),
    read('../components/chat/ChatInput.vue'),
    read('../components/chat/ModelPanel.vue'),
  ])
  assert.match(sidebar, /chat-sidebar surface-rail/)
  assert.match(messages, /message-list-shell conversation-surface/)
  assert.match(input, /chat-input composer-surface/)
  assert.match(models, /model-panel model-surface/)
})

test('production bundle emits shared console page CSS once through the console shell', async () => {
  const manifest = JSON.parse(await readFile(resolve('dist/.vite/manifest.json'), 'utf8'))
  const routeKeys = ['Login.vue', 'Register.vue', 'Chat.vue', 'Billing.vue', 'ApiKeys.vue', 'Profile.vue']
  const cssFor = async (key) => {
    const entry = manifest[key] || {}
    const files = [...(entry.css || []), ...(entry.file?.endsWith('.css') ? [entry.file] : [])]
    return Promise.all(files.map(file => readFile(resolve('dist', file), 'utf8')))
  }
  const shellCss = (await cssFor('src/styles/console-shell.scss')).join('\n')
  assert.match(shellCss, /\.auth-page/)
  assert.match(shellCss, /\.console-page/)
  assert.match(shellCss, /\.chat-workspace/)
  for (const key of routeKeys.map(name => `src/views/${name}`)) {
    const routeCss = (await cssFor(key)).join('\n')
    assert.doesNotMatch(routeCss, /\.auth-page|\.console-page|\.chat-workspace|\.token-surface/)
  }
})
