# Fixed Home Structured Content — Task 13 跨仓库验证记录

日期：2026-09-16
前端代码候选：`78006b360b1f005ded208b68aae6464c67891b52`
配对后端代码候选：`8303a28`（包含 `f6ed4e1` exact action target locks 与 `8303a28` atomic structured artifact renderer）
合同：`v1.0.0-p0` / `agreed_for_implementation` / SHA-256 `3bb7932bf8637b6fcbe3b26694b4e63aa0fb72a047fb127f817865d46e0c7058`
当前结论：`PASS_LIMITED_SCOPE`

## Task 13 后端真实数据层证据

配对后端在 disposable、loopback-only MySQL 8.4.11 与 Redis 7-alpine 上完成计划内真实数据层验证。MySQL 使用 tmpfs，Redis 无持久化；迁移前后均为 20 行 0001–0020。

- normal `-p 1`：migration 3.860s、service 3.178s、handler 0.519s，全部通过。
- race：service 7.051s、handler 1.643s，全部通过；计划内门禁 0 unexpected skip。
- root 允许 loopback 后静态全仓 `go test ./...` 通过；真实 fixture 下 service 全包串行 171.312s、handler 全包串行 17.009s 通过。
- `go vet ./...`、构建、`deploy/test-dockerfile.sh`、`gofmt -d`、`git diff --check` 通过。
- renderer 确定性 stale-overwrite 用例先 RED，加入 `flock` 序列化后 GREEN，race `-count=3` 通过。覆盖安全 root、symlink 拒绝、目录 0700、文件 0600、canonical SHA/manifest、generation/fence、原子 current 指针及 stale rollback 保护。
- renderer 输出供固定 Vue shell 消费的结构化快照，不是服务端生成 HTML。

计划外完整真实 migration package 检查因历史迁移测试硬编码已过时的 terminal/dependency 假设而失败，记录为 `NON_BLOCKING_EXTRA_CHECK_FAIL`。计划明确要求的 scoped migration gate 已通过；完整 migration package 的历史测试债务仍需后续处理。

## 浏览器证据边界

浏览器证据沿用 Task 12 的 Playwright `page.route` 合成矩阵：12/12 场景、234/234 断言、32 条脱敏请求、0 unexpected console error、0 page error。该证据没有启动真实后端，不能标记为真实 Root 联合验收。

真实 Root 浏览器 CRUD、RBAC、预览、校验、发布、历史、恢复及浏览器层事务仍为 `NOT_RUN`。P08 生产内容真实性标准继续为 `BLOCKED_PRODUCT`；`web-012` 保持 `in_progress / PASS_LIMITED_SCOPE`。

## 清理与运行边界

- MySQL 容器 `230609b618dde469fdf1093ed109c747d9989f41fd91b4e5bc3f432f702ba3c0` 与 Redis 容器 `4156fde30229cb2372c2a8376b608a678b4e952d6a1cf0b6f28af16f0c38f00e` 已按完整 ID 精确删除。
- 两个容器名称均不存在；52179/54737 已关闭；私有凭据文件已不存在。
- external scheduler/systemd、生产 volume mount、前端 artifact reader 为 `NOT_RUN`。
- 生产 migration、deploy、真实内容 publication、public HTTPS 和生产验收为 `NOT_RUN`。
- 本轮未 push、创建 PR、merge 或 deploy。

Task 13 的 review baseline/final snapshot 及有序审查链尚未生成。后续任何受审文件变化都会废止旧 snapshot，并要求从 Spec Review 重新开始。
