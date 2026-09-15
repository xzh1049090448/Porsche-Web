# Fixed Home Structured Content — Task12 前端本地验收报告

日期：2026-09-16
被测基线：`71d66d7f3916870c35defa84e30f0c38e0e826f9`
总体结论：`FAIL_LOCAL_GATE`
已通过的限定范围：`PASS_LIMITED_SCOPE`

## 结论

新增 Task12 合同反例与合成浏览器矩阵均通过，未从这些反例中发现新的生产代码缺陷。完整本地门禁尚未通过：`npm test` 在 180 秒预算耗尽后被中断，已观测到 1124 项通过、4 项失败、1 项取消；公共 chunk checker 也因旧 allowlist 拒绝 Task9 已引入的公共首页 store 而失败。失败均位于本任务不可写的测试或检查器范围，协调者已将其归类为陈旧门禁，后续须在独立 scope 修复并重跑。

`web-012` 保持 `in_progress`。本报告没有把生产 build、合成 fixture 或匿名路由检查当作真实后端、Root 管理闭环或生产验收。

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

## 完整门禁

- `VITE_USE_MOCK=false npm run build`：PASS，只有既有 Vite/Rollup 警告。
- `npm test`（显式注入 A03/A05/A06/A08/A14/PublicPricing 六份后端合同）：TIMEOUT_WITH_FAILURES。预算耗尽时为 1129 tests、1124 pass、4 fail、1 cancelled、0 skip、exit 1。
- 失败项：platform generation 合同 hash 旧值、visual shell 旧动态 Footer 断言、full-site typography 对旧 dialog 和旧 PublicContentAdmin 模板的两条断言。被中断项为完整 typography 合同。
- `node scripts/check-public-route-chunks.mjs`：FAIL；旧 allowlist 未允许 Task9 的 `src/stores/publicHomeContent.js`。本 Task12 禁止修改检查器。

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

1. 在独立 scope 修复陈旧测试与 chunk checker，再重跑完整门禁。
2. Task13 使用真实 MySQL、RBAC、事务和真实 Root 会话完成联合验收。
3. P08 生产内容真实性标准保持 `BLOCKED_PRODUCT`。

机器结果见 `results.json`，浏览器逐场景结果见 `browser-results.json`，原始门禁摘要见 `gates.txt`。
