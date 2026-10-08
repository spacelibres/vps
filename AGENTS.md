# 项目规则（强制）

本文件是**权威约束**。开始任何开发前必读，违反即视为不合格产出。

## 0. 技术栈（固定，不得偏离）

- **TypeScript + Next.js 15（App Router）**。禁止 `.js` 源文件；禁止引入其它框架 / Router / 状态库 / UI 组件库。
- 允许的依赖范围：React + Tailwind + 现有 `@/sdk` + `zod` + `yaml` + `jose` + `leaflet`。新增依赖必须在 `AGENTS.md` 里登记理由。
- 包管理器 pnpm；Node ≥ 20。
- 表单与校验的**唯一元数据来源是 zod schema**。

## 1. 一切皆插件

- 所有业务功能**必须**实现为插件：`apps/web/src/plugins/<plugin-id>/`。
- `src/lib/` 只允许放**与业务无关的运行时基础设施**（凭据加载、传输层、鉴权、注册表装配）。
- `src/app/` 只允许放**路由胶水**（页面、route handler），不得写业务逻辑。
- **禁止跨插件 import 对方内部模块**。插件之间只能通过 (a) `@/sdk` 契约，或 (b) HTTP 接口交互。

## 2. 插件目录结构（固定）

```
plugins/<plugin-id>/
├── index.ts        # 服务端：动作 + 插件类（禁止 "use client"）
├── descriptor.ts   # 客户端安全：元数据 + 视图（禁止 import node:*）
├── view.tsx        # "use client" 视图组件
├── types.ts        # 纯类型（客户端安全）
└── <name>.test.ts  # 必须存在
```

- 服务端部分若依赖 `node:*`，**必须**像 `ip-pool` 一样拆出 `descriptor.ts`，避免进入浏览器包。
- 注册分两处：`plugins/index.ts`（客户端安全，引入 descriptor / 同构插件）+ `plugins/server.ts`（仅服务端，补齐 `actions`）。
- 纯逻辑模块（无 `node:*`、无 DOM）单独成文件，便于单测与客户端复用。

## 3. 接口契约（强制）

每个动作**必须**显式声明以下字段：

| 字段 | 规则 |
|---|---|
| `id` | 小写驼峰，匹配 `^[a-z][a-zA-Z0-9]*$`（如 `getSshKeys` / `setPtr` / `restart`）；插件内唯一；**不得含 `/`** |
| `label` | 中文短标签，非空，**不复述插件名** |
| `method` | 显式 `"GET"`（只读）或 `"POST"`（写入/变更） |
| `input` | **必填** zod schema。无参数也必须写 `z.object({})`（编译器强制） |
| `needsVps` | 与 VPS 无关时必须显式 `false` |
| `raw` | 返回 `Response`（如 SSE）时必须显式 `true` |
| 输出 | **必须有明确的 TS 类型**：直接复用 `@/sdk` 已有类型（如 `ServiceInfo`）；自定义结构**必须**在插件内 `export` 该类型。可选再加 `output`（zod）供路由做运行时校验 |
| `output` | 可选；非 raw 动作**推荐**声明。结构已在 `@/sdk` 定义时可用 `z.unknown()`（须注明引用的类型） |

- `input` 由**编译器强制**：每个动作都必须声明（无参数也写 `z.object({})`）。
- 输入由宿主在**路由层**用 zod 校验；动作内部**禁止**再手写参数校验。
- 输出类型由 TypeScript 返回类型约束；声明了 `output` 的动作，宿主会在路由层做运行时校验。

## 4. 每个插件必须在 `index.ts` 顶部维护「契约表」

```ts
/**
 * 插件：<名称>（id: <plugin-id>）
 *
 * | 动作 | method | needsVps | 输入 | 输出 |
 * |---|---|---|---|---|
 * | status | GET | true | `{}` | `ServiceInfo`（@/sdk） |
 * | restart | POST | true | `{}` | `void` |
 * | ingest | POST | false | `IngestInput` | `IngestResult`（本插件 types） |
 *
 * 错误：统一抛 `KiwiVmError`；路由层转换为 `{ ok:false, error:{ code, message } }`。
 */
```

## 5. 禁止项

- 禁止 `as any` / `@ts-ignore` / `@ts-expect-error` 绕过类型；确需时必须在同处注释原因。
- 禁止在 UI 写**解释性废话文案**（复述标题、教程式说明）。**必要的警示**（会丢数据、需重启、仅某平台支持）必须保留。
- 禁止在插件里直连外部网络，**除非该插件本职如此**（例如 `ip-pool` 只消费事件、不发起请求）。
- 禁止新增插件目录之外的业务文件。
- 禁止提交 `.env`、`config/vps.yaml`、`data/`。
- 禁止把密钥/凭据写进代码或前端。

## 6. 验证门槛（缺一不可）

```
pnpm typecheck && pnpm test && pnpm build
```

- 三道全绿方可交付。
- 纯逻辑必须有单测；**新增动作至少一个测试**。
- 涉及运行时行为的改动，必须**用真实接口/端到端验证并给出证据**（命令 + 输出），不得只凭推断宣称通过。

## 7. 命名

- 插件 id：**小写短横线**（kebab），匹配 `^[a-z][a-z0-9-]*$`（`ip-pool`）。
- 动作 id：**小写驼峰**（camelCase），匹配 `^[a-z][a-zA-Z0-9]*$`，动词/名词短语（`getSshKeys` / `setPtr` / `resetRootPassword`）。
- 文件名：`index.ts` / `descriptor.ts` / `view.tsx` / `types.ts` / `<name>.ts` / `<name>.test.ts`。
- 事件类型：沿用 `ip-pool/types.ts` 的 `Fetch*` 命名体系（借鉴 `GeoClaw/src/fetch` 的模型）。

## 8. 变更流程

1. 先改 `@/sdk`：类型契约（`src/sdk/plugin/types.ts`）与 API 类型（`src/sdk/api/types.ts`）。
2. 再改插件：`index.ts`（动作 + 契约表）、`descriptor.ts`、`view.tsx`。
3. 补测试；跑门槛校验。
4. 更新设计文档：`docs/superpowers/specs/`。

## 9. 自动化检查

`src/plugins/contract.test.ts` 会遍历注册表校验上述规则（id/label/method/input/output 的存在性与格式、插件 id 唯一、文件结构完整）。**任何新增插件都必须通过它**。

## 10. 版本与变更日志（强制）

- 版本号起始 **`0.0.1`**，**每次交付必须 `PATCH` +1**（`0.0.1` → `0.0.2` → …），除非用户明确要求改动 `MAJOR`/`MINOR`。
- 版本号同时写入 `package.json`（仓库根与 `apps/web`，**两处必须一致**）。
- 每次改动都必须在本仓库根 `CHANGELOG.md` 的对应版本条目下登记（遵循 Keep a Changelog：`新增` / `变更` / `修复` / `移除` / `安全`）。
- 提交信息建议：`vX.Y.Z <简述>`（例如 `v0.0.2 ip-pool 增加行点击聚焦`）。
- 远程仓库：`https://github.com/spacelibres/vps`（分支 `main`）。

## 11. 禁止提交的内容

`.env`、`config/vps.yaml`、`data/` 已被 `.gitignore` 忽略，**不得**用 `git add -f` 强行提交。提交前用 `git status` 目视确认。
