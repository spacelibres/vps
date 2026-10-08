#!/usr/bin/env bash
#
# 一键安装 / 更新 —— VPS 管理面板（Next.js 15 + pm2）
#
# 方式 A（在已克隆的仓库里）：
#   bash deploy/install.sh
#
# 方式 B（一行命令，自动克隆到 /opt/vps-panel 后安装）：
#   curl -fsSL https://raw.githubusercontent.com/spacelibres/vps/main/deploy/install.sh | bash
#
# 可用环境变量：
#   PANEL_PASSWORD=xxx    面板登录密码（不传则交互询问 / 随机生成）
#   PORT=8080             监听端口（默认 3000）
#   HOST=127.0.0.1        监听地址（默认 0.0.0.0）
#   APP_NAME=my-panel     pm2 进程名（默认 vps-panel）
#   INSTALL_DIR=/opt/...  方式 B 的克隆目录（默认 /opt/vps-panel）
#   INSTALL_NODE=0        禁止在缺 Node 时自动安装（默认允许，仅 Debian/Ubuntu）
#
set -euo pipefail

APP_NAME="${APP_NAME:-vps-panel}"
PORT="${PORT:-3000}"
HOST="${HOST:-0.0.0.0}"
INSTALL_DIR="${INSTALL_DIR:-/opt/vps-panel}"
REPO_URL="${REPO_URL:-https://github.com/spacelibres/vps.git}"
export APP_NAME PORT HOST

log()  { printf '\033[1;34m▸\033[0m %s\n' "$*"; }
ok()   { printf '\033[1;32m✓\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m!\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m✗\033[0m %s\n' "$*" >&2; exit 1; }

gen_secret() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32
  else
    head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n'
  fi
}

gen_password() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -base64 24 | tr -dc 'A-Za-z0-9' | cut -c1-16
  else
    head -c 24 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | cut -c1-16
  fi
}

# 幂等写入/覆盖某个键（删旧行后追加；dotenv 后出现的键生效）。
set_env() {
  local key="$1" value="$2" file="$3"
  grep -v -E "^${key}=" "$file" > "${file}.tmp" 2>/dev/null || true
  printf '%s=%s\n' "$key" "$value" >> "${file}.tmp"
  mv "${file}.tmp" "$file"
}

# ── 0. 定位仓库；不在仓库内则克隆后重跑 ─────────────────────
if [ -n "${BASH_SOURCE[0]:-}" ]; then
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
else
  SCRIPT_DIR="$(pwd)"
fi
ROOT_DIR="$(cd "$SCRIPT_DIR/.." 2>/dev/null && pwd || echo "$SCRIPT_DIR")"

if [ ! -d "$ROOT_DIR/apps/web" ]; then
  log "当前不在仓库内，准备克隆到 $INSTALL_DIR"
  command -v git >/dev/null 2>&1 || {
    if command -v apt-get >/dev/null 2>&1; then
      apt-get update -y && apt-get install -y git
    else
      die "缺少 git，请先安装 git"
    fi
  }
  if [ -d "$INSTALL_DIR/.git" ]; then
    log "仓库已存在，执行 git pull…"
    git -C "$INSTALL_DIR" pull --ff-only
  else
    mkdir -p "$(dirname "$INSTALL_DIR")"
    git clone --depth 1 "$REPO_URL" "$INSTALL_DIR"
  fi
  exec bash "$INSTALL_DIR/deploy/install.sh"
fi

WEB_DIR="$ROOT_DIR/apps/web"
ECOSYSTEM="$SCRIPT_DIR/ecosystem.config.cjs"
ENV_FILE="$WEB_DIR/.env"
[ -f "$ECOSYSTEM" ] || die "缺少 $ECOSYSTEM"

# ── 1. 环境检查（缺 Node 时按需自动安装）────────────────────
if ! command -v node >/dev/null 2>&1; then
  if [ "${INSTALL_NODE:-1}" = "1" ] && command -v apt-get >/dev/null 2>&1; then
    log "未找到 Node.js，通过 NodeSource 安装 Node 22…"
    command -v curl >/dev/null 2>&1 || { apt-get update -y && apt-get install -y curl ca-certificates; }
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
    apt-get install -y nodejs
  else
    die "未找到 node，请先安装 Node.js ≥ 20"
  fi
fi
command -v node >/dev/null 2>&1 || die "Node.js 安装失败"
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 20 ] || die "Node.js 版本过低（当前 $(node -v)），需要 ≥ 20"

if ! command -v pnpm >/dev/null 2>&1; then
  log "未找到 pnpm，尝试启用 corepack…"
  if command -v corepack >/dev/null 2>&1; then
    corepack enable >/dev/null 2>&1 || true
    corepack prepare pnpm@11.22.0 --activate >/dev/null 2>&1 || true
  fi
  command -v pnpm >/dev/null 2>&1 || npm install -g pnpm
fi
command -v pnpm >/dev/null 2>&1 || die "pnpm 不可用，请手动安装：npm i -g pnpm"

if ! command -v pm2 >/dev/null 2>&1; then
  log "未找到 pm2，正在全局安装…"
  npm install -g pm2
fi
command -v pm2 >/dev/null 2>&1 || die "pm2 不可用，请手动安装：npm i -g pm2"

ok "Node $(node -v) · pnpm $(pnpm -v) · pm2 $(pm2 -v)"

# ── 2. 环境变量 apps/web/.env ────────────────────────────────
[ -f "$WEB_DIR/.env.example" ] || die "缺少 $WEB_DIR/.env.example"
if [ ! -f "$ENV_FILE" ]; then
  cp "$WEB_DIR/.env.example" "$ENV_FILE"
  log "已从模板创建 apps/web/.env"
fi

if ! grep -q '^SESSION_SECRET=' "$ENV_FILE" 2>/dev/null \
  || grep -q '^SESSION_SECRET=please-generate' "$ENV_FILE" 2>/dev/null; then
  set_env SESSION_SECRET "$(gen_secret)" "$ENV_FILE"
  ok "已生成随机 SESSION_SECRET"
fi

GENERATED_PW=""
NEED_PW=0
if [ -n "${PANEL_PASSWORD:-}" ]; then
  PW="$PANEL_PASSWORD"
  NEED_PW=1
elif ! grep -q '^PANEL_PASSWORD=' "$ENV_FILE" 2>/dev/null \
  || grep -q '^PANEL_PASSWORD=change-me-please' "$ENV_FILE" 2>/dev/null; then
  if [ -t 0 ]; then
    printf '\033[1;34m▸\033[0m 设置面板登录密码（留空则自动生成）：'
    read -r PW || true
  fi
  PW="${PW:-}"
  NEED_PW=1
fi

if [ "$NEED_PW" = "1" ]; then
  if [ -z "$PW" ]; then
    PW="$(gen_password)"
    GENERATED_PW="$PW"
  fi
  case "$PW" in
    *[!A-Za-z0-9@%+=:,./_-]*) die "密码含不安全字符（仅支持字母数字与 @%+=:,./_-）" ;;
  esac
  set_env PANEL_PASSWORD "$PW" "$ENV_FILE"
  ok "已写入 PANEL_PASSWORD"
fi

# ── 3. VPS 凭据 apps/web/config/vps.yaml ─────────────────────
VPS_CFG="$WEB_DIR/config/vps.yaml"
if [ ! -f "$VPS_CFG" ]; then
  cp "$WEB_DIR/config/vps.yaml.example" "$VPS_CFG"
  warn "已从模板创建 apps/web/config/vps.yaml —— 请填入真实 veid/api_key/alias"
  warn "填好后执行：pm2 restart $APP_NAME --update-env"
fi

# ── 4. 安装依赖 + 构建 ───────────────────────────────────────
log "安装依赖（pnpm install）…"
( cd "$WEB_DIR" && pnpm install )

log "构建（next build）…"
( cd "$WEB_DIR" && pnpm build )

mkdir -p "$ROOT_DIR/logs"

# ── 5. pm2 启动 / 重启 ───────────────────────────────────────
if pm2 describe "$APP_NAME" >/dev/null 2>&1; then
  log "重启已有进程 $APP_NAME…"
  pm2 restart "$ECOSYSTEM" --update-env >/dev/null
else
  log "启动进程 $APP_NAME…"
  pm2 start "$ECOSYSTEM" >/dev/null
fi
pm2 save >/dev/null

# ── 6. 开机自启 ──────────────────────────────────────────────
STARTUP_CMD="$(pm2 startup 2>&1 | grep -E '^sudo env ' || true)"
if [ -n "$STARTUP_CMD" ]; then
  warn "配置开机自启：请以 root 执行下面这条命令（脚本不代为 sudo）"
  printf '\n    %s\n\n' "$STARTUP_CMD"
else
  ok "pm2 开机自启已配置"
fi

# ── 7. 结果 ──────────────────────────────────────────────────
sleep 2
pm2 describe "$APP_NAME" 2>/dev/null | grep -E 'status|restarts|uptime' || true
printf '\n'
ok "部署完成 → http://<服务器IP>:%s" "$PORT"
if [ -n "$GENERATED_PW" ]; then
  warn "已为你生成面板密码：$GENERATED_PW   （请自行保存，可改 apps/web/.env 后重启）"
fi
printf '常用命令：\n  pm2 logs %s        # 查看日志\n  pm2 restart %s     # 重启\n  pm2 stop %s        # 停止\n\n' \
  "$APP_NAME" "$APP_NAME" "$APP_NAME"
