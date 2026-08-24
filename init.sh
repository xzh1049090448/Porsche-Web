#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

# Porsche-Web 前端仓库：Vue 3 + Vite 大模型聚合平台用户端
echo "==> 当前目录: $PWD"

INSTALL_CMD=(npm install)
# 项目暂无单测脚本，用生产构建作为基础验证
VERIFY_CMD=(npm run build)
START_CMD=(npm run dev)

echo "==> 同步依赖"
"${INSTALL_CMD[@]}"

echo "==> 运行基础验证"
"${VERIFY_CMD[@]}"

echo "==> 启动命令"
printf '    %q' "${START_CMD[@]}"
printf '\n'

if [ "${RUN_START_COMMAND:-0}" = "1" ]; then
  echo "==> 启动应用"
  exec "${START_CMD[@]}"
fi

echo "如果希望 init.sh 直接启动应用，请设置 RUN_START_COMMAND=1。"
