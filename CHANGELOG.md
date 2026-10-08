# 变更日志

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 与 [语义化版本](https://semver.org/lang/zh-CN/)。

**规则：每次交付必须递增版本号（起始 `0.0.1`，每次 `PATCH` +1）并在本文件登记。** 版本号同时写在
`package.json`（根与 `apps/web` 保持一致）。详见 `AGENTS.md` §10。

## [未发布]

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
