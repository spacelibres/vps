# 变更日志

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 与 [语义化版本](https://semver.org/lang/zh-CN/)。

**规则：每次交付必须递增版本号（起始 `0.0.1`，每次 `PATCH` +1）并在本文件登记。** 版本号同时写在
`package.json`（根与 `apps/web` 保持一致）。详见 `AGENTS.md` §10。

## [未发布]

## [0.0.31] - 2026-10-08

### 变更

- 派发**单请求超时**独立出来：`IP_POOL_DISPATCH_TIMEOUT_MS`（默认 **4000**）。
  粘死/失效的热连接此前会占着一个 worker 槽满 20s，拖垮整体吞吐；现在快速失败、
  立即换下一个请求，并把该 IP 退出热池交给后台重热。
- 派发默认在飞上限 256 → **1024**（实测 1024≈1500 的吞吐峰值）。

## [0.0.30] - 2026-10-08

### 修复

- **航线配色回归 flight-map**：移除「热连接一律画成绿色」的覆盖。整池预热后所有航线都是热连接，
  于是所有弹道都变成一种绿色，**每 IP 独立配色全部丢失**。
  现在与参照工程一致：未激活=灰色虚线骨架，激活=按 `visualFromIp`（黄金角哈希）取**本 IP 颜色**、
  流动虚线；热/冷只作为表格与 HUD 的状态，不再改线色。删除不再使用的 `HOT_ROUTE_COLOR`。

## [0.0.29] - 2026-10-08

### 变更

- `dispatch` 改为**有界并发**：worker 数 = `min(cap, count, 热 IP 数)`，
  每个 worker 从共享队列取下一个请求、按下标**轮询整张热 IP 表**（所有热 IP 都参与）。
  输入新增可选 `concurrency`；缺省用 `IP_POOL_DISPATCH_CONCURRENCY`（默认 256）。
- 原因：实测单条复用连接只需 ~52ms，但一次铺开全部 3458 个 worker 会把每个请求拉到 ~6.5s
  且总吞吐反而降到 ~490 请求/秒（过度订阅 3 核机器）。吞吐在 ~200-400 并发见顶（~1150 请求/秒），
  再高反而下降。`DispatchStatus` 新增 `concurrency` 字段。

## [0.0.28] - 2026-10-08

### 新增

- `ip-pool` 新增「经热池派发」：
  - `dispatch`（POST，`{ url?, count }`）：复用**已预热的常驻热连接**（绿色通道）对 `url`
    发起 `count` 次请求，结果写入统计并生成弹道（SSE 推送）；后台异步运行，
    只走热 IP（某 IP 无热连接直接报错，不冷建连），每个热 IP 一个 worker。
  - `dispatchStatus`（GET）：作业进度（total / done / success / failed / rps）。
  - `hot-pool.ts` 重新提供「经热连接发一次请求」的原语 `dispatch()`。
  - `plan.ts`：派发调度（纯逻辑，带单测）。
- 由**外部**（本机）触发，插件内不做测试性抓取。

## [0.0.27] - 2026-10-08

### 移除

- `ip-pool` 移除全部本地抓取/测试入口：`fetch`（抓取一次）、`fetchBatch`（全池抓取）、
  `batchStatus`（全池抓取进度）三个动作，以及 `fetch.ts` / `host-pin.ts` / `concurrency.ts` /
  `hot-picker.ts` 与 `batch.ts` 的作业机制。
  测试/压测一律在**系统之外**进行：外部发送方经 `ingest` / `snapshot` 接入事件。
- 移除 `hot-pool.ts` 中不再使用的 `probe` / `pickHot` / `hotCount` / `HotProbeResult`
  （业务抓取派发）及其 `deniedIps` 记账；删除 `hot-picker.ts`。

### 变更

- `ip-pool` 收敛为「管理 + 统计 + 显示」：不发起业务抓取，只消费外部事件；
  仅保留整池常驻热连接（`hot-pool.ts` + `warm.ts`，面板打开即预热整池；`IP_POOL_AUTO_WARM=0` 可关闭）。
  设计文档同步更新（§2 / §11 / §16），并修正 `AGENTS.md` 中 `node-wreq` 的用途说明。

## [0.0.26] - 2026-10-08

### 变更

- **整池预热不再依赖“跑一次批量抓取”**：面板打开（`stats` 动作）即在后台对**全部** IP 预热，
  整个池子逐渐变为常驻热连接；此前热连接只在 `fetchBatch` 逐 IP `probe` 时建立，
  所以一次限量测试只留下 300 个热 IP、其余 3192 个一直 `pending`。
  可用 `IP_POOL_AUTO_WARM=0` 关闭。
- **移除面板上常驻的“全池抓取进度”卡片**（及轮询）：批量作业只是诊断/测试入口，
  不应把一次作业的结果作为常驻状态展示。热连接数改在 HUD 显示为 `热池 hot/total`。

## [0.0.25] - 2026-10-08

### 新增

- **行 ↔ 地图连线**：表格行被聚焦时，绘制一条从该行到地图落点的贝塞尔引线，
  并在地图落点旁边浮动显示信息卡（IP、地区、请求/成功/失败/字节、热连接标记），
  每帧跟随滚动与缩放重算。
- **重置统计**：新增 `resetStats` 动作（POST，`{}` → `ResetStatsResult`），清空所有 IP 计数
  与最近事件并立即落盘；`StoreSnapshot` / `StreamSnapshot` 增加 `resetEpoch`。
  重置后 SSE 向所有在线客户端广播 `reset` 事件，前端据此清空本地脉冲、心跳采样与日志。
  热连接属运行时状态，不受重置影响。

## [0.0.24] - 2026-10-08

### 新增

- 补齐 `flight-map` 的可视化/监控能力（此前只搬了骨架/脉冲/国别筛选）：
  - **请求速率心跳波**（RPS 波形：绿=成功、红=失败，最近 90s）；
  - **网卡流量**：服务端采样 `/proc/net/dev`，经 SSE `metrics` 事件推送 rx/tx 速率；
  - **本屏窗口统计**：`IntersectionObserver` 只统计表格**可视区域**内的 IP；
  - **行点击 → 地图聚焦**：脉冲圆标记 + 永久信息卡，并自动 `setView`；
  - 统计表新增「族」列（v4/v6）与热连接绿点标记；
  - HUD 增加热池计数与实时 RPS。
- SSE 新增 `metrics` 事件（类型 `StreamMetrics`）；新增服务端 `net.ts`（读网卡累计流量）。

## [0.0.23] - 2026-10-08

### 新增

- **热连接「绿色通道」可视化**：已建立常驻热连接的 IP，其弹道在图上以**绿色实线**绘制
  （未热的仍是灰色虚线骨架）。`stats` 动作新增 `hotIps`（运行时信息，不落盘）。

### 变更

- 热池新增 `connectTimeoutMs`（默认 `4000`）与 `coldTimeoutMs`（默认 `6000`）：
  **不可达 / 极慢的 IP 快速失败**。此前它们每个都烧满 20s 总超时，是吞吐的真正瓶颈
  （14B 的响应却要 5.29s 就是这类）；现由 `IP_POOL_CONNECT_TIMEOUT_MS` /
  `IP_POOL_COLD_TIMEOUT_MS` 控制。

## [0.0.22] - 2026-10-08

### 新增

- `ip-pool` **每 IP 常驻热连接（热池）**——移植 `GeoClaw/src/fetch/HotConnectionPool`：
  - `hot-pool.ts`：用 `createClient({ dns.hosts, connectionGroup: ip, poolIdleTimeout,
    poolMaxIdlePerHost })` 为**每个 IP** 建一条可复用 `Client`，**握手只做一次**，后续请求复用
    keep-alive；仅 HTTP 200 入热池；传输失败移出热池 + 退避后台重热；`403/429` 入冷池；
    空闲接近窗口时保活续命。
  - `hot-picker.ts`：公平选路 `pickFairHotIp`（带 `warmSlack` 时优先复用最近连接，+ 单测）。
  - 批量抓取改为走热池：重复跑同一批 IP 时握手开销基本消失；进度快照新增
    `hotReused` / `coldOpened` / `pool`（热池 hot/total），视图同步展示。

### 说明

- 第一遍仍是「冷建连」（每个 IP 一次握手），**第二遍起大量热复用**——这才是该设计的价值。

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
