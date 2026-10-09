# VPS 管理面板 —— 设计文档

- 日期：2026-10-08
- 状态：已确认（进入实现）
- 目标：把 64clouds / KiwiVM 的全部 REST API 能力封装为**面向对象的插件**，用 **TypeScript + Next.js** 实现一个可扩展的管理面板。

## 1. 背景与目标

用户拥有 13 台 VPS（VEID + API Key），希望通过自建面板统一管理，替代 KiwiVM。

核心诉求：

1. **面向对象的插件架构** —— 新增功能 = 新增一个插件包，尽量不改动核心。
2. **插件自带 UI** —— 每个插件负责自己的服务端逻辑与前端界面。
3. **独立插件包** —— 插件是独立、可单独版本化的 workspace 包。
4. **终态覆盖全部 API** —— 文档中 30+ 个 API 调用全部封装为插件。
5. **公网部署 + 单用户密码门** —— 环境变量密码 + 签名 session cookie。
6. **无持久化** —— 实时直连 API 的无状态代理。

## 2. 已确认的决策

| # | 决策点 | 选择 |
|---|--------|------|
| 1 | v1 核心目标 | 终态为 D（封装全部 API）；v1 一次铺满全部 API 插件 |
| 2 | 插件 UI | 插件自带 React 组件；SDK 提供共享 UI 原子组件减少重复 |
| 3 | 插件发现 | 独立插件包（workspace 包），主应用通过注册表引用 |
| 4 | 落地形态 | C1：纯 workspace 包 + 构建期打包 |
| 5 | 持久化 | 无（无状态代理；预留审计/历史钩子，将来可加） |
| 6 | 访问控制 | 公网 + 单用户密码门（env 密码 + 签名 cookie） |
| 7 | 界面语言 | 中文 |

## 3. 总体架构

Monorepo（pnpm workspaces），三层职责单向依赖：`plugin-sdk` ← `plugin-*` ← `apps/web`。

```
vps/
├── apps/
│   └── web/                      # Next.js 15 (App Router) 主应用 = 壳 + 运行时
│       ├── src/app/              # 页面 + route handlers
│       ├── src/lib/              # 服务端基础设施（非插件）
│       ├── src/registry.ts       # 插件注册表（手动 import）
│       └── config/vps.yaml       # VPS 凭据（gitignore）
├── packages/
│   ├── plugin-sdk/               # 契约层
│   ├── plugin-lifecycle/         # 生命周期
│   ├── plugin-info/              # 信息 / 实时状态 / 用量 / 审计 / 限流
│   ├── plugin-os/                # 重装系统 / availableOS / ISO
│   ├── plugin-snapshot/          # 快照
│   ├── plugin-backup/            # 自动备份
│   ├── plugin-network/           # IPv6 / 私有IP / PTR / 主机名
│   ├── plugin-security/          # 挂起 / 违规 / 解封
│   ├── plugin-migrate/           # 迁移定位 / 克隆
│   ├── plugin-shell/             # basicShell / shellScript
│   ├── plugin-notifications/     # 通知偏好
│   └── plugin-account/           # SSH keys / 密码
└── pnpm-workspace.yaml
```

职责边界：

- `plugin-sdk`：纯 TS + React 组件，不含 Next.js 代码、不读环境变量、不做 I/O 绑定。定义插件契约、类型、API 客户端抽象、共享 UI。
- `plugin-*`：只依赖 `plugin-sdk`，导出插件类。可独立版本化、发布。
- `apps/web`：依赖全部插件包，组装注册表，提供运行时服务（HTTP 客户端实现、凭据加载、鉴权中间件、登录页）。

## 4. 插件契约（SDK）

```ts
export interface VpsTarget { veid: string; alias: string; }

export interface PluginContext {
  client: KiwiVmClient;            // 已绑定 veid + api_key
  clientFor(veid: string): KiwiVmClient; // 批量操作用
  targets: readonly VpsTarget[];
  logger: Logger;
}

export interface PluginAction {
  id: string;
  label: string;
  method: "GET" | "POST";
  input?: ZodType;                 // 可选参数校验
  danger?: boolean;                // 危险操作（UI 二次确认）
  run(ctx: PluginContext, input: unknown): Promise<unknown>;
}

export interface PluginView {
  id: string;
  title: string;
  path: string;                    // 相对："/plugins/<id>"
  Component: React.ComponentType<PluginViewProps>;
}

export interface VpsPlugin {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly actions: readonly PluginAction[];
  readonly views: readonly PluginView[];
}

export abstract class BasePlugin implements VpsPlugin { /* ... */ }

export abstract class KiwiVmClient {
  abstract call(endpoint: string, params?: Record<string, unknown>): Promise<unknown>;
  // 全量 30+ 方法由 SDK 声明签名，apps/web 提供实现
}
```

设计要点：

- 插件只依赖抽象，不碰 `fetch` / env / 凭据。
- 注册表 `apps/web/src/registry.ts` 手动 import 每个插件类；将来升级自动扫描/运行时加载只需替换注册表实现。
- 统一错误模型 `KiwiVmError`（含 API 的 `error` / `message`）。
- 客户端实现内置串行队列 + `getRateLimitStatus` 感知，避免触发 API 限流。

## 5. 插件清单（全量 API 映射）

| 插件包 | 覆盖的 API |
|--------|-----------|
| plugin-lifecycle | `start` `stop` `restart` `kill` |
| plugin-info | `getServiceInfo` `getLiveServiceInfo` `getRawUsageStats` `getUsageGraphs` `getAuditLog` `getRateLimitStatus` |
| plugin-os | `getAvailableOS` `reinstallOS` `iso/mount` `iso/unmount` |
| plugin-snapshot | `snapshot/create` `list` `delete` `restore` `toggleSticky` `export` `import` |
| plugin-backup | `backup/list` `backup/copyToSnapshot` |
| plugin-network | `setHostname` `setPTR` `ipv6/add` `ipv6/delete` `privateIp/getAvailableIps` `privateIp/assign` `privateIp/delete` |
| plugin-security | `getSuspensionDetails` `getPolicyViolations` `unsuspend` `resolvePolicyViolation` |
| plugin-migrate | `migrate/getLocations` `migrate/start` `cloneFromExternalServer` |
| plugin-shell | `basicShell/cd` `basicShell/exec` `shellScript/exec` |
| plugin-notifications | `kiwivm/getNotificationPreferences` `kiwivm/setNotificationPreferences` |
| plugin-account | `getSshKeys` `updateSshKeys` `resetRootPassword` |

## 6. UI 壳

- App Router，左侧导航（由注册表动态生成，按插件分组），右侧内容区。
- 顶部 VPS 选择器（13 台）+ 全局状态指示。
- 密码门：`/login` 页面 + `middleware.ts` 保护所有路由与 API。
- 插件视图挂载于 `/plugins/[pluginId]/[...viewPath]`。

## 7. 鉴权

- env `PANEL_PASSWORD`；登录成功后签发签名 cookie（`jose` HS256），密钥来自 env `SESSION_SECRET`。
- 中间件校验 cookie，未通过则重定向 `/login`。
- 服务端 route handler 再次校验（不信任客户端）。
- **反代 origin**：经 Caddy 时 Next 的 `req.nextUrl` 是内部地址（`http://localhost:3000`），直接 clone 会把用户
  重定向到 `localhost:3000`。重定向改用 `x-forwarded-host`（回退 `host`）+ `x-forwarded-proto` 重建
  （`lib/public-origin.ts`，纯逻辑 + 单测）。

## 8. 凭据配置

- `apps/web/config/vps.yaml`（gitignore）+ `vps.yaml.example` 模板。
- 仅服务端加载；前端永不接触 api_key。

## 9. 错误处理

- `KiwiVmError` 统一封装；route handler 统一 try/catch，返回 `{ ok:false, error }`。
- 插件 action 的异常在壳层转成用户可读提示。

## 10. 测试与验证

- `pnpm -w typecheck`：全仓 TS 类型检查。
- `pnpm -w build`：Next.js 生产构建。
- 关键纯逻辑（插件注册、客户端错误映射、参数校验）用 vitest 单测。

## 11. 交付计划

1. 脚手架：pnpm workspace、根 tsconfig、SDK 包。
2. SDK：类型、契约、客户端抽象、共享 UI。
3. apps/web：鉴权、壳布局、注册表、API 调度路由、看板。
4. 全部 plugin-* 包（分批：先 lifecycle/info 跑通，再横向铺满）。
5. 配置模板 + README + 验证（typecheck/build）。
