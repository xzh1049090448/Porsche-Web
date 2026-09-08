# 国内大模型聚合平台 · 用户端前端

基于 **Vue 3 + Vite + Element Plus + Pinia** 实现的 C 端用户界面，对应需求文档 **2.1 用户端功能**（不含管理后台 2.2）。

## 功能清单

| 模块 | 功能 |
|------|------|
| 登录 | 用户名注册/登录、会话刷新、注销和设备管理 |
| 模型面板 | 由后端授权目录动态提供的模型切换、温度/Token/上下文参数、多模型对比 |
| 对话 | 流式打字机效果、多轮对话、历史命名/删除、复制、Markdown/PDF 导出、图片上传（多模态模型） |
| 个人中心 | 资料修改、密码修改、实名认证、用量概览 |
| 套餐计费 | 三档套餐、用量统计、充值、订单、发票申请 |

## 快速开始

```bash
# 在本目录下执行（需 Node.js 18+）
npm install          # 必须先执行，且不要加 --omit=dev / --production
npm run dev
npm run build        # 产物在 dist/
```

若出现 `vite: not found`，说明未安装开发依赖，请重新执行：

```bash
rm -rf node_modules package-lock.json
npm install
npm run build
```

生产构建会先读取 `.env.production` 和 `.env.production.local`，并以当前进程环境变量为最高优先级。`VITE_USE_MOCK` 必须明确设置为 `false`，否则构建会在 Vite 启动前失败，避免发布 Mock 数据模式。

访问 http://localhost:5173

### 认证与开发验证

本分支以最新后端 `0bab2b7` 核对用户名与可撤销会话协议（与 `90abbdc` 公开接口兼容），契约见 [interface-contract.json](interface-contract.json)。注册成功后仍需登录；没有可用于正式接口的通用演示账号。

Access Token 仅在内存，Refresh Cookie 由后端以 HttpOnly/Secure/SameSite=Lax 设置。认证需要浏览器 Web Locks、跨标签通知和可写的非敏感协调存储；能力不足时停止认证并提示。用户名、密码、Token、SID 和用户资料不写入协调存储。

本地 `npm run dev` + 拦截 API 的浏览器测试只验证客户端行为，不能代替真实 Cookie 验收。真实联调必须使用已授权的同源 HTTPS 环境、正确 Origin 与专用测试账号；不要将 localhost 直接跨站调用正式域名当成 Cookie 联调方案，不应放宽 Cookie 或伪造 Origin。

认证请求结果不确定时，界面区分本地退出与服务端注销确认；刷新页面不会自动解除未知状态。不要手工删除协调标记来绕过保护，应按提示确认其他标签/未知请求状态并在授权测试环境复核。

## 环境变量

复制 `.env.example` 为 `.env`：

```env
VITE_API_BASE=
VITE_USE_MOCK=false
```

`vite.config.js` 已将 `/api` 代理到 `http://localhost:8000`（ai-gateway 默认端口）。本地无后端时可设 `VITE_USE_MOCK=true`。

## 目录结构

```
src/
├── api/           # 接口与 Mock
├── components/chat/
├── constants/     # 场景与套餐配置
├── layouts/
├── router/
├── stores/
├── utils/
└── views/         # Login / Chat / Profile / Billing
```

## 后端对接（ai-gateway）

| 模块 | 路径前缀 | 说明 |
|------|----------|------|
| 认证 | `/api/v1/auth` | `register`、`login`、`refresh`、`logout`、`self`、`sessions`、`self/password` |
| 用户 | `/api/v1/users` | `me`、`me/usage`；改密走 `/auth/self/password`，实名走 `/auth/self/verify` |
| 平台对话 | `/api/v1/platform` | `models`、`chat/completions`（SSE）、`chat/compare` |
| 对话历史 | `/api/v1/conversations` | GUID CRUD、`export/markdown`；删除为逻辑删除，见 [docs/conversation-delete-api.md](./docs/conversation-delete-api.md) |
| 计费 | `/api/v1/billing` | `plans`、`orders`、`orders/{guid}/pay`、`invoice` |

鉴权：短期内存 `Authorization: Bearer {access_token}`；Refresh/logout 按契约携带浏览器 Cookie 与可信 Origin。

前端实现见 `src/api/`，字段映射见 `src/utils/platform-mappers.js`。所有业务资源标识均使用不经数值转换的字符串 GUID。
