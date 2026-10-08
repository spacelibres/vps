# VPS 管理面板

基于 **KiwiVM / 64clouds REST API** 的多 VPS 管理面板，用 **TypeScript + Next.js 15 (App Router)** 实现。
核心是一个**面向对象的插件框架**：每个功能都是一个插件，包揽自己的服务端逻辑与前端界面；新增功能= 新增一个插件目录。

## 快速开始

> **开发前必读：[`AGENTS.md`](./AGENTS.md)** —— 技术栈、插件结构、接口契约与验证门槛的**强制规则**。

```bash
# 1. 安装依赖
pnpm --dir apps/web install          # 或在仓库根执行：pnpm setup

# 2. 配置凭据与环境变量
cp apps/web/config/vps.yaml.example apps/web/config/vps.yaml   # 填入你的 veid/api_key/alias
cp apps/web/.env.example apps/web/.env                         # 设置 PANEL_PASSWORD 与 SESSION_SECRET

# 3. 开发 / 构建 / 运行
pnpm dev          # http://localhost:3000
pnpm build && pnpm start
```

> 仓库根的 `pnpm dev/build/start/typecheck/test` 都会转发到 `apps/web`。

### 环境变量（`apps/web/.env`）

| 变量 | 必填 | 说明 |
|---|---|---|
| `PANEL_PASSWORD` | ✅ | 登录面板的密码 |
| `SESSION_SECRET` | ✅ | 签名 session cookie 的密钥，建议 `openssl rand -hex 32` |
| `KIWIVM_API_BASE` | | API 基地址，默认 `https://api.64clouds.com/v1` |
| `KIWIVM_MIN_INTERVAL_MS` | | 相邻两次出站调用的最小间隔（毫秒），默认 `120`，用于避免触发限流 |

### VPS 凭据（`apps/web/config/vps.yaml`）

```yaml
vps:
  - veid: "2166457"
    api_key: "private_xxxxxxxx"
    alias: "tile0.spacexway.com"
```

该文件已被 `.gitignore` 忽略，**不会进版本库**；`api_key` 只在服务端加载，绝不下发到浏览器。

## 目录结构

```
apps/web/src/
├── sdk/                     # 插件 SDK（契约层，与业务无关）
│   ├── api/types.ts         # 全量 API 返回类型
│   ├── client/kiwivm-client.ts   # 全 30+ endpoint 客户端（注入 transport，无 IO）
│   ├── plugin/              # 插件契约 / 基类 / 注册表
│   ├── ui/                  # 共享 UI 原子组件 + usePluginAction hook
│   ├── errors.ts format.ts logger.ts
├── plugins/                 # ← 所有插件（一个目录一个插件）
│   ├── index.ts             # 注册表：import + new 每个插件
│   ├── lifecycle/  info/  os/  account/  snapshot/  backup/
│   ├── network/  security/  migrate/  shell/  notifications/
├── lib/                     # 应用运行时（非插件）：凭据、传输层、鉴权
├── components/              # 壳：侧边导航、顶部 VPS 选择器、VPS 上下文
├── app/                     # 路由：登录、总览、插件宿主页、API 路由
└── middleware.ts            # 密码门（校验签名 cookie）
```

依赖方向单向：`sdk` ← `plugins` ← `app`。SDK 不含任何 Next.js 代码、不读环境变量、不做 IO。

## 插件架构

一个插件同时暴露**服务端动作**与**前端视图**，继承 `BasePlugin`：

```ts
// plugins/demo/index.ts —— 不要写 "use client"
import { BasePlugin, defineAction, type PluginAction } from "@/sdk";
import { demoViews } from "./view";

const pingAction = defineAction({
  id: "ping", label: "Ping", method: "GET",
  run: (ctx) => ctx.client.getServiceInfo(),
});

export class DemoPlugin extends BasePlugin {
  readonly id = "demo";
  readonly name = "示例";
  override readonly order = 99;
  readonly actions: readonly PluginAction[] = [pingAction];
  readonly views = demoViews;
}
export default DemoPlugin;
```

```tsx
// plugins/demo/view.tsx —— 第一行必须 "use client"
"use client";
import { defineView, type PluginView, type PluginViewProps } from "@/sdk";
import { PluginPage, Card, usePluginAction } from "@/sdk/ui";

function DemoView(props: PluginViewProps) {
  const { run, data } = usePluginAction("demo", "ping");
  return <PluginPage title="示例" {...props}><Card>{JSON.stringify(data)}</Card></PluginPage>;
}

export const demoViews: PluginView[] = [
  defineView({ id: "main", title: "示例", path: "", Component: DemoView }),
];
```

**新增插件三步**：
1. 建 `src/plugins/<name>/index.ts`（服务端动作 + 插件类）与 `view.tsx`（`"use client"` 视图）。
2. 在 `src/plugins/index.ts` 里 `import` 并 `new` 一行。
3. 完成——导航与 `/plugins/<name>` 路由会自动出现。

**关键设计**

- **插件只依赖抽象**：通过 `ctx.client` / `ctx.clientFor(veid)` 调 API，不接触 `fetch`、凭据、环境变量。
- **注入式传输层**：`KiwiVmClient` 与 IO 解耦，测试可注入假传输层；真实传输层内置串行队列 + 最小间隔，规避 API 限流。
- **统一错误模型**：API `error != 0` 抛 `KiwiVmError`（route handler 统一转成 `{ ok:false, error }`）。
- **`basicShell/exec` 特例**：官方把该接口的 `error` 复用为「命令退出码」，走 `callRaw()` 不做错误校验。

## API 覆盖

| 插件 | API |
|---|---|
| 生命周期 | `start` `stop` `restart` `kill` |
| 监控与日志 | `getServiceInfo` `getLiveServiceInfo` `getRawUsageStats` `getAuditLog` `getRateLimitStatus` |
| 系统与 ISO | `getAvailableOS` `reinstallOS` `iso/mount` `iso/unmount` |
| 账号与 SSH | `getSshKeys` `updateSshKeys` `resetRootPassword` |
| 快照 | `snapshot/create|list|delete|restore|toggleSticky|export|import` |
| 自动备份 | `backup/list` `backup/copyToSnapshot` |
| 网络 | `setHostname` `setPTR` `ipv6/add|delete` `privateIp/getAvailableIps|assign|delete` |
| 挂起与违规 | `getSuspensionDetails` `unsuspend` `getPolicyViolations` `resolvePolicyViolation` |
| 迁移与克隆 | `migrate/getLocations` `migrate/start` `cloneFromExternalServer` |
| 命令行 | `basicShell/cd` `basicShell/exec` `shellScript/exec` |
| 通知偏好 | `kiwivm/getNotificationPreferences` `kiwivm/setNotificationPreferences` |

## 安全

- 公网部署时所有页面与 API 都由 `middleware.ts` 保护，未登录一律拒绝（页面 302、API 401）。
- 密码比较使用恒时比较；会话为 HS256 签名 cookie（`httpOnly`，生产环境 `secure`）。
- VPS 的 `api_key` 只存在于服务端与 `config/vps.yaml`（已 gitignore）。

## 验证

```bash
pnpm typecheck   # 全项目 TS 类型检查
pnpm test        # vitest 单测（SDK 客户端 / 注册表）
pnpm build       # Next.js 生产构建
```

设计文档见 `docs/superpowers/specs/2026-10-08-vps-panel-design.md`。
