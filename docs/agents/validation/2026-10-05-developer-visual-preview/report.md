# AiPortCloud 开发者视觉预览交接

状态：DONE_WITH_CONCERNS / 本地视觉交付，非联合业务验收。

## 仓库与预览

- 原仓库 `/Users/xuzhihao/code/Porsche-Web`；未向该目录写入。原 main 和 `.worktrees/billing-pricing-260915` 保留。
- 隔离独立 clone `/Users/xuzhihao/Documents/Codex/2026-10-05/task-2/porsche-web-preview`。
- 分支 `design/home-developer-preview-20261005`，基线 `44feb1d`。
- 本机预览 `http://127.0.0.1:5188/`，仅127.0.0.1监听；保留单个Vite进程。
- 启动方式 `VITE_USE_MOCK=false npm run dev -- --host 127.0.0.1 --port 5188 --strictPort`；标准 `./init.sh` 已跑过。

## 实现范围

首页是公开产品理解与接入路径的交汇点，可在不干扰并行计费工作时展示改版价值。保留真实发布内容及错误边界，重排首屏视觉、代码格式示意、优势和价格→密钥→用量三步指引。示意为静态文字，无真实密钥、调用或虚构数据。

按用户确认的后续方向扩展共享颜色、卡片和组件：浅色白灰背景/深灰文字/绿色操作；深色近黑背景/浅色文字/绿色操作。共享语义token覆盖公共价格/详情、文档、认证、控制台聊天/密钥/套餐用量/个人页，管理页面仅继承共享样式。字体采用现有14px正文、16px副标题、44/34px首页标题等规范。主题配对保证淡绿色深色按钮使用深色字。

首页无偏好时默认浅色，已有 light/dark 与显式 system 偏好保留；不写入新的默认偏好。登录/注册增加aria-label、正确autocomplete与返回首页；API密钥添加模型价格和套餐用量真实路由快捷入口。认证、计费、金额、API请求脚本没有改变。

## 验证

- 全量 `npm test`：1226/1226 PASS，0 fail/skip/cancel；显式注入六份现有权威后端合同。见 full-tests.log。
- 最后一轮三个深色primary变体调整后，主题与布局27/27 PASS、0 skip；production build PASS，5.92秒。见 final-theme-tests.log、build.log。
- 首页主题、公共chunk、全站字号30项 PASS、0 skip。见 typography-home-tests.log。
- `git diff --check` PASS；项目没有lint/typecheck命令，未宣称其通过。
- 用户Mac的Codex内置浏览器实际查看1280×900桌面浅/深色和390×844手机zh/en；首页手机clientWidth=scrollWidth=375（15px滚动条），标题34px，主CTA48px，桌面标题44px且opacity=1。
- 手机菜单展开/Escape关闭；价格error→Retry→loading→error，筛选抽屉/Escape返回焦点，手机价格页无横向溢出。
- `/api-keys`→`/login?redirect=/api-keys`；网络恢复错误页安全禁用提交，登录字段有标签/autocomplete；注册空提交显示用户名和密码必填错误，深色正常，无凭证输入或账号创建。
- Mac浏览器预览标记保留，临时viewport已恢复。

## 截图

截图都来自用户Mac内置浏览器，保存在任务目录且已进入用户Library：

| 文件 | file_id | library_file_id |
| --- | --- | --- |
| aiportcloud-home-light.png | file_000000009f9c81f59a102d379056a0ad | libfile_11b336e75fd48191bb565b2f33942a30 |
| aiportcloud-home-dark.png | file_00000000605c81f5a88125c6e62c5743 | libfile_b42be7b71c28819198e837cbf0fa016f |
| aiportcloud-home-mobile-light.png | file_00000000c91c81f5bfffd67d92ffcd6a | libfile_80f902cabbfc8191801d6487247c4704 |
| aiportcloud-home-mobile-dark.png | file_0000000067f481f59c9398287729bf47 | libfile_711e733797f08191a9a7837e2a43a95a |

其他局部证据同目录：aiportcloud-pricing-mobile-error.png、aiportcloud-login-mobile-error.png、aiportcloud-register-mobile-dark.png。旧aiportcloud-home-desktop.png为被替代版本，请勿作为最终效果。

## 待验及风险

- 本地无已配置后端/账号会话。价格成功数据、登录成功、控制台真实列表/余额/充值、支付、用量端到端均NOT_RUN；单元/组件合同回归不替代这些验证。
- 仓库要求独立规格和质量角色签收，本次未获得可追溯独立审查，保持PENDING，不标整个产品passing。
- 两项已知UI问题已在本地收尾，见下文；不需要用户输入或远端Tawk权限。
- 生产构建仍有既有Billing/ElementPlus等大chunk警告；公共闭包检查通过，无性能数字承诺。
- 未push、merge、deploy，未改真实计费数据、发起支付、增加外部权限或使用Harness测试脚本。


## 用户授权的UI收尾

- `#models` 在loading/hidden/ready-empty/推荐未就绪时有稳定说明区、可聚焦标题和完整目录链接；已发布模型存在时仍使用原模型墙，始终唯一ID。无API契约或发布内容变更。
- 回归使用真实Vue挂载验证五种状态，先RED（loading目标数量0），后GREEN；未削弱既有固定首页、动态安全、内容发布隔离的断言。
- 本地CSS仅在<=767px隐藏独立装饰`div#chat-bubble`（且要求直接包含Chat widget iframe）；真实min-widget按钮与max-widget会话frame、桌面装饰保留，Tawk embed和账户配置不变。官方customStyle仅提供zIndex，因此不假设其它配置项：[Tawk JavaScript API](https://developer.tawk.to/jsapi/)。样式依赖当前第三方容器结构，Tawk升级时需复验。
- 用户Mac浏览器390px实际验证：grabber display:none，launcher display:block/64×60，展开会话frame display:block（290×520）、收起display:none。该Mac内置浏览器第三方srcdoc会话内容为空，因此只宣称窗口切换保留；消息发送及客服会话成功态NOT_RUN，未发送任何消息。
- 模型导航后标题top80.89px高于header底部56px，focus=model-fallback-title；浅色按钮rgb255,255,255字/rgb18,107,86背景，深色rgb16,39,39字/rgb137,230,202背景。手机clientWidth=scrollWidth=375。顺带修复始终深色页脚中的链接前景为浅灰，避免浅色主题的灰字低对比。
- 最终影响回归58/58，0 fail/skip；final production build5.50秒PASS；diff-check PASS，见ui-polish-tests.log、ui-polish-build.log。上文1226项全量回归为前一共享样式阶段证据，未把它冒称为新增回归后的1227项全量结果。
- 手机浅/深色截图更新到原Library文件版本1。模型空态截图aiportcloud-models-fallback-mobile.png：file_000000000a0481fb92a75c06be936bd6 / libfile_baf71fbbd5048191b0cb6b16162dcde1。
- 真正待验是本地后端成功会话和独立审查；当前UI收尾不需要向用户请求其它输入或账号权限。

## 登录与注册标题去重补充

用户Mac浏览器实见现有logo已经包含品牌字标。保留logo，增加AiPortCloud可访问名称；独立h1分别改为本地化“登录”和“注册账号”。未改认证逻辑。相关25/25测试通过、生产构建6.37s通过；390手机注册页heading与alt已核对，无横向溢出。提交后新快照审查，旧候选审核不适用。后台成功登录仍NOT_RUN。


## 2026-10-05 最终资源加载与依赖窄修（独立审查待签，性能 FAIL）

用户明确授权将包含登录页修复的提交推送到 PR #11，仅独立 Spec/Quality 均通过后合并 main，不部署；另授权最小兼容依赖安全修复与前端资源加载优化。原目录和计费工作树不写入。

- axios 1.19.0→1.20.0、DOMPurify 3.4.14→3.4.16、间接 brace-expansion 2.1.4→2.1.7；未运行安装生命周期脚本。最终 npm audit 为 0 critical/high/low、1 moderate（ECharts 5.6.0），因此 audit exit 1，不能宣称零告警。
- ECharts GHSA-fgmj-fm8m-jvvx 的已知触发组合是 `type: 'lines'`、tooltip、无自定义 formatter、未转义 data name。当前 analytics 只固定 line/bar/pie（line 不等于 lines），相关 formatter 转义已有测试；当前路径未匹配该组合。6.1.0 为主要版本，官方迁移指南说明主题/布局/轴等默认行为变化，本轮没有扩大为大版本迁移。剩余 moderate 提交独立质量审查判断，不抹去告警。
- 登录/注册按需注册实际使用的 Element Plus 组件，控制台完整组件/图标/样式仅在既有认证守卫允许的 requiresAuth 路由 beforeResolve 阶段加载。guest 和 console 并发加载去重；错误传给既有恢复/安全错误页。没有改守卫决策、认证请求/票据/余额或支付。request.js 仅 ElMessage 的 UI 模块导入路径调整。
- 首次 mount 等 router.isReady，避免初始路由 enter 透明过渡造成浏览器没有有效 LCP 候选；后续路由动画保留。按真实主题预加载对应 logo。构建期仅 /login 或 /register 的静态依赖生成 modulepreload/CSS preload，下载/编译不执行模块；公开/控制台其他路径不添加 guest 提示。
- 手机同时隐藏实际 Tawk chat-bubble/message-preview 装饰 iframe 容器；真实 min-widget/max-widget 和桌面装饰保留。真实编译 Sass + DOM 回归验证选择器，不修改远端客服配置。

### 最终检查与性能证据

全量 npm test **1245/1245 PASS，0 fail/skip/cancel/todo，70.45 秒**，六份权威后端合同显式注入；最终 production build PASS（5.57 秒），public graph checker PASS。git diff --check PASS。无 lint/typecheck 命令，不宣称其通过。外部原始日志位于任务目录最终审查包中，不把新性能日志混入旧完整测试证据。

生产 preview 127.0.0.1:5189，用户 Mac 已安装 Chrome、Lighthouse 13.5.0 的独立冷 profile，每 URL 三次有效样本；390×844/DPR1、CPU4倍、下行 **1.6Mbps=200000B/s**、上行 **750kbps=93750B/s**、延迟150ms。保留真实第三方加载。不是物理手机/线上站点测量。Vite preview 原本自动压缩资源，未改变 gzip 条件；此前“未压缩”的口头诊断已纠正。

| 页面 | LCP 三次中位 | 约定 <2000ms | ready 后菜单中位 | <200ms |
| --- | ---: | --- | ---: | --- |
| 首页 / | 1884.467ms | PASS | 26.9ms | PASS |
| 登录 /login | 2671.333ms | **FAIL** | N/A | N/A |
| 价格 /pricing（真实本地错误态） | 1814.555ms | PASS | 25.8ms | PASS |

菜单计时为 pointerdown→菜单可见后下一 RAF；同 profile 的第二次 ready 页面交互，可缓存资源，不能称 INP 或冷导航菜单性能。九次 LCP 样本均有效；更早 NO_FCP/NO_LCP 样本仅诊断记录，未选样冒称通过。有效上一轮登录中位3158.577ms→最终2671.333ms，改善约15.4%，仍未达门槛。

login-2 原始 LHR：品牌图片920.295ms下载完成；既有 beforeEach await ensureSession 与初始 router.isReady 使认证恢复在渲染关键路径。/api/v1/auth/refresh 2169.562→2330.397ms 返回本地500，约160.835ms；Login CSS确认到2511.253ms，图片实际 LCP2668.093ms，element render delay1747.181ms。不可达后端等待确有贡献，但不足单独解释超出2秒的差距；不能承诺真实后端可自动达标。不继续扩大架构或自行放宽门槛。

用户 Mac 内置浏览器最终 production 页面实看390手机：英文深色 Sign in、品牌alt、用户名/密码aria-label及autocomplete、宽度scrollWidth=clientWidth=390；注册空表单返回真实用户名/密码必填反馈；/api-keys 安全转向 /login?redirect=/api-keys，未决认证禁用提交；公共菜单展开/Escape返回按钮焦点。桌面与价格重试最终复核记录随外部审查包。真实后台成功态、真实账号/支付/密钥/客服消息及部署均 NOT_RUN。

此候选尚须新快照 Spec 后 Quality；eec9c09 的旧审查不适用于新增代码。登录性能 FAIL 是明确合并门禁，用户没有放宽门槛前不签 PASS、不合并。允许保存及推送 PR 供审阅；禁止部署。

最终 Mac production 桌面复核：1280×900，Sign in h1/品牌alt正常，auth-page opacity=1，scrollWidth=clientWidth=1280。价格 Retry 后仍返回真实本地错误提示；手机公共菜单 Escape 聚焦 Menu。新截图任务目录 aiportcloud-final-login-desktop.png 与 aiportcloud-final-login-mobile.png。
