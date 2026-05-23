# Porsche-Web

本仓库包含两个独立前端项目，按目录分级存放：

```
Porsche-Web/
├── blog/              # 原博客示例（原生 HTML/CSS/JS）
└── llm-platform/      # 国内大模型聚合平台用户端（Vue 3）
```

## blog — 博客示例

轻量级博客前端，对接 `http://localhost:3000/api`。

详见 [blog/README.md](./blog/README.md)

```bash
cd blog
# 使用静态服务器打开，例如：
npx serve .
```

## llm-platform — 大模型聚合平台

Vue 3 + Element Plus 实现的 C 端界面（登录、对话、模型/数据集、套餐计费等）。

详见 [llm-platform/README.md](./llm-platform/README.md)

```bash
cd llm-platform
npm install
npm run dev
```

访问 http://localhost:5173
