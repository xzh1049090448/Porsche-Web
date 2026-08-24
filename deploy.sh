#!/usr/bin/env bash
#
# 一键部署脚本 —— 国内大模型聚合平台（用户端前端）
#
# 流程：拉取 main 最新代码 → 安装依赖 → 生产构建 → 部署静态产物 → 生成/更新 nginx 配置 → 重载
#
# 用法：
#   sudo ./deploy.sh                       # 用默认配置部署
#   sudo SERVER_NAME=llm.example.com \
#        BACKEND_URL=http://127.0.0.1:8000 \
#        DEPLOY_DIR=/var/www/porsche-web \
#        ./deploy.sh                       # 自定义配置
#
# 可配置环境变量（均有默认值）：
#   BRANCH        git 分支，默认 main
#   DEPLOY_DIR    静态产物部署目录，默认 /var/www/porsche-web
#   BACKEND_URL   ai-gateway 后端地址，默认 http://127.0.0.1:8000
#   SERVER_NAME   nginx server_name，默认 _（匹配所有域名/IP）
#   NGINX_PORT    nginx 监听端口，默认 80
#   SKIP_NGINX    设为 1 则跳过 nginx 配置（仅部署静态文件）
#   ENV_FILE      生产环境 .env 路径，默认 .env.production（不存在则不覆盖）
#
set -euo pipefail

# ───────────────────────────────────────────────────────────
# 配置区
# ───────────────────────────────────────────────────────────
BRANCH="${BRANCH:-main}"
DEPLOY_DIR="${DEPLOY_DIR:-/var/www/porsche-web}"
BACKEND_URL="${BACKEND_URL:-http://127.0.0.1:8000}"
SERVER_NAME="${SERVER_NAME:-_}"
NGINX_PORT="${NGINX_PORT:-80}"
SKIP_NGINX="${SKIP_NGINX:-0}"
ENV_FILE="${ENV_FILE:-.env.production}"
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP_DIR="${DEPLOY_DIR}.prev"
NGINX_SITE_CONF="/etc/nginx/sites-available/porsche-web.conf"
NGINX_ENABLED_LINK="/etc/nginx/sites-enabled/porsche-web.conf"
LOCK_FILE="/tmp/porsche-web-deploy.lock"

# ───────────────────────────────────────────────────────────
# 日志与工具函数
# ───────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
log()  { echo -e "${GREEN}[deploy]${NC} $*"; }
info() { echo -e "${BLUE}[info]${NC}   $*"; }
warn() { echo -e "${YELLOW}[warn]${NC}  $*"; }
err()  { echo -e "${RED}[error]${NC} $*" >&2; }

cleanup() {
  rc=$?
  rm -f "${LOCK_FILE}"
  if [ $rc -ne 0 ]; then
    err "部署失败（exit $rc）。"
    if [ -d "${BACKUP_DIR}" ]; then
      warn "正在回滚到上一版本（${BACKUP_DIR} → ${DEPLOY_DIR}）..."
      rm -rf "${DEPLOY_DIR}"
      mv "${BACKUP_DIR}" "${DEPLOY_DIR}"
      log "已回滚到上一版本。"
    fi
    err "请检查上方日志后重试。"
  fi
  exit $rc
}
trap cleanup EXIT

# ───────────────────────────────────────────────────────────
# 阶段 0：前置检查
# ───────────────────────────────────────────────────────────
log "阶段 0/6 · 前置检查"

# 防止并发部署
if [ -f "${LOCK_FILE}" ]; then
  err "检测到部署锁文件 ${LOCK_FILE}，可能上一次部署未完成。"
  err "确认无冲突后执行：rm -f ${LOCK_FILE}"
  exit 1
fi
echo $$ > "${LOCK_FILE}"

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    err "缺少依赖：$1（$2）"
    exit 1
  fi
}

need_cmd git      "版本控制"
need_cmd node     "运行时（需 Node.js 18+）"
need_cmd npm      "包管理"
need_cmd rsync    "同步部署产物"

# Node 版本检查
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "${NODE_MAJOR}" -lt 18 ]; then
  err "Node.js 版本过低（$(node -v)），需 18+。"
  exit 1
fi
info "Node $(node -v) · npm $(npm -v) · 分支 ${BRANCH}"

# 需要 root（写 /var/www 与 /etc/nginx，且 nginx -t 需访问 /var/log/nginx、/run/nginx.pid）
if [ "$(id -u)" -ne 0 ]; then
  err "部署需要 root 权限（写入 ${DEPLOY_DIR} 与 nginx 配置）。"
  err "请用 sudo 执行，或通过 DEPLOY_DIR 指定用户可写目录。"
  exit 1
fi

if [ "${SKIP_NGINX}" != "1" ]; then
  need_cmd nginx "Web 服务器"
  if ! nginx -t >/dev/null 2>&1; then
    err "nginx 配置自检失败，请先修复 nginx。"
    err "可运行 sudo nginx -t 查看详细信息。"
    exit 1
  fi
fi

info "前置检查通过。"

# ───────────────────────────────────────────────────────────
# 阶段 1：拉取 main 最新代码
# ───────────────────────────────────────────────────────────
log "阶段 1/6 · 拉取 ${BRANCH} 最新代码"
cd "${REPO_DIR}"

# 确保在 git 仓库内
if [ ! -d .git ]; then
  err "当前目录 ${REPO_DIR} 不是 git 仓库。"
  exit 1
fi

# 拒绝在脏工作树上部署（未提交改动可能导致构建不一致）
if [ -n "$(git status --porcelain)" ]; then
  warn "工作树有未提交改动："
  git status --short
  warn "这些改动不会被部署。若需要部署它们，请先 commit；若可忽略，继续。"
  read -r -p "$(echo -e ${YELLOW}继续部署将丢弃本地改动并强制拉取？[y/N] ${NC})" ans
  case "${ans:-N}" in
    y|Y|yes) git checkout -- . ;;
    *) err "已取消。"; exit 1 ;;
  esac
fi

git fetch origin
git checkout "${BRANCH}"
git reset --hard "origin/${BRANCH}"
info "当前 HEAD：$(git rev-parse --short HEAD) · $(git log -1 --format='%s')"

# ───────────────────────────────────────────────────────────
# 阶段 2：安装依赖
# ───────────────────────────────────────────────────────────
log "阶段 2/6 · 安装依赖"
info "清理旧的 node_modules 与 lock（确保干净安装）..."
rm -rf node_modules package-lock.json
npm install --no-audit --no-fund
info "依赖安装完成。"

# ───────────────────────────────────────────────────────────
# 阶段 3：生产构建
# ───────────────────────────────────────────────────────────
log "阶段 3/6 · 生产构建"

# 注入生产环境变量（.env.production 优先；否则用 .env.example 兜底）
if [ -f "${ENV_FILE}" ]; then
  info "使用 ${ENV_FILE} 作为构建环境变量。"
  cp "${ENV_FILE}" .env
elif [ -f .env.example ]; then
  warn "未找到 ${ENV_FILE}，使用 .env.example 兜底。"
  warn "生产环境建议创建 ${ENV_FILE} 指定 VITE_API_BASE 与 VITE_USE_MOCK=false。"
  cp .env.example .env
fi

npm run build

if [ ! -d dist ]; then
  err "构建产物 dist/ 不存在，构建失败。"
  exit 1
fi
info "构建完成，产物大小：$(du -sh dist | cut -f1)"

# ───────────────────────────────────────────────────────────
# 阶段 4：部署静态产物（带备份与原子切换）
# ───────────────────────────────────────────────────────────
log "阶段 4/6 · 部署静态产物到 ${DEPLOY_DIR}"

# 备份上一版本（用于失败回滚）
rm -rf "${BACKUP_DIR}"
if [ -d "${DEPLOY_DIR}" ]; then
  mv "${DEPLOY_DIR}" "${BACKUP_DIR}"
  info "已备份旧版本到 ${BACKUP_DIR}"
fi

# 原子切换：先同步到临时目录，再 rename
TMP_DIR="${DEPLOY_DIR}.new"
rm -rf "${TMP_DIR}"
mkdir -p "${TMP_DIR}"
rsync -a --delete --exclude='.gitignore' dist/ "${TMP_DIR}/"
mv "${TMP_DIR}" "${DEPLOY_DIR}"
info "静态产物已部署到 ${DEPLOY_DIR}"

# 部署成功后清理备份
rm -rf "${BACKUP_DIR}"

if [ "${SKIP_NGINX}" = "1" ]; then
  log "SKIP_NGINX=1，已跳过 nginx 配置。"
  log "部署完成。请自行配置 Web 服务器将根目录指向 ${DEPLOY_DIR}。"
  exit 0
fi

# ───────────────────────────────────────────────────────────
# 阶段 5：生成 / 更新 nginx 配置
# ───────────────────────────────────────────────────────────
log "阶段 5/6 · 配置 nginx（${SERVER_NAME} :${NGINX_PORT} → ${BACKEND_URL}）"

mkdir -p /etc/nginx/sites-available /etc/nginx/sites-enabled

cat > "${NGINX_SITE_CONF}" <<EOF
# 由 deploy.sh 自动生成 —— 国内大模型聚合平台（用户端前端）
server {
    listen ${NGINX_PORT};
    listen [::]:${NGINX_PORT};
    server_name ${SERVER_NAME};

    root ${DEPLOY_DIR};
    index index.html;

    # gzip 压缩
    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml application/xml+rss text/javascript application/wasm image/svg+xml;

    # 静态资源长缓存（Vite 产物带 contenthash，可永久缓存）
    location /assets/ {
        expires 1y;
        add_header Cache-Control "public, immutable";
        access_log off;
    }

    # index.html 不缓存，确保用户拿到最新入口
    location = /index.html {
        add_header Cache-Control "no-cache, no-store, must-revalidate";
        expires off;
    }

    # 反向代理 /api → ai-gateway 后端
    location /api/ {
        proxy_pass ${BACKEND_URL};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;

        # SSE 流式响应支持（对话 / 对比接口）
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 300s;
        chunked_transfer_encoding on;
        add_header X-Accel-Buffering no;
    }

    # SPA 前端路由 fallback（所有未匹配路径返回 index.html）
    location / {
        try_files \$uri \$uri/ /index.html;
    }
}
EOF
info "nginx 配置已写入 ${NGINX_SITE_CONF}"

# 启用站点（创建软链，若已存在则覆盖）
ln -sf "${NGINX_SITE_CONF}" "${NGINX_ENABLED_LINK}"

# ───────────────────────────────────────────────────────────
# 阶段 6：nginx 自检 + 重载
# ───────────────────────────────────────────────────────────
log "阶段 6/6 · nginx 自检与重载"

if ! nginx -t; then
  err "nginx 配置自检失败，请检查 ${NGINX_SITE_CONF}。"
  exit 1
fi

systemctl reload nginx || nginx -s reload
info "nginx 已重载。"

# ───────────────────────────────────────────────────────────
# 完成 · 健康检查
# ───────────────────────────────────────────────────────────
log "部署完成 ✓"
info "代码版本：$(git rev-parse --short HEAD)（${BRANCH}）"
info "静态目录：${DEPLOY_DIR}"
info "访问地址：http://$(hostname -I 2>/dev/null | awk '{print $1}' || echo 'localhost')${NGINX_PORT:+:$NGINX_PORT}/"
info "后端代理：/api/ → ${BACKEND_URL}"

echo ""
info "提示："
info "  · 生产 .env 请放在仓库根的 ${ENV_FILE}，下次部署会自动注入。"
info "  · 回滚上一版本：mv ${BACKUP_DIR} ${DEPLOY_DIR} && systemctl reload nginx"
info "  · 跳过 nginx：SKIP_NGINX=1 ./deploy.sh"
