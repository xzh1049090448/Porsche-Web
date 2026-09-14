# Home、Pricing 与全站视觉浏览器验收

## 结论与边界

- 结果：`PASS_LOCAL_SYNTHETIC`
- 被测实现提交：`49fa6e672e1644fb68f7cbe02b72f051970a47a7`
- 被测地址：`http://127.0.0.1:4173`
- 启动方式：`VITE_USE_MOCK=false` 的 production build 与 Vite preview
- 浏览器：Playwright Chromium，可见模式
- 语言：`zh-CN`
- 总计：主页/价格页 14 项、路由动效 6 项、功能页 78 项，共 98 项通过
- 异常：意外 console error `0`，page error `0`

本报告证明本地生产构建在合成公开数据和合成 Root 身份下的视觉、动效、焦点、触控与响应式行为。它不构成真实后端、真实账号、公开 HTTPS、部署或生产内容验收。

原始脚本、JSON 与截图仅保存在 `/private/tmp/porsche-web-home-pricing-browser-20260914`，不提交到仓库：

- `home-pricing-results.json`
- `motion-results.json`
- `type-results.json`
- `screenshots/`：12 张主页/价格页截图
- `type-screenshots/`：26 张功能页截图

## 环境矩阵

所有视觉用例覆盖以下组合：

| 视口 | 主题 | 身份 |
| --- | --- | --- |
| 375×812 | light、dark | 公共页匿名；受保护页 synthetic Root |
| 768×1024 | light、dark | 公共页匿名；受保护页 synthetic Root |
| 1440×900 | light、dark | 公共页匿名；受保护页 synthetic Root |

公开数据 fixture 仅包含一条合成已发布模型及合成发布内容。受保护页 fixture 提供 Root 权限目录、单个用户、单个模型、发布草稿、发布历史和一条通知；不包含口令或真实用户资料。每项均断言最终 pathname、query 和页面专属 landmark。

## Home 与 Pricing

主页和价格页在 3 个视口、2 个主题下共 12 项已发布态用例通过；价格页另有移动端合成 loading 和预期 HTTP 503 两项通过。

| 检查 | 观测结果 |
| --- | --- |
| Home 区块顺序 | `hero → proof → advantages → models → announcements-faq → cta` |
| 公共页头 | 56px，明暗主题与三个视口一致 |
| Hero 字号 | 桌面/平板 44px，移动 34px |
| 背景与预览 | 点阵背景、3 个柔和色块、产品预览均存在 |
| 证明与优势 | 3 个证明项；桌面/平板 3 列，移动单列 |
| 模型墙与 CTA | 均存在；模型数据来自合成发布快照 |
| 页脚 | 深色背景；公开导航和 hash 链接存在 |
| 禁止文案 | 未出现原型品牌、假模型数量、许可证或演示凭据文案 |
| Pricing 桌面/平板 | 260px 筛选栏、紧凑工具栏、表格、分页 |
| Pricing 移动 | 筛选抽屉、卡片、分页；表格隐藏 |
| Pricing 字号 | 标题 20px，价格信息 13px |
| Pricing 计价 | 输入/输出 Token 价格与 `USD / 1M tokens` 单位可见 |
| 失败态 | 预期注入 HTTP 503，错误界面通过；未产生意外 console/page error |

## 路由动效、焦点与历史

| 路由类型 | 常规动效 | reduced motion | 最终焦点 | 固定壳层 |
| --- | --- | --- | --- | --- |
| public → public | leave 0.2s、enter 0.35s；总观测 1029ms | 两段均 0.00001s；总观测 268ms | `#public-content` | 页头 1425×56，前后不变 |
| console → console | leave 0.2s、enter 0.35s；总观测 1096ms | 两段均 0.00001s；总观测 247ms | `#console-content` | 顶栏 1440×56、侧栏 240×844，前后不变 |
| guest → console | leave 0.2s、enter 0.35s；总观测 1013ms | 两段均 0.00001s；总观测 166ms | `#console-content` | 进入后壳层稳定 |

过渡属性仅为 `opacity`。public → public 额外通过快速双导航、浏览器后退和前进。同页 `/#advantages` 导航保持原 Home DOM 实例、不触发路由过渡，并在滚动完成后把焦点放到 `#advantages-title`。最终焦点在路由内容节点内，路由进入不会覆盖已经位于目标内容中的焦点。

## 功能页字级、触控和对话框

以下 13 类路由各覆盖 3 个视口和 2 个主题，共 78 项：

| 路由 | 身份 | 最终地址 | 页面标题/组件标题 |
| --- | --- | --- | --- |
| `/login` | anonymous | `/login?redirect=/chat` | 20px |
| `/register` | anonymous | `/register` | 20px |
| `/chat` | synthetic Root | `/chat` | 桌面欢迎标题 20px；≤768px 空状态组件标题 16px |
| `/billing` | synthetic Root | `/billing` | 20px |
| `/api-keys` | synthetic Root | `/api-keys` | 20px |
| `/profile` | synthetic Root | `/profile` | 20px |
| `/users` | synthetic Root | `/users` | 20px |
| `/users/:guid` | synthetic Root | 原 GUID 路径 | 20px |
| `/admin/public-models` | synthetic Root | `?page=1&page_size=20` | 20px |
| `/admin/public-models/:guid` | synthetic Root | 原 GUID 路径 | 20px |
| `/admin/public-pricing` | synthetic Root | 原路径 | 20px |
| `/admin/public-content` | synthetic Root | 原路径 | 20px |
| `/admin/notifications` | synthetic Root | 原路径 | 20px |

正文、表格、表单、按钮与辅助信息保持 11–14px 语义标尺。聊天移动端 textarea 保留 16px，作为防止移动 Safari 聚焦自动缩放的输入特例；桌面为 14px。全部页面无水平视口溢出，Tab 后存在 `:focus-visible`，主要触控目标不低于 44px。

对话框另完成 12 次打开、最终边界和 Escape 关闭检查：

- Element Plus 模型编辑对话框：6 个视口/主题组合。最大观测为 1440×900 下 `760×868`，位置 `x=340, y=16`。
- 原生内容恢复对话框：6 个视口/主题组合。移动端观测为 `342×164.27`，位置 `x=9, y=323.86`。

## 浏览器发现并修复的问题

| 问题 | 修复提交 | 回归证据 |
| --- | --- | --- |
| Pricing 标题错误使用 30px 区块标题 | `645cd83` | Pricing 三视口标题均为 20px |
| 路由进入后无条件抢占已有焦点 | `b2fb807` | 三类路由最终焦点与快速/历史导航通过 |
| Console 壳层高度随页面内容变化 | `dcc6b87` | 顶栏和侧栏前后几何一致 |
| 公共内容发布输入框仅 40px | `dcc6b87` | 78 项功能页触控检查通过 |
| Chat 折叠按钮仅 28×28px | `dcc6b87` | 按钮使用共享 44px 触控尺寸 |
| 桌面模型编辑对话框高度超过视口 | `032a882` | 12 次对话框边界及 Escape 检查通过 |
| 同页 hash 导航重建 Home 且未聚焦目标标题 | `49fa6e6` | 组件实例保持、连续 hash 最新焦点契约及可见 Chromium 回归通过 |

所有浏览器发现的产品缺陷均先由聚焦 RED 测试复现，再修改生产代码并转绿。

## 明确跳过和未证明事项

- `SKIP_LIVE_DATA`：真实公开价格的 empty/ready/published 数据状态未连接；合成 published、loading 和 HTTP 503 不能替代真实数据验收。
- `SKIP_REAL_AUTH`：未使用真实 Root 或普通用户账号；权限测试限于合成 Root fixture。
- `SKIP_P08_OPERATION`：P08 生产内容真实性与审批证据仍未完成，未执行真实发布、恢复或删除；原生恢复对话框仅做无副作用的布局/Escape 检查。
- `SKIP_EMAIL`：邮件推送仍是后续待办。
- `SKIP_LIVE_DEPLOYMENT`：未执行部署、数据库迁移、公开 HTTPS、CDN 或线上回归。
- `SKIP_REAL_BACKEND`：未对真实后端、上游白牌模型或定时价格检测执行端到端验证。

以上跳过项不影响本地合成视觉矩阵的 `PASS_LOCAL_SYNTHETIC`，但在对应真实环境证据补齐前不得提升为生产验收通过。
