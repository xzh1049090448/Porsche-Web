# P0 M2 前端实施与验证记录

**最终结论：M2 本地实现、规格复核与独立质量复核通过。** 最新单测 113/113、构建 5.64 秒、浏览器 flow 8 项通过。前端已合入 origin/main@7fbf616，后端最新代码合同为0bab2b7。M3和新版本部署仍未验证。下文保留各阶段历史证据，最终结果以本段及末节为准。

记录日期：2026-09-03；本轮开始日期：2026-09-02。

用户要求更新基线后继续：已 fetch 前端 origin/main@7fbf616、后端 origin/main@0bab2b7。下列 82/82 和浏览器证据属于合并前 checkpoint 3a10d6e，不能代替合并后验证；合并与重新审查进行中。

## 范围与版本

- 工作树：`Porsche-Web/.worktrees/auth-p0-harden`，分支 `feature/auth-p0-harden`。
- 原前端 `main@9e133518874e1c0554615ae988f57d6d6cecfbf6`；复用认证分支 `6f8fbca`，本次在其上补齐 M1 加固。
- 后端契约目标 `90abbdc49513039fa9218a6ce72d3147fbf1721e`；用户确认部署域名 https://aiportcloud.com。公开 health 的 200 不证明部署 SHA。
- 用户批准本地 M2 实现、测试与文档。未部署、未修改后端、依赖声明或构建配置，未操作线上账号。
- P0 九个 auth 端点和 users/me 的后端书面确认见 `interface-contract.json`。代码与本地验证尚不能视为后端对最终交付的签收。

## 实现

内存 Access/AuthUser 与业务 profile 分离；共享协调记录只存非敏感 epoch/pending/suppressed。Cookie 变更使用 Web Locks 串行，锁内复核共享状态。仅明确安全 GET 的中间件 401 可恢复一次；写操作、SSE、密码业务 401 不自动重放。身份变化阻断旧响应和下载，清空模型、会话、资料缓存并取消流。

SSE 的上游 [DONE] 不等于业务完成，继续读取本地 done/error；失败不能转为成功，缺终态和取消不报成功。保留既有实名、用量和 Mock 模式。日期映射支持后端 RFC3339Nano 字符串。

## 已执行的浏览器行为

本地 Chrome，1280×900 和 390×844；拦截所有 API，阻止其他 origin。覆盖注册不自动登录、登录、刷新进入资料页、错误旧密码只请求一次且不刷新、Access 不落盘、窄屏无横向溢出、注销 401 后本地退出且 reload 零 refresh。额外检查 Mock 无后端登录及既有昵称更新。

回归中实际发现并修复：窄屏 header 溢出、无效 phone 展示、uncertain 重复失效导致页面重挂载循环、Mock 首次恢复依赖真实后端，以及旧 AuthUser 昵称覆盖资料编辑结果。昵称和 Mock 修复均已通过浏览器复跑。

## 可复跑脚本

`docs/agents/validation/p0-browser-flow.cjs`：正式适配路径配合本地 fixture，默认 http://127.0.0.1:5178，可通过 P0_URL 修改。开发服务使用 `npm run dev -- --host 127.0.0.1 --port 5178 --strictPort`。

`docs/agents/validation/p0-browser-mock.cjs`：Mock 模式零 API 请求，服务为 `VITE_USE_MOCK=true npm run dev -- --host 127.0.0.1 --port 5179 --strictPort`。

两个脚本要求本机已有 Playwright 和 Chrome，可设置 P0_PLAYWRIGHT_MODULE 为已有 Playwright 模块路径，不增加仓库依赖。测试使用临时浏览器上下文。截图写到 /tmp，不记录密码或请求凭据。

## 未覆盖与下一步

- M3：真实同源 HTTPS Cookie/Origin、刷新轮换与注销撤销、跨标签真实崩溃/延迟响应、权限隔离和联合验收，须由双方协调者确定隔离环境、账号和时间后执行。未执行，不标 PASS。
- 全部持久写被浏览器拒绝时，只能保证零 Cookie 请求和当前页阻断；无法保证 reload 后保留从未落盘的退出意图。这是可观察的能力边界，不能声称跨崩溃线性一致。
- 不确定请求的 pending/suppressed 不通过刷新或手工删除自动解除；需在授权环境确认服务端状态并建立恢复操作规程。
- 完整 P1 模型目录/详情/流式交付仍另行跟踪；本轮只做认证兼容及 SSE 防假成功。
- 没有配置 ESLint/TypeScript/Lighthouse 门禁；未虚构 lint 或性能分数。构建既有 chunk 体积警告仍在。

## 后续行动与责任

1. 前端协调者：汇总独立审查、冻结交付版本并发起 M3 环境和专用数据准备。
2. 后端 project_manager：确认目标部署 SHA、测试账号权限、可信 Origin、会话撤销和异常场景，以及联调窗口；此轮最终代码尚未获得其联合验收确认。
3. 前端开发者：根据 M3 证据修正兼容问题，未经确认不扩大接口或 P1 范围。
4. 前端质量角色：按具体执行用例复核；Mock、未执行和跳过不能计入联合验收通过率。

## 验证命令和实际输出

### 单元与请求/流式行为

Command run: `npm test > /tmp/porsche-p0-tests-final.log 2>&1`

```text
ℹ tests 82
ℹ pass 82
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
```

Result: PASS。实际覆盖详情以 src 下测试名称为准，不将计划编号 AUTH001–035 全部推定为已执行。

### 生产构建

Command run: `npm run build > /tmp/porsche-p0-build-final.log 2>&1`

```text
✓ built in 6.24s
```

Result: PASS，exit 0；保留原有 dynamic import、PURE 注解和超过 500 kB chunk 的构建警告。

### 本地浏览器 fixture

Command run: `P0_PLAYWRIGHT_MODULE=/Users/xuzhihao/.npm-global/lib/node_modules/omniroute/node_modules/playwright node docs/agents/validation/p0-browser-flow.cjs`

```json
{"result":"PASS","checks":["register-no-auto-login","login","refresh-profile","profile-nickname-update","wrong-password-no-refresh","no-access-storage","mobile-no-overflow","logout401-reload-suppressed"],"errors":[],"unexpected":[]}
```

Result: PASS。对抗用例包括错误旧密码不重放，以及注销被拒后 reload 零刷新；所有响应来自本地 fixture，不是后端测试结果。

### Mock 回归

Command run: `P0_PLAYWRIGHT_MODULE=/Users/xuzhihao/.npm-global/lib/node_modules/omniroute/node_modules/playwright node docs/agents/validation/p0-browser-mock.cjs`

```json
{"result":"PASS","checks":["mock-login-zero-network"],"calls":[],"errors":[]}
```

Result: PASS。阻断所有真实 API 请求的情况下仍可登录演示模式。

### 文件检查

Command run: `git diff --check`

Output observed: 无输出，exit 0。Result: PASS。

使用 Python json 解析 feature_list.json/interface-contract.json，并按字节比对 .agents 与 .codex/agents 副本及既有 package-lock，输出：

```text
JSON valid; Agent copies match; active features: ['web-009']
Existing package-lock unchanged
```

系统 Python 无 tomllib，未声称重新执行 TOML 语法校验；本次配置为既有配置逐字复制。

## 审查状态

规格独立复核 PASS（M2 范围）：严格 LoginResponse/AuthUser 校验已修复，畸形 login/refresh 保留 pending/suppressed；昵称和 Mock 回归已关闭。SSE 未知 401 只提示且零重放符合设计，不强行改为全部退出。独立质量复核进行中；真实 M3 和后端最终签收未执行。

## Post-merge verification (2026-09-03)

Frontend upstream: origin/main@7fbf616. Backend code: 0bab2b7; public contracts reconfirmed by backend project_manager, deployment unverified. All 13 upstream history race tests remain; two identity-isolation regression tests were added.

Command run: `npm test > /tmp/porsche-p0-merged-tests.log 2>&1`

```text
tests 111
pass 111
fail 0
cancelled 0
skipped 0
```

Result: PASS, including 15 real-store history/identity tests. Old pending work is not reused across identities; old cleanup cannot remove new pending work; old waiters cannot return the new user's conversation.

Command run: `npm run build > /tmp/porsche-p0-merged-build.log 2>&1`

```text
built in 5.54s
```

Result: PASS; existing build warnings remain.

Both saved browser scripts were rerun after merging. Flow: result=PASS, all 8 checks, errors=[], unexpected=[]. Mock: result=PASS, calls=[], errors=[]. These remain local fixtures.

Backend changes were inspected read-only; its MySQL/Redis tests were not rerun. Final independent review is pending.

Post-merge independent spec review: PASS at 662c892. Upstream history behavior, epoch checks, pending-instance cleanup and stream isolation reviewed; no new M2 spec gaps. Final quality review resumed against this revision.

## Final verification and quality sign-off (2026-09-03)

Final state-machine boundary fix: a definite failed login while initializing with no identity settles to anonymous. Existing authenticated identity remains unchanged on credential failure. Independent probes verified zero subsequent refresh and preserved existing identity; targeted tests 17/17 PASS. Independent quality verdict: M2 PASS. Post-merge spec review: PASS.

Command run: `npm test > /tmp/porsche-p0-final-tests.log 2>&1`

```text
tests 113
pass 113
fail 0
cancelled 0
skipped 0
```

Result: PASS.

Command run: `npm run build > /tmp/porsche-p0-final-build.log 2>&1`

```text
built in 5.64s
```

Result: PASS. The saved browser-flow command was rerun on the final source: result=PASS, all 8 checks, errors=[], unexpected=[]. Mock zero-network login was verified after upstream integration. M3 and deployment remain unverified; no online business writes were executed.
