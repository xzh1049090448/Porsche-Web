# Fixed Home Structured Content — Task12 前端本地验收报告

日期：2026-09-16
门禁修复基线：`4f6a2e157cc9666921f9f250e144571f700a98eb`
实现候选：`71d66d7f3916870c35defa84e30f0c38e0e826f9`
总体结论：`PASS_LIMITED_SCOPE`

## 结论

新增 Task12 合同反例与合成浏览器矩阵均通过，未从这些反例中发现新的生产代码缺陷。独立 gate-repair scope 已修正陈旧测试和公共 chunk allowlist；完整 `npm test` 1137/1137 通过，0 fail、0 cancelled、0 skip，生产构建和真实 chunk checker 均通过。

`web-012` 保持 `in_progress`。当前结论限于本地前端与合成浏览器证据；生产 build、合成 fixture 和匿名路由检查不代表真实后端、Root 管理闭环或生产验收。

## TDD 反例

在 `git archive` 生成的 `/private/tmp/porsche-fixed-home-task12-mutations` 私有副本中执行 9 个 mutation；每项都按预期以 exit 1 进入 RED，原工作树未受污染：

- public DTO 草稿 Markdown 泄漏
- Home 重新引入 legacy `getHome`/public document
- Header/Footer 重新接受发布导航
- Home 在 503 时显示整页错误卡
- 390px 水平溢出
- reduced-motion 仍播放动画
- Root 降级后迟到响应回填
- public typography 使用 `zoom`
- public typography 使用 `scale`

原实现定向 GREEN：公共页面和 chunk 合同 27/27；响应式宽度与 zoom/scale 两项 2/2。宽度合同明确包含 375、390、767、768、1280、1440、1600。

陈旧门禁的修复后定向结果：platform generation 6/6、visual shell 13/13、full-site typography 9/9、public chunks 13/13；完整 typography 8/8，用时 48.754 秒。优化只缓存与宽度无关的选择器匹配和 specificity 计算，七个宽度、zoom/scale、真实字号及 44px 控件断言仍完整执行。

## 完整门禁

- `npm test`（显式注入 A03/A05/A06/A08/A14/PublicPricing 六份后端合同）：1137 tests、1137 pass、0 fail、0 cancelled、0 skip、0 todo，56.368 秒，exit 0。
- `VITE_USE_MOCK=false npm run build`：PASS，只有既有 Vite/Rollup 非阻塞警告。
- `node scripts/check-public-route-chunks.mjs`：PASS，公共闭包 9 chunks、171480 JS bytes、20362 CSS bytes。
- platform generation 测试同时固定 v2、结构化 home-config 字段和当前批准合同 hash；Footer 测试反向证明固定导航不读取发布链接；native dialog 测试直接验证 `dialog > #restore-title`。

## 可见浏览器验收

使用 playwright-skill 的可见 Chromium，production preview 位于 `127.0.0.1:4173`。API 通过 `page.route` 提供确定性合成响应，未启动真实 `127.0.0.1:8000` 后端 fixture；这是相对原计划的明确偏差。

- 公共 ready/503：11/11 PASS。
- 视口：375、390、768、1280、1600；light/dark 代表场景；390/1280 中英文。
- 验证固定 Hero/proof/advantages/CTA、结构化公告/FAQ/精选模型、同代价格版本与单次详情请求。
- 503 只隐藏动态区块，固定主体立即存在，不显示“暂时无法显示内容”。
- 无水平溢出；390px 可见控件达到 44px；移动菜单首项聚焦、Escape 关闭并恢复触发器；reduced-motion 生效。
- 匿名访问 `/admin/public-content`：1/1 PASS，跳转 `/login?redirect=/admin/public-content`，编辑器不可见。

已认证 Root CRUD、预览、校验、发布、历史和恢复没有在本轮浏览器中执行，状态为 `NOT_RUN`。截图只包含公开合成文案，不含凭据、token、ticket、密码或业务数据。

## 后续边界

1. Task13 使用真实 MySQL、RBAC、事务和真实 Root 会话完成联合验收。
2. P08 生产内容真实性标准保持 `BLOCKED_PRODUCT`。

机器结果见 `results.json`，浏览器逐场景结果见 `browser-results.json`，原始门禁摘要见 `gates.txt`。
