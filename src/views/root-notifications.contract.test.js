import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8')

test('Root notification center is protected in route, desktop, and mobile navigation', () => {
  const router = read('../router/index.js'), layout = read('../layouts/MainLayout.vue')
  assert.match(router, /path:\s*'\/admin\/notifications'/)
  assert.match(router, /name:\s*'RootNotifications'/)
  assert.match(router, /rootOnly:\s*true/)
  assert.ok((layout.match(/index="\/admin\/notifications"/g) || []).length >= 2)
  assert.match(layout, /RootNotificationBadge/)
})

test('inbox groups active and resolved notifications with localized type-safe presentation', () => {
  const view = read('./RootNotifications.vue'), badge = read('../components/RootNotificationBadge.vue'), messages = read('../i18n/messages.js')
  for (const token of ['active', 'resolved', 'markRead', 'acknowledge', 'read', 'acknowledged']) assert.match(view, new RegExp(token))
  for (const type of ['published_price_below_upstream', 'upstream_missing', 'automatic_inactivation', 'upstream_reappearance', 'catalog_sync_failure', 'price_not_comparable', 'renderer_failure']) assert.match(messages, new RegExp(type))
  assert.match(view, /t\(`rootNotifications\.types\.\$\{item\.type\}`\)/)
  assert.match(view, /aria-live|role="alert"/)
  assert.match(badge, /unreadCount/)
  assert.doesNotMatch(view + badge, /payload|raw_upstream_response|channel_address|secret|token|authorization/i)
  assert.doesNotMatch(view + badge + messages, /email.*(?:toggle|switch)|(?:toggle|switch).*email/i)
})

test('notification administration composes shared controls and preserves the future email boundary',()=>{
 const view=read('./RootNotifications.vue')
 for(const component of ['PageHeader','SurfaceCard','StatusBadge']){assert.match(view,new RegExp(`import ${component} from ['\"]@\\/components\\/shell\\/${component}\\.vue['\"]`));assert.match(view,new RegExp(`<${component}\\b`))}
 for(const token of ['notification-list','markRead','acknowledge','responsive-table','pagination-bar','email-delivery-todo'])assert.match(view,new RegExp(token),token)
 assert.match(view,/Email push.*TODO/i);assert.doesNotMatch(view,/email.*(?:toggle|switch)|(?:toggle|switch).*email/i)
})
