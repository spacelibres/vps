#!/usr/bin/env bash
#
# 一键安装 / 更新 —— VPS 管理面板（Next.js 15 + pm2 + Caddy 自动 HTTPS）
#
# 全自动：缺什么装什么，无需人工干预。
#
# 方式 A（一行命令，自动克隆到 /opt/vps-panel 后安装）：
#   curl -fsSL https://raw.githubusercontent.com/spacelibres/vps/main/deploy/install.sh | bash
#
# 方式 B（在已克隆的仓库里）：
#   bash deploy/install.sh
#
# 可选环境变量（都不填也能跑）：
#   PANEL_PASSWORD=xxx    面板登录密码（不填则交互询问；非交互则自动生成并打印）
#   PANEL_ORIGIN=34.05,-118.25,Los Angeles   IP 池航线起点（不填则用本机公网 IP 反查城市）
#   DOMAIN=panel.example.com   对外域名（不填则自动探测 hostname -f 是否解析到本机）
#   EMAIL=me@example.com  ACME 账号邮箱（可选）
#   PORT=8080             面板端口（默认 3000；仅在未启用 Caddy 时对外暴露）
#   HOST=127.0.0.1        监听地址（默认：启用 Caddy 时 127.0.0.1，否则 0.0.0.0）
#   APP_NAME=my-panel     pm2 进程名（默认 vps-panel）
#   INSTALL_DIR=/opt/...  方式 A 的克隆目录（默认 /opt/vps-panel）
#   INSTALL_NODE=0        禁止自动安装 Node（默认允许）
#   NO_CADDY=1            禁用 Caddy / 自动 HTTPS
#   SKIP_SWAP=1           不自动创建 swap
#
set -euo pipefail

APP_NAME="${APP_NAME:-vps-panel}"
PORT="${PORT:-3000}"
REQUESTED_HOST="${HOST:-}"
INSTALL_DIR="${INSTALL_DIR:-/opt/vps-panel}"
REPO_URL="${REPO_URL:-https://github.com/spacelibres/vps.git}"

log()  { printf '\033[1;34m▸\033[0m %s\n' "$*"; }
ok()   { printf '\033[1;32m✓\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m!\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m✗\033[0m %s\n' "$*" >&2; exit 1; }

is_root() { [ "$(id -u)" = "0" ]; }
have()    { command -v "$1" >/dev/null 2>&1; }

gen_secret() {
  if have openssl; then openssl rand -hex 32
  else head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n'; fi
}
gen_password() {
  if have openssl; then openssl rand -base64 24 | tr -dc 'A-Za-z0-9' | cut -c1-16
  else head -c 24 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | cut -c1-16; fi
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
  if ! have git; then
    if have apt-get; then apt-get update -y >/dev/null 2>&1 || true; apt-get install -y git >/dev/null 2>&1 || apt-get install -y git; fi
  fi
  have git || die "缺少 git，请先安装 git"
  if [ -d "$INSTALL_DIR/.git" ]; then
    git -C "$INSTALL_DIR" pull --ff-only || warn "git pull 失败，继续用现有代码"
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

# ── 1. 系统依赖（缺什么装什么）───────────────────────────────
if have apt-get; then
  MISSING=""
  for c in git curl openssl ca-certificates; do have "$c" || MISSING="$MISSING $c"; done
  # ca-certificates 是包名而非命令，单独判一次
  dpkg -s ca-certificates >/dev/null 2>&1 || MISSING="$MISSING ca-certificates"
  if [ -n "$MISSING" ]; then
    log "安装系统依赖：$MISSING"
    apt-get update -y >/dev/null 2>&1 || true
    apt-get install -y $MISSING >/dev/null 2>&1 || apt-get install -y $MISSING
  fi
fi

# ── 2. 小内存机器自动加 swap（构建更稳）──────────────────────
if [ "${SKIP_SWAP:-0}" != "1" ] && is_root; then
  MEM_MB="$(awk '/MemTotal/{print int($2/1024)}' /proc/meminfo 2>/dev/null || echo 99999)"
  SWAP_MB="$(awk '/SwapTotal/{print int($2/1024)}' /proc/meminfo 2>/dev/null || echo 99999)"
  if [ "$MEM_MB" -lt 3000 ] && [ "$SWAP_MB" -lt 512 ] && [ ! -f /swapfile ]; then
    log "物理内存 ${MEM_MB}MB 偏小，创建 2G swap…"
    fallocate -l 2G /swapfile 2>/dev/null || dd if=/dev/zero of=/swapfile bs=1M count=2048 status=none
    chmod 600 /swapfile
    mkswap /swapfile >/dev/null
    swapon /swapfile
    grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
    ok "swap 已启用"
  fi
fi

# ── 3. Node ≥ 20（缺则自动安装）──────────────────────────────
if ! have node; then
  if [ "${INSTALL_NODE:-1}" = "1" ] && have apt-get; then
    log "未找到 Node.js，用系统包管理器安装…"
    apt-get update -y >/dev/null 2>&1 || true
    apt-get install -y nodejs npm >/dev/null 2>&1 || apt-get install -y nodejs || true
  fi
fi
NODE_MAJOR="$(have node && node -p 'process.versions.node.split(".")[0]' || echo 0)"
if [ "$NODE_MAJOR" -lt 20 ] && [ "${INSTALL_NODE:-1}" = "1" ] && have apt-get; then
  log "系统 Node 不可用或低于 20，改用 NodeSource 安装 Node 22…"
  have curl || { apt-get update -y >/dev/null 2>&1 || true; apt-get install -y curl ca-certificates; }
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
have node || die "未找到 node，请先安装 Node.js ≥ 20"
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 20 ] || die "Node.js 版本过低（当前 $(node -v)），需要 ≥ 20"

# ── 4. pnpm（缺则自动安装）───────────────────────────────────
pnpm_ok() { have pnpm && pnpm -v >/dev/null 2>&1; }
if ! pnpm_ok; then
  log "pnpm 不可用，尝试启用 corepack…"
  if have corepack; then
    corepack enable >/dev/null 2>&1 || true
    corepack prepare pnpm@11.22.0 --activate >/dev/null 2>&1 || true
  fi
fi
if ! pnpm_ok; then
  log "corepack 不可用，改用 npm 全局安装 pnpm…"
  npm install -g pnpm
  hash -r 2>/dev/null || true
fi
pnpm_ok || die "pnpm 不可用，请手动安装：npm i -g pnpm"

# ── 5. pm2（缺则自动安装）────────────────────────────────────
if ! have pm2; then
  log "未找到 pm2，正在全局安装…"
  npm install -g pm2
fi
have pm2 || die "pm2 不可用，请手动安装：npm i -g pm2"

ok "Node $(node -v) · pnpm $(pnpm -v) · pm2 $(pm2 -v)"

# ── 6. 环境变量 apps/web/.env ────────────────────────────────
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

# 机器调用 token（外部下载器调 /api/** 用）；未设则不启用 token 鉴权。
if ! grep -q '^PANEL_API_TOKEN=' "$ENV_FILE" 2>/dev/null; then
  set_env PANEL_API_TOKEN "$(gen_secret)" "$ENV_FILE"
  ok "已生成随机 PANEL_API_TOKEN（机器调用用，见 $ENV_FILE）"
fi

GENERATED_PW=""
NEED_PW=0
if [ -n "${PANEL_PASSWORD:-}" ]; then
  PW="$PANEL_PASSWORD"; NEED_PW=1
elif ! grep -q '^PANEL_PASSWORD=' "$ENV_FILE" 2>/dev/null \
  || grep -q '^PANEL_PASSWORD=change-me-please' "$ENV_FILE" 2>/dev/null; then
  if [ -t 0 ]; then
    printf '\033[1;34m▸\033[0m 设置面板登录密码（留空则自动生成）：'
    read -r PW || true
  fi
  PW="${PW:-}"; NEED_PW=1
fi
if [ "$NEED_PW" = "1" ]; then
  if [ -z "$PW" ]; then PW="$(gen_password)"; GENERATED_PW="$PW"; fi
  case "$PW" in
    *[!A-Za-z0-9@%+=:,./_-]*) die "密码含不安全字符（仅支持字母数字与 @%+=:,./_-）" ;;
  esac
  set_env PANEL_PASSWORD "$PW" "$ENV_FILE"
  ok "已写入 PANEL_PASSWORD"
fi

# ── 6b. IP 池路线起点 IP_POOL_ORIGIN ─────────────────────────
# IP_POOL_ORIGIN="lat,lng[,label]"：ip-pool 航线图的起点。优先 PANEL_ORIGIN；
# 否则用本机公网 IP 反查所在城市；都失败则不写（页面无航线，可稍后手填）。
if ! grep -q '^IP_POOL_ORIGIN=' "$ENV_FILE" 2>/dev/null; then
  ORIGIN="${PANEL_ORIGIN:-}"
  if [ -z "$ORIGIN" ]; then
    PUB_IP="$(curl -s --max-time 8 https://ifconfig.me 2>/dev/null || true)"
    if [ -n "$PUB_IP" ]; then
      GEO="$(curl -s --max-time 10 "http://ip-api.com/json/${PUB_IP}?fields=status,lat,lon,city" 2>/dev/null || true)"
      case "$GEO" in
        *'"status":"success"'*)
          GLAT="$(printf '%s' "$GEO" | sed -n 's/.*"lat":\([-0-9.]*\).*/\1/p')"
          GLON="$(printf '%s' "$GEO" | sed -n 's/.*"lon":\([-0-9.]*\).*/\1/p')"
          GCITY="$(printf '%s' "$GEO" | sed -n 's/.*"city":"\([^"]*\)".*/\1/p')"
          if [ -n "$GLAT" ] && [ -n "$GLON" ]; then
            if [ -n "$GCITY" ]; then ORIGIN="$GLAT,$GLON,$GCITY"; else ORIGIN="$GLAT,$GLON"; fi
          fi
          ;;
      esac
    fi
  fi
  if [ -n "$ORIGIN" ]; then
    set_env IP_POOL_ORIGIN "$ORIGIN" "$ENV_FILE"
    ok "IP 池弹道起点 IP_POOL_ORIGIN=$ORIGIN"
  else
    warn "未能自动探测 IP 池起点；若页面无航线，请设 PANEL_ORIGIN 或手填 .env 的 IP_POOL_ORIGIN"
  fi
fi

# ── 7. VPS 凭据 apps/web/config/vps.yaml ─────────────────────
VPS_CFG="$WEB_DIR/config/vps.yaml"
if [ ! -f "$VPS_CFG" ]; then
  cp "$WEB_DIR/config/vps.yaml.example" "$VPS_CFG"
  warn "已从模板创建 apps/web/config/vps.yaml —— 请填入真实 veid/api_key/alias"
  warn "填好后执行：pm2 restart $APP_NAME --update-env"
fi

# ── 8. 域名探测（决定是否上 Caddy / 绑 127.0.0.1）───────────
detect_domain() {
  if [ -n "${DOMAIN:-}" ]; then printf '%s' "$DOMAIN"; return 0; fi
  [ "${NO_CADDY:-0}" = "1" ] && return 1
  local fqdn
  fqdn="$(hostname -f 2>/dev/null || true)"
  case "$fqdn" in ""|localhost|localhost.localdomain) return 1;; esac
  case "$fqdn" in *.*) ;; *) return 1;; esac

  local locals pub addr addrs
  locals=" $(hostname -I 2>/dev/null || true) "
  pub="$(curl -s --max-time 8 https://ifconfig.me 2>/dev/null || true)"
  locals="$locals $pub "

  # 用 `getent -s dns` 只查 DNS（绕开 /etc/hosts 里 127.0.0.1 的干扰），
  # 再排除回环地址，最后与本机地址比对。
  addrs="$(
    {
      getent -s dns ahostsv4 "$fqdn" 2>/dev/null | awk '{print $1}'
      getent -s dns ahostsv6 "$fqdn" 2>/dev/null | awk '{print $1}'
    } | grep -vE '^(127\.|::1$|$)' | sort -u || true
  )"

  while read -r addr; do
    [ -z "$addr" ] && continue
    case "$locals" in *" $addr "*) printf '%s' "$fqdn"; return 0;; esac
  done <<EOF
$addrs
EOF
  return 1
}

DETECTED_DOMAIN="$(detect_domain || true)"
if [ -n "$DETECTED_DOMAIN" ]; then
  ok "探测到可用域名：$DETECTED_DOMAIN（将启用 Caddy 自动 HTTPS）"
else
  warn "未探测到指向本机的域名（可设 DOMAIN=... 或用 NO_CADDY=1 跳过）"
fi

if [ -n "$REQUESTED_HOST" ]; then HOST="$REQUESTED_HOST"
elif [ -n "$DETECTED_DOMAIN" ]; then HOST="127.0.0.1"
else HOST="0.0.0.0"; fi
export APP_NAME PORT HOST

# ── 9. 安装依赖 + 构建 ───────────────────────────────────────
log "安装依赖（pnpm install）…"
( cd "$WEB_DIR" && pnpm install )

log "构建（next build）…"
( cd "$WEB_DIR" && pnpm build )

mkdir -p "$ROOT_DIR/logs"

# ── 10. pm2 启动 / 重启 + 开机自启（root 下自动配置）─────────
if pm2 describe "$APP_NAME" >/dev/null 2>&1; then
  log "重启已有进程 $APP_NAME（HOST=$HOST）…"
  pm2 restart "$ECOSYSTEM" --update-env >/dev/null
else
  log "启动进程 $APP_NAME（HOST=$HOST）…"
  pm2 start "$ECOSYSTEM" >/dev/null
fi
pm2 save >/dev/null

if is_root && have systemctl; then
  pm2 startup systemd -u root --hp /root >/dev/null 2>&1 || true
  if systemctl is-enabled pm2-root >/dev/null 2>&1; then
    # 若 pm2 守护进程是 CLI 拉起的（未被 systemd 托管），让 systemd 接管：
    # 先停掉再经 unit `pm2 resurrect` 从 dump 恢复 —— 这样才能享受到
    # 开机自启 + 崩溃自动重启（否则 unit 会显示 inactive，不会看护它）。
    if ! systemctl is-active --quiet pm2-root; then
      log "让 systemd 接管 pm2（开机自启 + 崩溃自动重启）…"
      pm2 kill >/dev/null 2>&1 || true
      systemctl start pm2-root
      sleep 2
    fi
    if systemctl is-active --quiet pm2-root; then
      ok "pm2 已由 systemd 托管（开机自启）"
    else
      warn "pm2-root 未处于 active，请检查：systemctl status pm2-root"
    fi
  fi
else
  STARTUP_CMD="$(pm2 startup 2>&1 | grep -E '^sudo env ' || true)"
  [ -n "$STARTUP_CMD" ] && { warn "请以 root 执行一次以配置开机自启："; printf '\n    %s\n\n' "$STARTUP_CMD"; }
fi

# ── 11. Caddy 反向代理（443 → 127.0.0.1:PORT，自动 HTTPS）────
SCHEME="http"
ACCESS_HOST="<服务器IP>"
if [ -n "$DETECTED_DOMAIN" ]; then
  log "配置 Caddy：https://$DETECTED_DOMAIN → 127.0.0.1:$PORT"
  if DOMAIN="$DETECTED_DOMAIN" PORT="$PORT" EMAIL="${EMAIL:-}" bash "$SCRIPT_DIR/setup-caddy.sh"; then
    SCHEME="https"; ACCESS_HOST="$DETECTED_DOMAIN"
  else
    warn "Caddy 配置失败；面板仍可在 http://<服务器IP>:$PORT 访问"
    HOST="0.0.0.0"; export HOST
    pm2 restart "$ECOSYSTEM" --update-env >/dev/null || true
    pm2 save >/dev/null || true
  fi
fi

# ── 12. 结果 ─────────────────────────────────────────────────
sleep 2
pm2 describe "$APP_NAME" 2>/dev/null | grep -E 'status|restarts|uptime' || true
printf '\n'
if [ "$SCHEME" = "https" ]; then
  ok "部署完成 → https://$ACCESS_HOST/login"
  printf '   （面板仅监听 127.0.0.1:%s，公网走 Caddy 443）\n' "$PORT"
else
  ok "部署完成 → http://$ACCESS_HOST:$PORT/login"
fi
if [ -n "$GENERATED_PW" ]; then
  warn "面板登录密码：$GENERATED_PW   （保存好；改 apps/web/.env 后 pm2 restart $APP_NAME）"
fi
printf '常用命令：\n  pm2 logs %s        # 面板日志\n  pm2 restart %s     # 重启面板\n  journalctl -u caddy -f   # Caddy / 证书日志\n\n' "$APP_NAME" "$APP_NAME"
