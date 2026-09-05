const { chromium } = require('/Users/xuzhihao/.codex/skills/playwright-skill/node_modules/playwright')
const base = 'http://localhost:5174'
const user = { guid: '1', username: 'root', nickname: 'Root', role: 'root', status: 'active', admin_permissions: ['users.read', 'users.deleted.read'], permissions_version: '1' }
const dto = { guid: '2', username: 'alice', nickname: null, email: null, group: null, plan_type: 'professional', role: 'admin', status: 'active', created_at: '2026-09-03T00:00:00Z', last_login_at: null }
const names = ['users.read','users.create','users.edit','users.enable','users.disable','users.reset_password','users.sessions.read','users.sessions.revoke','users.plan.change','users.group.change','users.quota.adjust','users.delete','users.deleted.read','users.promote','users.demote','users.permissions.write','users.audit.read','groups.read','groups.write','public_content.read','public_content.edit','public_content.preview','public_content.publish','public_content.rollback'];
const baseline = new Set(['users.read','users.create','users.edit','users.enable','users.disable','users.audit.read','groups.read']); const rootOnly = new Set(['users.promote','users.demote','users.permissions.write','groups.write']); const unavailable = new Set(['users.quota.adjust']);
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: false, slowMo: 40 })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  page.setDefaultTimeout(8000)
  const errors = []; const pageErrors = []; page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) }); page.on('pageerror', error => pageErrors.push(error.message))
  page.on('request', request => { if (request.url().includes('/api/') || request.url().includes('/admin/')) console.log('request', request.method(), request.url()) })
  page.on('response', response => { if (response.url().includes('/api/') || response.url().includes('/admin/')) console.log('response', response.status(), response.url()) })
  let refreshes = 0
  let listMode = 'normal'; let detailMode = 'normal'; let listTotal = 41; let listCalls = 0; let selfMode = 'valid'; let selfExpiredRetry = false
  const handleApi = async route => {
    const url = new URL(route.request().url()); const path = url.pathname
    const json = body => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
    if (path.endsWith('/auth/refresh')) { refreshes++; return refreshes === 1 ? route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ detail: '认证会话无效' }) }) : json({ access_token: 'access', token_type: 'Bearer', expires_in: 300, user }) }
    if (path.endsWith('/auth/login')) return json({ access_token: 'access', token_type: 'Bearer', expires_in: 300, user })
    if (path.endsWith('/auth/self')) {
      if (selfMode === 'expired-revoked' && !selfExpiredRetry) { selfExpiredRetry = true; return route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ detail: 'Token无效或已过期' }) }) }
      const projected = selfMode === 'missing' || selfMode === 'expired-revoked' ? { guid: user.guid, username: user.username, nickname: user.nickname, role: user.role, status: user.status }
        : selfMode === 'invalid' ? { ...user, admin_permissions: ['unknown'], permissions_version: '1' } : user
      return json({ user: projected })
    }
    if (path.endsWith('/users/me')) return json({ ...user, plan_type: 'free' })
    if (path.endsWith('/users/me/usage')) return json({ total_tokens_used: 0 })
    if (path === '/admin/v2/users') {
      listCalls++
      if (listMode === '403') return route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ detail: '无权限访问' }) })
      if (listMode === '503') return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ detail: '用户信息暂不可用' }) })
      const requested = Number(url.searchParams.get('page') || '1'); const pageSize = Number(url.searchParams.get('page_size') || '20'); const last = Math.max(1, Math.ceil(listTotal / pageSize));
      return json({ items: requested > last ? [] : [dto], total: listTotal, page: requested, page_size: pageSize })
    }
    if (path === '/admin/v2/users/2' && detailMode !== 'normal') return route.fulfill({ status: Number(detailMode), contentType: 'application/json', body: JSON.stringify({ detail: 'synthetic detail failure' }) })
    if (path === '/admin/v2/users/2') return json(dto)
    if (path.endsWith('/permissions')) return json({ user_guid: '2', role: 'admin', status: 'active', catalog_version: 1, permissions_version: '1', capabilities: names.map(name => ({ name, baseline: baseline.has(name), override: 'inherit', policy_effective: baseline.has(name), effective: baseline.has(name) })) })
    if (path.endsWith('/authz/catalog')) return json({ catalog_version: 1, override_effects: ['inherit','allow','deny'], capabilities: names.map(name => ({ name, admin_default: baseline.has(name), grantable: !rootOnly.has(name) && !unavailable.has(name), root_only: rootOnly.has(name), available: !unavailable.has(name) })) })
    return json({})
  }
  await page.route('**/api/v1/**', handleApi); await page.route('**/admin/v2/**', handleApi)
  console.log('scenario first-refresh-401-login'); await page.goto(`${base}/login`); await page.locator('input').nth(0).fill('root'); await page.locator('input').nth(1).fill('passphrase1'); await page.getByRole('button', { name: /登录/ }).click()
  console.log('step wait-chat'); await page.waitForURL(`${base}/`); console.log('step users'); await page.getByText('用户管理', { exact: true }).first().click(); await page.getByRole('cell', { name: 'alice' }).waitFor()
  console.log('scenario filters-errors-pagination'); const refreshBeforeErrors = refreshes
  await page.getByText('排序', { exact: true }).locator('..').getByRole('combobox').click(); await page.getByText('用户名', { exact: true }).last().click(); await page.getByText('顺序', { exact: true }).locator('..').getByRole('combobox').click(); await page.getByText('升序', { exact: true }).last().click(); const sorted = page.waitForResponse(r => r.url().includes('/admin/v2/users?') && r.url().includes('sort=username') && r.url().includes('order=asc')); await page.getByRole('button', { name: '查询' }).click(); await sorted
  listMode = '403'; await page.getByRole('button', { name: '查询' }).click(); await page.locator('.el-alert').getByText('无权限访问', { exact: true }).waitFor(); if (await page.getByText('alice').count()) throw new Error('403 retained user data'); if (refreshes !== refreshBeforeErrors) throw new Error('403 refreshed session')
  listMode = 'normal'; await page.getByRole('button', { name: '重试' }).click(); await page.getByText('alice').waitFor()
  listMode = '503'; await page.getByRole('button', { name: '查询' }).click(); await page.locator('.el-alert').getByText('用户信息暂不可用', { exact: true }).waitFor(); if (await page.getByText('alice').count()) throw new Error('503 retained user data')
  listMode = 'normal'; await page.getByRole('button', { name: '重试' }).click(); await page.getByText('alice').waitFor()
  listTotal = 20; const beforePageFallback = listCalls; const pageTwo = page.waitForResponse(r => r.url().includes('/admin/v2/users?') && r.url().includes('page=2')); const pageOne = page.waitForResponse(r => r.url().includes('/admin/v2/users?') && r.url().includes('page=1')); await page.getByRole('button', { name: '下一页' }).click(); await pageTwo; await pageOne; if (listCalls - beforePageFallback !== 2 || await page.locator('.el-pager .is-active').innerText() !== '1') throw new Error('page fallback was not exactly once or UI did not sync')
  console.log('scenario projection-replacement'); await page.evaluate(async () => { const { useUserStore } = await import('/src/stores/user.js'); await useUserStore().fetchSelf() }); if (!await page.getByText('alice').count()) throw new Error('same projection cleared list')
  console.log('scenario self-refresh-revocation'); const refreshBeforeSelfRevocation = refreshes; selfMode = 'expired-revoked'; selfExpiredRetry = false; await page.evaluate(async () => { const { useUserStore } = await import('/src/stores/user.js'); await useUserStore().fetchSelf() }); await page.getByText('暂无用户管理权限', { exact: true }).waitFor(); if (refreshes !== refreshBeforeSelfRevocation + 1 || await page.getByText('alice').count()) throw new Error('self refresh did not clear the revoked projection or list')
  selfMode = 'valid'; await page.getByRole('button', { name: '重新检查身份' }).click(); await page.getByText('alice').waitFor()
  selfMode = 'missing'; await page.evaluate(async () => { const { useUserStore } = await import('/src/stores/user.js'); await useUserStore().fetchSelf() }); await page.getByText('暂无用户管理权限', { exact: true }).waitFor(); if (await page.getByText('alice').count()) throw new Error('missing projection retained list')
  selfMode = 'invalid'; await page.getByRole('button', { name: '重新检查身份' }).click(); await page.getByText('暂无用户管理权限', { exact: true }).waitFor(); if (await page.locator('.header-menu').getByText('用户管理', { exact: true }).count()) throw new Error('invalid projection retained menu')
  selfMode = 'valid'; await page.getByRole('button', { name: '重新检查身份' }).click(); await page.getByText('alice').waitFor()
  await page.screenshot({ path: '/tmp/porsche-b1d-desktop.png', fullPage: true }); const permissionsResponse = page.waitForResponse(response => response.url().includes('/permissions') && response.status() === 200); await page.getByRole('button', { name: '详情' }).click(); await page.getByText('权限信息', { exact: true }).waitFor(); await permissionsResponse
  console.log('scenario detail-errors'); for (const [mode, title] of [['401', '认证会话无效'], ['403', '无权限访问'], ['404', '用户不存在'], ['503', '用户信息暂不可用']]) { await page.goBack(); await page.getByText('alice').waitFor(); const refreshBeforeDetail = refreshes; detailMode = mode; const failed = page.waitForResponse(r => r.url().includes('/admin/v2/users/2') && r.status() === Number(mode)); await page.getByRole('button', { name: '详情' }).click(); await failed; await page.locator('.el-alert').getByText(title, { exact: true }).waitFor(); if (await page.getByText('GUID', { exact: true }).count()) throw new Error(`${mode} retained detail data`); if ((mode === '401' || mode === '403') && refreshes !== refreshBeforeDetail) throw new Error(`${mode} refreshed or logged out the session`); detailMode = 'normal'; const recovered = page.waitForResponse(r => r.url().includes('/admin/v2/users/2') && r.status() === 200); await page.getByRole('button', { name: '重试' }).click(); await recovered; await page.getByText('权限信息', { exact: true }).waitFor() }
  console.log('scenario detail-projection-recovery'); selfMode = 'missing'; await page.evaluate(async () => { const { useUserStore } = await import('/src/stores/user.js'); await useUserStore().fetchSelf() }); await page.getByText('暂无用户管理权限', { exact: true }).waitFor(); if (await page.getByText('GUID', { exact: true }).count()) throw new Error('missing projection retained detail data'); selfMode = 'valid'; await page.getByRole('button', { name: '重新检查身份' }).click(); await page.getByText('GUID', { exact: true }).waitFor(); await page.screenshot({ path: '/tmp/porsche-b1d-detail.png', fullPage: true })
  console.log('scenario hard-refresh'); await page.setViewportSize({ width: 375, height: 667 }); await page.goto(`${base}/users`); await page.getByText('alice').waitFor(); await page.screenshot({ path: '/tmp/porsche-b1d-mobile.png', fullPage: true })
  console.log(JSON.stringify({ errors, pageErrors, url: page.url() })); if (pageErrors.length) throw new Error(`page errors: ${pageErrors.join('; ')}`); await browser.close()
})().catch(error => { console.error(error); process.exitCode = 1 })
