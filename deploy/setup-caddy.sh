#!/usr/bin/env bash
#
# 用 Caddy 把 443（HTTPS）反向代理到本机面板端口（默认 3000）。
#
# 用法：
#   DOMAIN=panel.example.com bash deploy/setup-caddy.sh
#   DOMAIN=panel.example.com EMAIL=me@example.com PORT=3000 bash deploy/setup-caddy.sh
#
# 前置条件：
#   - 域名 A/AAAA 记录已指向本机公网 IP（Let's Encrypt 需要能回连 80/443）；
#   - 本机 80/443 未被占用（Caddy 需要占用它们做自动签发与跳转）。
#
set -euo pipefail

DOMAIN="${DOMAIN:-${1:-}}"
PORT="${PORT:-3000}"
EMAIL="${EMAIL:-}"

log()  { printf '\033[1;34m▸\033[0m %s\n' "$*"; }
ok()   { printf '\033[1;32m✓\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m!\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m✗\033[0m %s\n' "$*" >&2; exit 1; }

[ -n "$DOMAIN" ] || die "缺少 DOMAIN。用法：DOMAIN=panel.example.com bash deploy/setup-caddy.sh"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEMPLATE="$SCRIPT_DIR/Caddyfile.template"
[ -f "$TEMPLATE" ] || die "缺少 $TEMPLATE"

command -v apt-get >/dev/null 2>&1 || die "本脚本仅支持 Debian/Ubuntu（未找到 apt-get）"

# ── 1. 安装 Caddy ────────────────────────────────────────────
if ! command -v caddy >/dev/null 2>&1; then
  log "安装 Caddy（apt）…"
  apt-get update -y >/dev/null 2>&1 || true
  apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl gnupg >/dev/null 2>&1 || true
  apt-get install -y caddy
fi
command -v caddy >/dev/null 2>&1 || die "Caddy 安装失败"
ok "Caddy $(caddy version | head -1)"

# ── 2. 生成 /etc/caddy/Caddyfile ─────────────────────────────
GLOBAL=""
if [ -n "$EMAIL" ]; then
  GLOBAL="{
	email $EMAIL
}"
elif [ -f /etc/caddy/Caddyfile ] && grep -q '^\s*email ' /etc/caddy/Caddyfile 2>/dev/null; then
  warn "沿用已有 Caddyfile 中的 email 设置"
fi

log "生成 /etc/caddy/Caddyfile（$DOMAIN → 127.0.0.1:$PORT）"
if [ -f /etc/caddy/Caddyfile ] && ! grep -q '__DOMAIN__\|Caddyfile.template' /etc/caddy/Caddyfile 2>/dev/null; then
  cp /etc/caddy/Caddyfile "/etc/caddy/Caddyfile.bak.$(date +%Y%m%d%H%M%S)"
  warn "已备份原 Caddyfile"
fi

sed -e "s|__DOMAIN__|$DOMAIN|g" \
    -e "s|__PORT__|$PORT|g" \
    -e "s|__GLOBAL__|$GLOBAL|g" \
    "$TEMPLATE" > /etc/caddy/Caddyfile

caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null
ok "Caddyfile 校验通过"

# ── 3. 启动 / 重载 ───────────────────────────────────────────
systemctl enable caddy >/dev/null 2>&1 || true
if systemctl is-active --quiet caddy; then
  systemctl reload caddy
  ok "已重载 Caddy"
else
  systemctl restart caddy
  ok "已启动 Caddy"
fi

# ── 4. 等证书签发并自检 ──────────────────────────────────────
log "等待证书签发与站点就绪（最多 ~60s）…"
for _ in $(seq 1 12); do
  sleep 5
  CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "https://$DOMAIN/login" || true)"
  [ "$CODE" = "200" ] && break
done

if [ "${CODE:-}" = "200" ]; then
  ok "HTTPS 就绪 → https://$DOMAIN/login"
else
  warn "暂未就绪（当前 https://$DOMAIN/login → ${CODE:-无响应}）。查看日志：journalctl -u caddy -n 50"
fi
