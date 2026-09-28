# Tawk.to 全站实时聊天 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在唯一 SPA HTML 入口加载一份 Tawk.to 官方脚本，使现有及未来新增的 Vue Router 页面自动获得实时聊天入口，并用源码和生产构建门禁防止遗漏或重复接入。

**Architecture:** Tawk.to 原始嵌入代码放在根 `index.html` 的 Vite 模块入口之后、`</body>` 之前，保持异步加载且不接触 Vue 状态。Node 契约测试验证唯一性、位置、固定属性、隐私边界和布局零复制；现有生产 bundle checker 验证每次构建产物仍恰好保留一份脚本。工程规范明确未来 Vue Router 页面无需单独处理，而新增独立 HTML 入口必须复用相同全局接入约束。

**Tech Stack:** Vue 3、Vite 6、Node.js `node:test`、JSDOM、现有 production bundle checker、Playwright skill

---

## File map

- Create: `src/bootstrap/tawk-live-chat.contract.test.js` — 固化根入口、全路由继承、零身份数据及第三方失败隔离契约。
- Modify: `index.html` — 在唯一 SPA 入口嵌入用户提供的 Tawk.to 官方脚本。
- Modify: `scripts/check-production-bundle.test.js` — 为构建产物中的缺失和重复脚本建立 RED 用例。
- Modify: `scripts/check-production-bundle.mjs` — 每次 production build 强制 `dist/index.html` 恰好包含一份固定 Tawk URL。
- Modify: `docs/conventions/frontend-standards.md` — 记录未来页面和未来独立 HTML 入口的接入规则。
- Modify: `feature_list.json` — 新增 `web-015` 并记录本地验证边界。
- Modify: `progress.md` — 记录实现、自动化、浏览器 smoke 与未部署边界。

### Task 1: Define the global-entry contract and persistent frontend rule

**Files:**
- Create: `src/bootstrap/tawk-live-chat.contract.test.js`
- Modify: `docs/conventions/frontend-standards.md`

- [ ] **Step 1: Add the source and isolated-runtime contract tests**

Create `src/bootstrap/tawk-live-chat.contract.test.js` with:

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { JSDOM, ResourceLoader } from 'jsdom'

const ROOT = new URL('../../', import.meta.url)
const TAWK_URL = 'https://embed.tawk.to/6aba033429f257344364f946/1k3j9p1b0'
const MAIN_ENTRY = '<script type="module" src="/src/main.js"></script>'

const occurrences = (text, value) => text.split(value).length - 1
const readRoot = path => readFile(new URL(path, ROOT), 'utf8')

async function productionSources(root) {
  const entries = await readdir(root, { withFileTypes: true })
  const nested = await Promise.all(entries.map(async entry => {
    const path = join(root, entry.name)
    if (entry.isDirectory()) return productionSources(path)
    if (!/\.(?:js|vue)$/.test(entry.name) || entry.name.endsWith('.test.js')) return []
    return [path]
  }))
  return nested.flat()
}

class BlockingResourceLoader extends ResourceLoader {
  blocked = []

  fetch(url) {
    this.blocked.push(url)
    return null
  }
}

test('the SPA root owns exactly one Tawk embed and future Vue routes inherit it', async () => {
  const [html, standards] = await Promise.all([
    readRoot('index.html'),
    readRoot('docs/conventions/frontend-standards.md'),
  ])
  const mainIndex = html.indexOf(MAIN_ENTRY)
  const embedIndex = html.indexOf('<!--Start of Tawk.to Script-->')
  const embedEndIndex = html.indexOf('<!--End of Tawk.to Script-->')
  const bodyEndIndex = html.indexOf('</body>')
  const embed = html.slice(embedIndex, embedEndIndex)

  assert.equal(occurrences(html, TAWK_URL), 1)
  assert.ok(mainIndex >= 0 && mainIndex < embedIndex)
  assert.ok(embedIndex < bodyEndIndex)
  assert.match(html, /s1\.async=true/)
  assert.match(html, /s1\.charset='UTF-8'/)
  assert.match(html, /s1\.setAttribute\('crossorigin','\*'\)/)
  assert.doesNotMatch(embed, /Tawk_API\.visitor|localStorage|document\.cookie/)

  const unexpected = []
  for (const path of await productionSources(fileURLToPath(new URL('src/', ROOT)))) {
    if ((await readFile(path, 'utf8')).includes('embed.tawk.to')) unexpected.push(path)
  }
  assert.deepEqual(unexpected, [])
  assert.match(standards, /后续新增 Vue Router 页面自动继承/)
  assert.match(standards, /新增独立 HTML 入口/)
})

test('a blocked Tawk request leaves the application root usable and inserts no duplicate widget script', async () => {
  const html = await readRoot('index.html')
  const loader = new BlockingResourceLoader()
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    resources: loader,
    url: 'https://local.test/',
  })

  try {
    await new Promise(resolve => setTimeout(resolve, 0))
    const scripts = [...dom.window.document.scripts].filter(script => script.src === TAWK_URL)
    assert.equal(scripts.length, 1)
    assert.equal(scripts[0].async, true)
    assert.equal(scripts[0].charset, 'UTF-8')
    assert.equal(scripts[0].getAttribute('crossorigin'), '*')
    assert.ok(dom.window.document.querySelector('#app'))
    assert.deepEqual(loader.blocked, [TAWK_URL])
    assert.equal(dom.window.Tawk_API.visitor, undefined)
  } finally {
    dom.window.close()
  }
})
```

- [ ] **Step 2: Add the future-page rule to the frontend standard**

Append this section to `docs/conventions/frontend-standards.md`:

```markdown

## 全站实时聊天入口

- Tawk.to 只允许在根 `index.html` 保留一份官方嵌入代码；禁止复制到 `PublicLayout`、`MainLayout`、页面组件或路由模块。
- 后续新增 Vue Router 页面自动继承根入口，不需要也不允许逐页接入实时聊天。
- 若项目新增独立 HTML 入口或多页面构建，该入口必须复用同一个固定 Tawk property/widget 地址，并通过 `src/bootstrap/tawk-live-chat.contract.test.js` 与 production build 门禁。
- 不通过 `Tawk_API.visitor` 或其他方式向 Tawk.to 传递账号、GUID、Token、手机号、Cookie、localStorage 或业务数据。
```

- [ ] **Step 3: Run the focused contract test and verify RED**

Run:

```bash
node --test src/bootstrap/tawk-live-chat.contract.test.js
```

Expected: 2 tests fail because `index.html` does not contain the Tawk URL or embedded widget script.

### Task 2: Embed the official Tawk script once at the SPA root

**Files:**
- Modify: `index.html`
- Test: `src/bootstrap/tawk-live-chat.contract.test.js`

- [ ] **Step 1: Insert the approved raw embed after the Vite application entry**

Change the end of `index.html` to:

```html
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.js"></script>
    <!--Start of Tawk.to Script-->
    <script type="text/javascript">
    var Tawk_API=Tawk_API||{}, Tawk_LoadStart=new Date();
    (function(){
    var s1=document.createElement("script"),s0=document.getElementsByTagName("script")[0];
    s1.async=true;
    s1.src='https://embed.tawk.to/6aba033429f257344364f946/1k3j9p1b0';
    s1.charset='UTF-8';
    s1.setAttribute('crossorigin','*');
    s0.parentNode.insertBefore(s1,s0);
    })();
    </script>
    <!--End of Tawk.to Script-->
  </body>
```

- [ ] **Step 2: Run the focused contract test and verify GREEN**

Run:

```bash
node --test src/bootstrap/tawk-live-chat.contract.test.js
```

Expected: 2/2 tests pass, the simulated remote request is blocked, and `#app` remains present.

- [ ] **Step 3: Commit the root-entry implementation and contract**

```bash
git add index.html src/bootstrap/tawk-live-chat.contract.test.js docs/conventions/frontend-standards.md
git commit -m "feat: add global Tawk live chat"
```

### Task 3: Make the production build fail when Tawk is missing or duplicated

**Files:**
- Modify: `scripts/check-production-bundle.test.js`
- Modify: `scripts/check-production-bundle.mjs`

- [ ] **Step 1: Give all existing checker fixtures a valid default HTML entry**

Add below the `checker` constant in `scripts/check-production-bundle.test.js`:

```js
const TAWK_URL = 'https://embed.tawk.to/6aba033429f257344364f946/1k3j9p1b0'
const validIndex = `<!doctype html><html><body><script src="${TAWK_URL}"></script></body></html>`
```

Change the fixture loop from:

```js
for (const [name, content] of Object.entries(files)) {
```

to:

```js
for (const [name, content] of Object.entries({ 'index.html': validIndex, ...files })) {
```

- [ ] **Step 2: Add missing and duplicate build-artifact tests**

Add before the clean-bundle test:

```js
test('rejects a production entry without the Tawk widget', async () => {
  const result = await fixture({
    'index.html': '<!doctype html><html><body></body></html>',
    '.vite/manifest.json': '{}',
    'assets/main.js': 'export{}',
  })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /exactly one Tawk widget/i)
})

test('rejects duplicate Tawk widgets in the production entry', async () => {
  const result = await fixture({
    'index.html': `<script src="${TAWK_URL}"></script><script src="${TAWK_URL}"></script>`,
    '.vite/manifest.json': '{}',
    'assets/main.js': 'export{}',
  })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /exactly one Tawk widget/i)
})
```

- [ ] **Step 3: Run the checker tests and verify RED**

Run:

```bash
node --test scripts/check-production-bundle.test.js
```

Expected: the two new tests fail because the checker still accepts missing and duplicate Tawk URLs; the six existing tests pass.

- [ ] **Step 4: Enforce exactly one Tawk URL in `dist/index.html`**

Add below the `forbidden` array in `scripts/check-production-bundle.mjs`:

```js
const TAWK_URL = 'https://embed.tawk.to/6aba033429f257344364f946/1k3j9p1b0'
const distRoot = join(process.cwd(), 'dist')
let tawkWidgetCount = 0
let hasHtmlEntry = false
```

Change the existing loop header to:

```js
for (const path of await files(distRoot)) {
```

Inside that loop, immediately after `const text = content.toString('utf8')`, add:

```js
  if (path === join(distRoot, 'index.html')) {
    hasHtmlEntry = true
    tawkWidgetCount = text.split(TAWK_URL).length - 1
  }
```

After the loop, add:

```js
if (!hasHtmlEntry || tawkWidgetCount !== 1) {
  process.stderr.write(`Production bundle must contain exactly one Tawk widget in dist/index.html; found ${tawkWidgetCount}.\n`)
  process.exit(1)
}
```

- [ ] **Step 5: Run the checker tests and verify GREEN**

Run:

```bash
node --test scripts/check-production-bundle.test.js
```

Expected: 8/8 tests pass.

- [ ] **Step 6: Commit the production gate**

```bash
git add scripts/check-production-bundle.mjs scripts/check-production-bundle.test.js
git commit -m "test: require Tawk in production entry"
```

### Task 4: Run full verification and an intercepted visible-browser smoke

**Files:**
- No repository files changed in the automated verification steps.
- Create temporary browser script: `/private/tmp/playwright-test-tawk-live-chat.js`

- [ ] **Step 1: Build the production bundle**

Run:

```bash
VITE_USE_MOCK=false npm run build
```

Expected: Vite build succeeds, the existing large-chunk warnings may remain, and `check-production-bundle.mjs` exits 0 after finding exactly one Tawk URL.

- [ ] **Step 2: Run the full Node suite with the six required backend contracts**

Run:

```bash
A03_BACKEND_CONTRACT=/Users/xuzhihao/code/Porsche/.worktrees/compare-history-grouping/docs/agents/contracts/admin-user-create-v1.json \
A05_BACKEND_CONTRACT=/Users/xuzhihao/code/Porsche/.worktrees/compare-history-grouping/docs/agents/contracts/admin-user-edit-v1.json \
A06_BACKEND_CONTRACT=/Users/xuzhihao/code/Porsche/.worktrees/compare-history-grouping/docs/agents/contracts/admin-user-status-v1.json \
A08_BACKEND_CONTRACT=/Users/xuzhihao/code/Porsche/.worktrees/compare-history-grouping/docs/agents/contracts/admin-user-roles-permissions-v1.json \
A14_BACKEND_CONTRACT=/Users/xuzhihao/code/Porsche/.worktrees/compare-history-grouping/docs/agents/contracts/admin-action-future-contract.json \
PUBLIC_PRICING_BACKEND_CONTRACT=/Users/xuzhihao/code/Porsche/.worktrees/compare-history-grouping/docs/agents/contracts/public-content-pricing-v1.json \
npm test
```

Expected: 1215/1215 tests pass with 0 fail and 0 skip.

- [ ] **Step 3: Start production preview on an isolated loopback port**

Run in a retained terminal session:

```bash
npm run preview -- --host 127.0.0.1 --port 4179
```

Expected: Vite reports `http://127.0.0.1:4179/`.

- [ ] **Step 4: Confirm the preview server through the Playwright skill detector**

Run:

```bash
cd /Users/xuzhihao/.codex/skills/playwright-skill && node -e "require('./lib/helpers').detectDevServers().then(servers => console.log(JSON.stringify(servers)))"
```

Expected: the detected server list includes `http://127.0.0.1:4179`.

- [ ] **Step 5: Write an intercepted visible-browser smoke script**

Create `/private/tmp/playwright-test-tawk-live-chat.js` with:

```js
const assert = require('node:assert/strict')
const { chromium } = require('playwright')

const TARGET_URL = process.env.TARGET_URL || 'http://127.0.0.1:4179'
const TAWK_URL = 'https://embed.tawk.to/6aba033429f257344364f946/1k3j9p1b0'

;(async () => {
  const browser = await chromium.launch({ headless: false })
  const context = await browser.newContext()
  const blocked = []
  await context.route('https://embed.tawk.to/**', route => {
    blocked.push(route.request().url())
    return route.abort('blockedbyclient')
  })
  const page = await context.newPage()

  try {
    for (const path of ['/', '/login', '/chat']) {
      const before = blocked.length
      await page.goto(`${TARGET_URL}${path}`, { waitUntil: 'domcontentloaded' })
      await page.waitForFunction(() => document.querySelector('#app')?.childElementCount > 0)
      const count = await page.locator(`script[src="${TAWK_URL}"]`).count()
      assert.equal(count, 1, path)
      assert.equal(blocked.length, before + 1, path)
    }
    console.log(JSON.stringify({ status: 'PASS', routes: ['/', '/login', '/chat'], blockedTawkRequests: blocked.length }))
  } finally {
    await browser.close()
  }
})().catch(error => {
  console.error(error)
  process.exitCode = 1
})
```

- [ ] **Step 6: Execute the visible-browser smoke without opening a real chat session**

Run:

```bash
cd /Users/xuzhihao/.codex/skills/playwright-skill && TARGET_URL=http://127.0.0.1:4179 node run.js /private/tmp/playwright-test-tawk-live-chat.js
```

Expected: visible Chromium reports `PASS`, all three route documents mount, each contains one widget script, and all three Tawk requests are aborted before a real customer-service session starts.

- [ ] **Step 7: Stop the retained preview session and run repository bootstrap**

Stop the preview with `Ctrl-C`, then run from the worktree root:

```bash
./init.sh
```

Expected: dependency synchronization and production build finish successfully; the printed start command remains `npm run dev`.

### Task 5: Record evidence and finish the branch

**Files:**
- Modify: `feature_list.json`
- Modify: `progress.md`

- [ ] **Step 1: Add the completed feature record**

Insert this object into the `features` array in `feature_list.json`:

```json
{
  "id": "web-015",
  "priority": 0,
  "area": "platform-shell",
  "title": "全站 Tawk.to 实时聊天入口",
  "user_visible_behavior": "公共页、登录页和控制台路由共享同一个实时聊天入口；后续新增 Vue Router 页面自动继承，不需要逐页接入。",
  "status": "passing",
  "phase": "local_verification_complete_pending_release",
  "verification": [
    "根 index.html 唯一嵌入、固定 URL 与隐私边界契约",
    "JSDOM 阻断第三方网络后的应用根节点隔离验证",
    "production bundle 缺失或重复 Tawk 脚本拒绝测试",
    "六份权威后端合同注入后的全量 npm test",
    "VITE_USE_MOCK=false production build 与 init.sh",
    "可见 Chromium 对 /、/login、/chat 的 Tawk 请求拦截 smoke"
  ],
  "evidence": [
    "2026-09-28：根入口与隔离运行契约 2/2 PASS；production bundle checker 8/8 PASS。",
    "2026-09-28：显式六份权威后端合同后的全量 npm test 1215/1215 PASS、0 fail、0 skip；VITE_USE_MOCK=false npm run build 与 init.sh PASS。",
    "2026-09-28：可见 Chromium 依次加载 /、/login、/chat，三个文档均挂载应用并仅插入一份固定 widget script；3 次 embed.tawk.to 请求全部在本机拦截，未建立真实客服会话。"
  ],
  "notes": "仅代表本地源码、构建产物和 synthetic 浏览器 smoke 通过。未部署、未访问生产公开 HTTPS，也未验证 Tawk 后台收发消息；没有向 Tawk.to 传递登录身份或业务数据。"
}
```

- [ ] **Step 2: Add the latest progress entry**

Prepend this section below `# 当前验证进度` in `progress.md`:

```markdown
## 2026-09-28：Tawk.to 全站实时聊天入口（本地通过）

- 根 `index.html` 在 Vite 入口之后保留唯一一份官方异步嵌入；所有现有和未来 Vue Router 页面自动继承。工程规范禁止在布局或页面重复接入，并规定未来独立 HTML 入口的复用要求。
- 源码与隔离运行契约 2/2 PASS；production bundle checker 8/8 PASS；显式六份权威后端合同后的全量 `npm test` 1215/1215 PASS、0 fail、0 skip；`VITE_USE_MOCK=false npm run build` 与 `./init.sh` PASS。
- 可见 Chromium 对 `/`、`/login`、`/chat` 完成拦截式 smoke：三个文档都挂载应用且各只有一个固定 widget script，3 次第三方请求均在本机终止，没有创建真实客服会话。
- 本轮没有传递登录身份或业务数据，没有增加依赖、后端接口或环境开关。未部署、未访问生产公开 HTTPS，也未验证 Tawk 后台实际消息收发。
```

- [ ] **Step 3: Validate metadata and whitespace**

Run:

```bash
node -e "JSON.parse(require('node:fs').readFileSync('feature_list.json','utf8')); console.log('feature_list valid')"
git diff --check
```

Expected: `feature_list valid` and both commands exit 0.

- [ ] **Step 4: Run the focused tests once more after documentation updates**

Run:

```bash
node --test src/bootstrap/tawk-live-chat.contract.test.js scripts/check-production-bundle.test.js
```

Expected: 10/10 tests pass.

- [ ] **Step 5: Commit the verification record**

```bash
git add feature_list.json progress.md
git commit -m "docs: record Tawk chat verification"
```

- [ ] **Step 6: Verify final branch state**

Run:

```bash
git status --short
git log --oneline -4
```

Expected: the worktree is clean and the log contains the design, implementation, production-gate, and verification-record commits. No push, merge, deployment, or production acceptance is performed by this plan.
