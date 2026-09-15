# Fixed Home Structured Content — Task 13 跨仓库验证记录

日期：2026-09-16
前端实现候选：`78006b360b1f005ded208b68aae6464c67891b52`
配对后端实现候选：`8303a28`（包含 `f6ed4e1` exact action target locks 与 `8303a28` atomic structured artifact renderer）
跨仓库总合同：`interface-contract.json`，`v1.0.0-p0 / agreed_for_implementation`，SHA-256 `771f9efb7c9684cd25cf53dbad667badaca26d6289de8cf4e2bbefa50e0a6579`
后端公共内容子合同：`docs/agents/contracts/public-content-pricing-v1.json`，`v2 / implemented_locally_pending_acceptance`，SHA-256 `649f3b2f44e8676032097f57b00931647042e70d9d7283ca0fb29a0eaa798ce5`
当前结论：`PASS_LIMITED_SCOPE`

## Task 13 后端真实数据层证据

配对后端在 disposable、loopback-only MySQL 8.4.11 与 Redis 7-alpine 上完成计划内真实数据层验证。MySQL 使用 tmpfs，Redis 无持久化；迁移前后均为 20 行 0001–0020。

- normal：`go test -p 1 ./internal/migration ./internal/service ./internal/handler -run 'Test.*PublicHome|Test.*PublicContent|Test.*PublicCatalog' -count=1`，migration 3.860s、service 3.178s、handler 0.519s，exit 0。
- race：`go test -race -p 1 ./internal/service ./internal/handler -run 'Test.*PublicHome|Test.*PublicContent' -count=1`，service 7.051s、handler 1.643s，exit 0；计划内门禁 0 unexpected skip。
- root 允许 loopback 后静态全仓 `go test ./... -count=1` exit 0；真实 fixture 下 service 全包串行 171.312s、handler 全包串行 17.009s 通过。
- `go vet ./...`、`go build ./...`、`deploy/test-dockerfile.sh`、`gofmt -d`、`git diff --check` 均 exit 0。
- renderer 确定性 stale-overwrite 用例先 RED，加入 `flock` 序列化后 GREEN，race `-count=3` exit 0。覆盖安全 root、symlink 拒绝、目录 0700、文件 0600、canonical SHA/manifest、generation/fence、原子 current 指针及 stale rollback 保护。
- renderer 输出供固定 Vue shell 消费的结构化快照，不是服务端生成 HTML。

计划外完整命令 `go test -p 1 ./internal/migration ./internal/service ./internal/handler -count=1` overall exit 1。失败仅来自四个历史 migration 断言：`TestBusinessGroupMigrationOnIsolatedMySQL/backfills_active_and_tombstoned_users`、`TestPublicPriceDraftStateMigrationRealMySQLDownAndReapply`、`TestPublicRenderJobTerminalMigrationRealMySQLDownAndReapply`、`TestUpstreamMonitorLeaseMigrationRealMySQLDownAndReapply`。它们硬编码已过时的 terminal/dependency 假设，记录为 `NON_BLOCKING_EXTRA_CHECK_FAIL`；计划内 scoped migration gate 已通过。

## 契约状态纠偏后的重验证

- 公共内容与平台冻结契约定向测试 14/14，0 fail/skip，exit 0。
- 显式绑定 A03/A05/A06/A08/A14/PublicPricing 六份后端合同的 `npm test` 为 1137/1137，0 fail/skip/cancel/todo，48.378s，exit 0。沙箱内首次运行的两个 `listen EPERM` 在获准 loopback 后均通过。
- `VITE_USE_MOCK=false npm run build` exit 0；`node scripts/check-public-route-chunks.mjs` 验证 9 chunks、171480 JS bytes、20362 CSS bytes；`git diff --check` exit 0。

## 浏览器证据边界

浏览器证据沿用 Task 12 的 Playwright `page.route` 合成矩阵：12/12 场景、234/234 断言、32 条脱敏请求、0 unexpected console error、0 page error。该证据没有启动真实后端，不能标记为真实 Root 联合验收。

真实 Root 浏览器 CRUD、RBAC、预览、校验、发布、历史、恢复及浏览器层事务仍为 `NOT_RUN`。P08 生产内容真实性标准继续为 `BLOCKED_PRODUCT`；`web-012` 保持 `in_progress / PASS_LIMITED_SCOPE`。

## 清理与运行边界

- MySQL 容器 `230609b618dde469fdf1093ed109c747d9989f41fd91b4e5bc3f432f702ba3c0` 与 Redis 容器 `4156fde30229cb2372c2a8376b608a678b4e952d6a1cf0b6f28af16f0c38f00e` 已按完整 ID 精确删除。
- 两个容器名称均不存在；52179/54737 已关闭；私有凭据文件已不存在。
- external scheduler/systemd、生产 volume mount、前端 artifact reader 为 `NOT_RUN`。
- 生产 migration、deploy、真实内容 publication、public HTTPS 和生产验收为 `NOT_RUN`。
- 本轮未 push、创建 PR、merge 或 deploy。

Task 13 的最终 review baseline/snapshot 与有序 `Spec → Quality` 审查将在所有受审文件冻结后生成。评审回执写入工作区外的 `/private/tmp/porsche-fixed-home-structured-content-review/frontend/final-review-receipt.json`，避免回执自身改变受审快照。
