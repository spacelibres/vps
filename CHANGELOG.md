# 变更日志

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 与 [语义化版本](https://semver.org/lang/zh-CN/)。

**规则：每次交付必须递增版本号（起始 `0.0.1`，每次 `PATCH` +1）并在本文件登记。** 版本号同时写在
`package.json`（根与 `apps/web` 保持一致）。详见 `AGENTS.md` §10。

## [未发布]

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
