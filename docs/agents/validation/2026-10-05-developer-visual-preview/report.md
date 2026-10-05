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
