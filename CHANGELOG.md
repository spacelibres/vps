# 变更日志

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 与 [语义化版本](https://semver.org/lang/zh-CN/)。

**规则：每次交付必须递增版本号（起始 `0.0.1`，每次 `PATCH` +1）并在本文件登记。** 版本号同时写在
`package.json`（根与 `apps/web` 保持一致）。详见 `AGENTS.md` §10。

## [未发布]

## [0.0.21] - 2026-10-08

### 变更

- `ip-pool` 视图移除「全池抓取（全速）」「抓取一次」「刷新」三个按钮：刷新改为**全自动**——
  统计每 5s 轮询 + SSE 实时流；批量作业进度每 3s 自动轮询（展示外部触发的全池抓取）。
  - 抓取仍可由接口触发（`fetch` / `fetchBatch`）——UI 只做监控。

## [0.0.20] - 2026-10-08

### 修复

- `deploy/ecosystem.config.cjs`：`max_memory_restart` 512M → **1024M**（可用 `MAX_MEMORY_RESTART` 覆盖）。
  实测全池**全速**（3492 并发）时 RSS 峰值达 **675MB**，512M 会触发 pm2 重启 →
  批量作业状态丢失、在途请求被中断。

## [0.0.19] - 2026-10-08

### 变更

- `ip-pool` 全池抓取**默认全速**：`concurrency` 默认改为 `0`（**不限并发**，一次性铺开全部目标），
  上限放宽至 4096；不再默认限流（需要限流时才显式传 `concurrency > 0`）。
- `FetchBatchStatus` 新增 `elapsedMs` / `ratePerSec`（吞吐指标，供后续调优）；
  视图按钮改为「全池抓取（全速）」并实时显示「个/秒」。
- `mapPool`：`concurrency <= 0` 表示不限并发（带单测）。

## [0.0.18] - 2026-10-08

### 修复

- `deploy/install.sh`：pm2 守护进程若由 CLI 拉起（未被 systemd 托管），unit 会显示 `inactive`，
  因此**不经受开机自启与崩溃自动重启**。现自动执行 `pm2 kill` → `systemctl start pm2-root`
  让 systemd 接管（经 unit `pm2 resurrect` 从 dump 恢复），并校验 `is-active`。

## [0.0.17] - 2026-10-08

### 修复

- `deploy/Caddyfile.template`：改用 `reverse_proxy` 内的 `header_down` 覆盖上游 `Cache-Control`。
  站点级 `header` 指令会**追加**而非替换，导致响应出现**重复 `Cache-Control`**
  （我们的长缓存 + 上游的 `max-age=0`），按最严格者生效 → 等于**没有缓存**。
  现改为 `handle` 分支 + `header_down`，实测国旗 PNG 仅剩单条 `public, max-age=2592000`。

## [0.0.16] - 2026-10-08

### 变更

- `deploy/Caddyfile.template` 增加**分级缓存**与压缩（此前 `public/` 资源为 `max-age=0`，
  每次访问都回源，尤其是 ip-pool 页面的国旗 PNG）：
  - `/_next/static/*` → `public, max-age=31536000, immutable`（内容哈希，永久缓存）；
  - `/_next/image` → `public, max-age=2592000`（30 天）；
  - `public/` 静态资源（国旗 / 图标 / 字体 / 图片 / favicon）→ `public, max-age=2592000`；
  - `encode zstd gzip`，并**排除 SSE 端点**（`/api/plugins/*/actions/stream`）避免缓冲。

## [0.0.15] - 2026-10-08

### 修复

- **GET 动作被 405 拒绝**：`usePluginAction` 之前**总是 POST**，导致所有 `method: "GET"` 的动作
  （`lifecycle/status`、`info/live`、`snapshot/list`、`account/getSshKeys` 等）报
  「该动作只接受 GET（405）」。现根据动作元数据选择正确的 HTTP 方法。
  - 新增 `sdk/ui/plugin-actions.tsx`（`PluginActionsProvider` / `useActionMeta`）：
    宿主插件页把动作元数据（`id`/`method`）注入视图。
  - 新增 `sdk/ui/action-request.ts`（纯逻辑 + 单测）：`GET` 走 query、`POST` 走 JSON body。
- 动作路由缺少 `veid` 时的报错改为**可操作的提示**（“请在「当前 VPS」中选择一台…”）。

### 变更

- 「当前 VPS」选择同步到 URL `?veid=`：总览点卡片、侧边导航跳转、刷新 / 分享都不再丢失选择。

## [0.0.14] - 2026-10-08

### 修复

- `deploy/install.sh` 域名自动探测：改用 `getent -s dns ahostsv4/6`（**绕开 `/etc/hosts` 里
  `127.0.0.1 <hostname>` 的干扰**）并排除回环地址，修复此前误判为「无域名」、
  从而退化成公网 `:3000` 且不启用 Caddy 的问题。

## [0.0.13] - 2026-10-08

### 变更

- `deploy/install.sh` 升级为**全自动、零人工干预**：
  - 自动安装系统依赖（git / curl / openssl / ca-certificates）；
  - 小内存机器（< 3GB 且无 swap）自动创建 2G swap；
  - 未提供 `PANEL_PASSWORD` 且非交互时**自动生成并打印**；
  - **自动探测域名**（`hostname -f` 解析到本机）→ 探测到则自动配置 Caddy 443 自动 HTTPS，
    并把面板改为**仅监听 `127.0.0.1`**；Caddy 失败则自动回退为公网 `:PORT`；
  - root 下自动完成 `pm2 startup` 开机自启（不再需要手敲 sudo 命令）；
  - 新增开关 `NO_CADDY` / `SKIP_SWAP`。
- `README.md` 重写部署章节（一行命令、全自动说明、环境变量表）。

## [0.0.12] - 2026-10-08

### 修复

- `deploy/Caddyfile.template`：移除 Caddy 2.6 不支持的 `flush_interval`（以及非必需的 `encode`），
  修复 `unrecognized directive: flush_interval` 导致校验失败；SSE 由反代默认即到即转保障。
- `deploy/setup-caddy.sh`：写入前先备份，校验失败自动**回滚**并退出（不再留下坏配置）。

## [0.0.11] - 2026-10-08

### 新增

- **Caddy 反向代理（443 → 3000，自动 HTTPS）**：
  - `deploy/Caddyfile.template`：站点模板（auto-HTTPS、反代 `127.0.0.1:__PORT__`、
    `flush_interval -1` 保 SSE 实时、可选 ACME 邮箱）。
  - `deploy/setup-caddy.sh`：按 `DOMAIN`/`PORT`/`EMAIL` 生成 `/etc/caddy/Caddyfile`、
    校验、`systemctl enable --now caddy`，并自检 `https://<域名>/login`。
  - `deploy/install.sh`：当设置 `DOMAIN` 时自动执行 `setup-caddy.sh`，并在结尾提示 HTTPS 地址。
  - `README.md` 补充 Caddy 反代用法与 `HOST=127.0.0.1` 监听收紧建议。

## [0.0.10] - 2026-10-08

### 修复

- **登录失败（服务已部署）**：会话 cookie 的 `Secure` 改为**按请求协议自适应**（新增 `useSecureCookie`）。
  之前生产环境恒为 `Secure`，在纯 HTTP 下浏览器会直接丢弃 cookie，表现为「密码正确却登录不上」。
  现：HTTPS → 加 `Secure`；纯 HTTP → 不加；可用 `PANEL_COOKIE_SECURE`（`1`/`0`）强制覆盖。
  `logout` 同样自适应。
- `deploy/install.sh` 结束提示里的 `%s` 占位符展示错误。

### 新增

- `src/lib/session.test.ts`：`useSecureCookie` 单测（HTTP/HTTPS/转发头/覆盖）。
- `.env.example` 登记 `PANEL_COOKIE_SECURE`。

## [0.0.9] - 2026-10-08

### 修复

- 新增 `apps/web/pnpm-workspace.yaml`，用 `allowBuilds`（pnpm ≥ 10 的正确位置）声明允许执行
  构建脚本的原生依赖：`esbuild` / `@tailwindcss/oxide` / `sharp` / `node-wreq`。

### 移除

- 撤销 v0.0.8 里在 `package.json` 加的 `pnpm.onlyBuiltDependencies`（pnpm 12 已不再读取该字段）。

## [0.0.8] - 2026-10-08

### 修复

- `apps/web/package.json` 新增 `pnpm.onlyBuiltDependencies`（`esbuild` / `@tailwindcss/oxide` /
  `sharp` / `node-wreq`），修复 pnpm 12 因「忽略构建脚本」直接报 `ERR_PNPM_IGNORED_BUILDS` 导致安装失败。

## [0.0.7] - 2026-10-08

### 修复

- `deploy/install.sh`：pnpm 探活改为**实际执行 `pnpm -v`**，而非仅判断可执行文件存在；
  避开 Debian/Ubuntu 自带 corepack 唨损坏（`ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING`）导致
  `pnpm install` 失败。corepack 不可用时改用 `npm i -g pnpm`。

## [0.0.6] - 2026-10-08

### 变更

- `deploy/install.sh`：缺 Node 时**优先用系统包管理器**（Debian/Ubuntu 的 `nodejs`/`npm`）安装，
  仅当系统包不可用或版本低于 20 时才回退 NodeSource（避开新发行版尚无 NodeSource 仓库的问题）。

## [0.0.5] - 2026-10-08

### 新增

- **一键部署（VPS + pm2 进程守护）**：新增 `deploy/`。
  - `deploy/install.sh`：一键安装 / 更新。检查并（Debian/Ubuntu 下）自动安装 Node ≥ 20，
    启用 pnpm、安装 pm2，生成 `apps/web/.env`（随机 `SESSION_SECRET`），装依赖、`next build`、
    `pm2 start` + `pm2 save`；支持 `curl … | bash` 自克隆到 `/opt/vps-panel`。
    可调：`PANEL_PASSWORD` / `PORT` / `HOST` / `APP_NAME` / `INSTALL_DIR` / `INSTALL_NODE`。
  - `deploy/ecosystem.config.cjs`：pm2 配置（`cwd` 锁定 `apps/web`、内存上限、自动重启、日志）。
- `README.md` 新增「部署（VPS + pm2 进程守护）」章节。

### 变更

- `.gitignore` 忽略 `logs/`（pm2 日志）。

## [0.0.4] - 2026-10-08

### 新增

- `ip-pool` **全池批量抓取**：
  - `fetchBatch`（POST）：对全池 / 指定 IP / 地址族 / 限量逐 IP 钉住抓取一次，**有界并发**、
    后台运行，逐条写入统计并经 SSE 实时推送弹道。
  - `batchStatus`（GET）：作业进度（total / done / success / httpError / transportError）。
  - `concurrency.ts`：有界并发映射 `mapPool`（纯逻辑，带单测）。
  - `origin.ts`：弹道起点解析（`lat,lng[,label]`），供配置与 Store 复用。
  - 视图「全池抓取」按钮 + 进度条。

### 变更

- **弹道弧几何重写**：由「大圆 + 轨道拱高」改为**等距圆柱下的二次拱形**（沿最短经度差线性插值 +
  垂向拱高），并加**纬度软上限**：绝不越过 `maxAbsLat`（避免弧线冲上北极圈）。
  可配 `bowFactor` / `maxBowDeg` / `maxAbsLat`；端点仍精确落在起止点。
- **弹道起点持久化**：`Store` 记录 `origin`，重建时依次回落「构造参数 → 文件持久值 → `IP_POOL_ORIGIN`」，
  不再因进程重建而丢失起点。
- 视图：种子骨架航线也会刷新「航线 N」计数。

### 修复

- 修复弹道起点丢失导致**地图上没有任何航线**的问题。
- 修复弹道弧**越过北极圈**的视觉错误。

## [0.0.3] - 2026-10-08

### 新增

- `ip-pool` **一期真实抓取**：新增 `fetch` 动作（POST，`needsVps:false`），用 `node-wreq`
  带**浏览器 TLS/JA3/JA4 + HTTP2 指纹**抓取一次，默认钉住池内 IP（模拟浏览器经由 Google 前端 IP 出网）。
  - `config.ts`：全部抓取参数来自环境变量（目标 URL / 指纹 profile / 代理 / 超时 / 弹道起点 / 池文件）。
  - `host-pin.ts`：`HostPinPool` 轮询分配池内 IP，构造 `dns.hosts` 覆盖以绕过系统解析。
  - `fetch.ts`：`fetchOnce`——指纹 + 钉 IP + 计时（`onStats.timings.wait`）。
  - 抓取结果写入统计（落盘），成为弹道与统计的真实数据源。
- `ip-pool` 视图「抓取一次」按钮：一键触发真实抓取，就地展示 `outcome / status / 钉住 IP / 耗时 / 字节`。
- `ip-pool` 新增 `host-pin.test.ts`。

### 变更

- `next.config.ts` 增加 `serverExternalPackages: ["node-wreq"]`，避免 webpack 打包破坏 Rust 原生模块解析。
- `.env.example` 登记抓取相关环境变量（`IP_POOL_TARGET_URL` / `IP_POOL_BROWSER` / `IP_POOL_PROXY` /
  `IP_POOL_TIMEOUT_MS` / `IP_POOL_ORIGIN`）。
- `store.resolvePoolFile` 导出，供配置解析复用。

### 修复

- `fetch` 动作的 `transport_error` 现在回报真实耗时（原先恒为 `0`）。

### 安全

- `AGENTS.md` §0 登记 `node-wreq` 依赖及理由（原生指纹 + 钉 IP）。

## [0.0.2] - 2026-10-08

### 变更

- `AGENTS.md` 新增 **§10 版本与变更日志**：版本号起始 `0.0.1`、每次交付 `PATCH` +1、
  两处 `package.json` 保持一致、**一次交付 = 一个版本号 = 一个提交**、每版打 tag，并给出逐步交付流程。
- `AGENTS.md` 新增 **§11 Git 与远程仓库**：远程/分支、提交信息格式 `vX.Y.Z <简述>`、
  必须经本地 SOCKS5 代理、一次性认证、推送前确认历史清晰、禁止 force push；原「禁止提交的内容」顺延为 §12。

## [0.0.1] - 2026-10-08

### 新增

- **插件框架（SDK）**：插件契约与基类、注册表、KiwiVM API 客户端（全量 endpoint）、
  共享 UI 原子组件与 `usePluginAction`、格式化工具。
- **KiwiVM 插件（11 个）**：生命周期、监控与日志、系统与 ISO、账号与 SSH、快照、
  自动备份、网络、挂起与违规、迁移与克隆、命令行、通知偏好。
- **`ip-pool` 插件**：Google 前端 IP 池的聚合管理 + 请求统计 + 弹道航线可视化。
  - 入口：HTTP `ingest`、文件快照（JSONL / YAML）、SSE 实时流；
  - 统计**强制落盘**到 `apps/web/data/ip-stats/<hostname>.yaml`；
  - 地图：Bing 瓦片、池子灰色骨架、按 IP 哈希着色的脉冲航线、世界副本、国旗。
- **认证与壳**：单用户密码门（签名 cookie + 中间件）、总览页、插件宿主页、侧边导航。
- **工程规则**：`AGENTS.md`（强制）、契约一致性测试 `src/plugins/contract.test.ts`、
  vitest 配置、`.zed/settings.json`（编辑器 TS 指向工程内 TypeScript）。
- **设计文档**：`docs/superpowers/specs/` 下的面板总体设计与 `ip-pool` 插件设计。
