# 当前验证进度

## web-009：一期用户名认证与可撤销会话

- 2026-08-31：隔离 worktree 完成认证迁移。Access Token 和用户摘要仅存 Pinia/模块内存；Refresh 仅由浏览器 HttpOnly Cookie 携带。
- 2026-08-31：新增 `src/api/auth-session.test.js`，先确认模块缺失导致 RED，后验证内存无 Storage 写入、401 单飞刷新/一次重放、刷新失败清理和会话 DTO 白名单。
- 2026-08-31：`npm test` 通过（49/49）；`npm run build` 通过。保留既有 Vite/Rollup 注释、动态导入和 chunk 体积警告。
- 2026-08-31：原生 SSE、对话 Markdown 导出及分析权限/Excel 导出统一走内存 Bearer 的单飞 Cookie 刷新路径；401 仅重放一次，刷新失败或二次 401 会清空内存并只跳转一次。登录、刷新及用户状态仅保留 `guid/username/nickname/role/status` 白名单。`npm test` 54/54、`npm run build`、`git diff --check` 通过。

未执行真实 HTTPS 浏览器 E2E：后端 Refresh Cookie 固定 `Secure; HttpOnly; SameSite=Lax`，需要 HTTPS 页面和配置在 `AUTH_TRUSTED_ORIGINS` 中的同源 Origin。管理员创建/角色展示未做：后端没有创建端点，且 `AdminUser` DTO 未提供 username/role。

## web-008：模型选择搜索

- 2026-08-27：`node --test src/utils/model-search.test.js` 通过（5/5），覆盖名称、ID、厂商、描述字段的本地匹配，以及单选/对比控件共用过滤列表的组件契约。
- 2026-08-27：`npm test` 通过（44/44）。
- 2026-08-27：`npm run build` 通过；仅保留既有 Vite/Rollup 警告（注释、动态导入与 chunk 体积）。
- 2026-08-27：`git diff --check` 通过。

未运行需后端认证的浏览器手动 smoke；`web-002` 更广泛的模型面板浏览器端到端验证仍未完成。

## 2026-09-02：P0 M2 实施开始

- 用户已确认 https://aiportcloud.com 运行90abbdc，并批准M1后实施前端P0，不含部署。
- 在feature/auth-p0-harden隔离工作树复用session-auth-frontend@6f8fbca，主工作树和既有未提交内容保持不动。
- init.sh离线安装因缓存缺失失败；随后按已有package-lock执行npm ci --ignore-scripts --no-audit --no-fund（独立临时缓存）成功。锁文件与原工作树字节一致，未改package.json。基线npm test 54/54、npm run build通过；保留既有大chunk和动态导入警告。
- 契约与用户/双方协调者/M1评审确认已落盘interface-contract.json；web-009为唯一in_progress。
- 本轮本地浏览器将拦截所有API使用fixture，不以Mock结果替代真实Cookie或联合验收。

## 2026-09-03：P0 M2 本地验证

- src实施与本地回归已完成：82/82单测、build通过。浏览器完整fixture和Mock零API登录通过，资料昵称保存、注销失败重挂载循环及窄屏问题已修复。
- 可复跑脚本和实际输出见docs/agents/p0-m2-verification.md。规格/质量审查结论待补；web-009保持in_progress，不将本地验证当作M3联合验收。
- 依赖声明和构建配置无diff；已有锁文件按字节保持不变。所有线上业务写操作未执行。
