# Fixed Home Structured Content — Task 13 跨仓库验证记录

日期：2026-09-16
前端实现候选：`ab18718f89b55ea7106d0ac52ff9972576e4e9e4`
配对后端实现候选：`77c4e003310f3194f3e7a90cdadb7d650cbd3ba1`（包含 `f6ed4e1` exact action target locks 与 `8303a28` atomic structured artifact renderer）
跨仓库总合同：`interface-contract.json`，`v1.0.0-p0 / agreed_for_implementation`，SHA-256 `9bc9c70e70bb45b63185b3b619ae49e5e6a251ba3c4a30f64539774cb272a3ce`
后端公共内容子合同：`docs/agents/contracts/public-content-pricing-v1.json`，`v2 / implemented_locally_pending_acceptance`，SHA-256 `4db4380dcef26f0098443f591d9fe098f9faefd32a367f02ce2a14ba62d8309d`
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
- 显式绑定 A03/A05/A06/A08/A14/PublicPricing 六份后端合同的 `npm test` 为 1138/1138，0 fail/skip/cancel/todo，48.734s，exit 0。沙箱内首次运行的两个 `listen EPERM` 在获准 loopback 后均通过。
- `VITE_USE_MOCK=false npm run build` exit 0；`node scripts/check-public-route-chunks.mjs` 验证 9 chunks、171428 JS bytes、20362 CSS bytes；`git diff --check` exit 0。

## 规格复审缺陷与修复

- 首个最终快照 `6cdec47f…` 的独立规格审查返回 `SPEC_FAIL`：真实后端预览头 `noindex, nofollow` 被客户端错误拒绝；合同缺少后端既有稳定 `modelKey` 形状，公开详情客户端又允许后端会拒绝的大小写、点和下划线。该快照及配对后端快照均失效。
- RED：后端合同测试因缺少稳定键字段失败；前端定向 55 项中合同、公开详情键、真实预览头三项失败。
- 修复：后端 `77c4e00`、前端 `61c1ccb` 将键规则统一为 `^[a-z](?:[a-z0-9]|-[a-z0-9])*$`、长度 1–128，并严格接受字面预览头 `noindex, nofollow`。
- GREEN：后端定向与全仓通过；前端定向 61/61、全量 1138/1138，跨仓库公共内容合同字节一致，production build 与 9 chunks / 171428 JS bytes / 20362 CSS bytes 通过。

## 质量复审缺陷与修复

- 第二个前端快照 `ec31d2ef…` 在 `SPEC_PASS` 后被独立质量审查判定为 `QUALITY_FAIL`：Root 预览在退出、降权或切换账号后会保留已加载的未发布内容；首页草稿 GET 未接入统一认证读取、刷新与身份 fence。该快照及配对后端快照均失效；后端测试审查在开始后立即中止，未形成 verdict。
- RED：新增 API 用例证明 GET 使用直接 transport、不会安全刷新；新增挂载用例证明身份 epoch 改变后预览未跳转或清空。
- 前端 `ab18718` 将四类首页管理 GET 接入 `authenticatedFetch` 安全读取白名单，在响应体消费后再次核对身份；所有写请求仍使用只发送一次的直接 transport。预览页同步监听身份 epoch 与 Root 角色，清空已加载数据、abort 在途读取并跳转，异步结果同时绑定加载时身份。
- GREEN：API/预览定向 22/22，相关认证与公共内容定向 99/99，完整 `npm test` 1140/1140、0 fail/skip/cancel/todo、47.689s；production build 与公共 chunk 9/9、171428 JS bytes/20362 CSS bytes 通过。

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
