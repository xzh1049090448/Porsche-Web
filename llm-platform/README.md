# 国内大模型聚合平台 · 用户端前端

基于 **Vue 3 + Vite + Element Plus + Pinia** 实现的 C 端用户界面，对应需求文档 **2.1 用户端功能**（不含管理后台 2.2）。

## 功能清单

| 模块 | 功能 |
|------|------|
| 登录 | 手机号验证码登录、账号密码登录 |
| 模型面板 | 8 大国内模型切换、温度/Token/上下文参数、多模型对比 |
| 专属数据集 | 通用/跨境数据集开关、4 类子数据集多选、回答专属标识 |
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

访问 http://localhost:5173

### 演示账号

- **验证码登录**：任意 11 位手机号 + 验证码 `123456`
- **密码登录**：任意账号 + 密码 `demo123`

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
├── constants/     # 模型、数据集、套餐配置
├── layouts/
├── router/
├── stores/
├── utils/
└── views/         # Login / Chat / Profile / Billing
```

## 后端对接（ai-gateway）

| 模块 | 路径前缀 | 说明 |
|------|----------|------|
| 认证 | `/api/v1/auth` | `send-code`、`login/code`、`login/password` |
| 用户 | `/api/v1/users` | `me`、`me/password`、`me/verify`、`me/usage` |
| 平台对话 | `/api/v1/platform` | `models`、`chat/completions`（SSE）、`chat/compare` |
| 对话历史 | `/api/v1/conversations` | CRUD、`export/markdown` |
| 数据集 | `/api/v1/datasets` | 列表（子库 ID 为整数） |
| 计费 | `/api/v1/billing` | `plans`、`orders`、`orders/{id}/pay`、`invoice` |

鉴权：`Authorization: Bearer {access_token}`

前端实现见 `src/api/`，字段映射见 `src/utils/api-mapper.js`。
