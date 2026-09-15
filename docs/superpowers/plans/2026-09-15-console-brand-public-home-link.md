# Console Brand Public Home Link Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让已登录控制台左上角品牌链接进入公共首页 `/`。

**Architecture:** 保留共享 `AppBrand` 组件和 Vue Router 导航语义，只修改该组件的固定目标。用源码合同测试锁定链接目标并防止回退到 `/chat`。

**Tech Stack:** Vue 3、Vue Router 4、Node test runner。

---

### Task 1：修改后台品牌链接

**Files:**
- Create: `src/components/shell/AppBrand.contract.test.js`
- Modify: `src/components/shell/AppBrand.vue`

- [ ] **Step 1: 写入失败的链接合同测试**

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('authenticated console brand links to the public homepage', async () => {
  const source = await readFile(new URL('./AppBrand.vue', import.meta.url), 'utf8')
  assert.match(source, /<router-link\s+to="\/"\s+class="app-brand"/)
  assert.doesNotMatch(source, /<router-link\s+to="\/chat"\s+class="app-brand"/)
})
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `node --test src/components/shell/AppBrand.contract.test.js`

Expected: FAIL，因为当前目标仍是 `/chat`。

- [ ] **Step 3: 实现最小改动**

将 `src/components/shell/AppBrand.vue` 的首行改为：

```vue
<template><router-link to="/" class="app-brand" :aria-label="title"><img src="/logo.png" alt="" class="app-brand__icon" /><span class="app-brand__copy"><strong>{{ title }}</strong><small v-if="subtitle">{{ subtitle }}</small></span></router-link></template>
```

- [ ] **Step 4: 运行聚焦测试和布局回归测试**

Run: `node --test src/components/shell/AppBrand.contract.test.js src/layouts/visual-shell.contract.test.js`

Expected: PASS。

- [ ] **Step 5: 提交改动**

```bash
git add src/components/shell/AppBrand.vue src/components/shell/AppBrand.contract.test.js
git commit -m "fix: link console brand to public home"
```

