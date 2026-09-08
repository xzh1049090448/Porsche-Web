# 前端基线闭环报告（2026-09-03）

工作树：`feature/admin-public-260903`，HEAD `25a66a4ad546a481941dfc6e0cc9bc75da2e631b`。

## 历史 guard 误收根因与窄修复

`npm test` 使用 Node 默认递归发现规则，会将 `m3-sse-attempt4-guard-test.cjs` 作为测试加载。该文件实际是命令行 guard，要求 `process.argv[2]` 指向诊断脚本，因此无参数时在 `readFileSync(undefined)` 处失败。

仅将文件改名为 `m3-sse-attempt4-guard.cjs`，避免默认测试发现；文件字节 SHA-256 保持为 `c076cd78baddbfaab9b01ef8c8ccdcc259bd606e8dcfc1b5357810487443259b`，Git blob SHA 保持为 `0f88f4434de378055deb2404472557e76f8ff03e`。guard 原调用仍通过 `wrong_candidate`、`budget_exhausted`、`existing_result` 三个场景。

## 新鲜验证

- `npm test`：退出码 0，`113/113 pass`，`0 fail`。
- `npm run build`：退出码 0，约 6.2 秒；仅有既有 `@vueuse/core` Rollup `#__PURE__` 注释警告。
- `git diff --check`：退出码 0。

`init.sh` 会运行 `npm install` 与构建；本轮实际结果见下节。未改变业务、B1-D 页面、依赖版本或构建配置。

## init.sh 结果

按授权执行 `env -u RUN_START_COMMAND npm_config_offline=true npm_config_audit=false npm_config_fund=false ./init.sh`。在安装阶段因本工作树没有 `package-lock.json`/`node_modules`，且 npm 离线缓存缺少 `@element-plus/icons-vue` registry 响应，退出码 1（`ENOTCACHED`）；未进入 build，未启动 server。`package.json` SHA-256 仍为 `0ef54ff0c99a534ce1b389e2c8f7209ee36f11ae3057f3060b2dc5b19643ab30`，没有生成或修改 `package-lock.json`。

随后使用临时 cache 尝试联网 `npm install`；沙箱内 registry 解析失败（npm verbose：`ENOTFOUND`，涉及 npm registry 与 `@element-plus/icons-vue`）。按规则发起提升权限重试，但工作树仍未生成 `node_modules` 或 `package-lock.json`，因此不能把 init 记为成功，也未伪称锁文件一致。

## 复用本地依赖后的 init 闭环

后续核对确认根 checkout 与当前 `package.json` SHA-256 均为 `0ef54ff0c99a534ce1b389e2c8f7209ee36f11ae3057f3060b2dc5b19643ab30`；当前 worktree 已有 195M `node_modules` 和此前生成的 `package-lock.json`，因此按授权未覆盖现有文件。`env -u RUN_START_COMMAND npm_config_offline=true npm_config_audit=false npm_config_fund=false ./init.sh` 成功完成离线 install/build；npm 报告 4 个包的 install scripts 尚未批准。当前 lock SHA-256 为 `3bd2416355eec0ded6f0346d96f5f8ee5b1ae29fb46b4f541c1429f31eb266b6`，根 checkout lock SHA-256 为 `4c2415cf83eed94c6222f9dd013860ac28ec095e849b2b2b92ce1f879ee3100c`；由于 worktree 原本无 lock，不能称为锁一致，当前生成 lock 保留为未跟踪产物。

上段记录的是中断联网安装阶段的旧状态。随后将该升级 lock 保存为 `/private/tmp/porsche-admin-generated-lock-working-20260904.json`，将升级版 `node_modules` 保存为 `/private/tmp/porsche-admin-generated-node_modules-20260904`，并复制根 checkout 的 lock 与 `node_modules`；当前 lock 与根 lock SHA-256 均为 `4c2415cf83eed94c6222f9dd013860ac28ec095e849b2b2b92ce1f879ee3100c`，164 个 `packages` 条目逐项匹配。

复用根依赖后的离线 `init.sh`、`npm test`（113/113 pass）、`npm run build`（退出码0）及 `git diff --check` 均通过。npm 仍提示4个包的 install scripts 尚未批准。进程清单检查受环境限制（`ps` 返回 operation not permitted，`pgrep` 返回 sysmond service not found），但 init 未设置 `RUN_START_COMMAND`，未启动 dev server。
