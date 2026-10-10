# 项目规则（强制）

本文件是**权威约束**。开始任何开发前必读，违反即视为不合格产出。

## 0. 技术栈（固定，不得偏离）

- **TypeScript + Next.js 15（App Router）**。禁止 `.js` 源文件；禁止引入其它框架 / Router / 状态库 / UI 组件库。
- 允许的依赖范围：React + Tailwind + 现有 `@/sdk` + `zod` + `yaml` + `jose` + `leaflet`。新增依赖必须在本段登记理由。
- **已登记依赖**：
  - `react` / `tailwindcss`：UI。
  - `zod`：唯一校验元数据来源。
  - `yaml`：读取 IP 池文件与统计落盘。
  - `jose`：会话 cookie 签名。
  - `leaflet`：地图底图与图层。
  - `node-wreq`：`ip-pool` 插件**保持整池常驻热连接**（预热/保活）所需——浏览器 **TLS/JA3/JA4 + HTTP2 指纹**与**钉 IP**
    （Rust 原生绑定，带 `linux-x64-gnu` 预编译；直连不通时配合 `IP_POOL_PROXY` 代理）。
    插件**不做业务抓取派发**（抓取属于独立 fetch 插件）。
  - `protobufjs`：`ip-pool` 插件 `fetchUpstreamProto` 动作把上游抓取结果编码为
    **length-delimited protobuf 帧**（与 SpaceXWay `fetch/proto/panel.proto` 同 schema），
    消除 JSON 解析开销与 base64 的 ~33% 膨胀（body 直接回原始字节）。
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

- **版本号起始 `0.0.1`，每次交付必须递增 `PATCH`（+1）**：`0.0.1` → `0.0.2` → …。
  只有用户明确要求时才能改动 `MAJOR` / `MINOR`。
- 版本号必须**同时**写入两处且保持一致：根 `package.json` 与 `apps/web/package.json`。
- 版本号**不得跳号、不得复用**；已发布过的版本号不得再修改。
- 每次改动必须在根 `CHANGELOG.md` 登记：
  - 结构固定为 `## [X.Y.Z] - YYYY-MM-DD`，条目分类固定为 `新增` / `变更` / `修复` / `移除` / `安全`（无内容可省略）。
  - 未交付的改动写在 `## [未发布]` 下；交付时把该段移到新版本号下并填日期。
  - **一次交付 = 一个版本号 = 一个提交**，不相关的改动不得塞进同一版本。
- 每个版本必须打 tag `vX.Y.Z`，与提交信息、CHANGELOG 中的版本号**严格一致**。

### 交付流程（必须逐条执行）

```bash
# 1. 改代码
# 2. 递增版本号（根 package.json 与 apps/web/package.json 两处，保持一致）
# 3. 更新 CHANGELOG.md（把 [未发布] 段落移到 [X.Y.Z] - 日期）
# 4. 门槛校验（缺一不可）
pnpm typecheck && pnpm test && pnpm build
# 5. 确认没有敏感文件进入暂存（有则立即停止）
git add -A
git diff --cached --name-only | grep -E '\.env$|config/vps\.yaml$|^apps/web/data/' && echo '发现敏感文件，停止！'
# 6. 提交 + 打 tag
git commit -m "vX.Y.Z <简述>"
git tag vX.Y.Z
# 7. 推送（必须带上 tag）
git push origin main --follow-tags
```

## 11. Git 与远程仓库

- 远程 `origin` = `https://github.com/spacelibres/vps.git`，主分支 **`main`**。
- 提交信息格式：**`vX.Y.Z <中文简述>`**（例：`v0.0.2 规则书补充版本控制与发布流程`）。
  一次提交只做一件事；**禁止** `update` / `fix` / `wip` 之类无信息量的信息。
- **网络**：本机直连 `github.com` 会超时，必须经本地 SOCKS5 代理（已在 `.git/config` 配置）：
  ```bash
  git config --local http.proxy socks5h://127.0.0.1:20170
  ```
- **认证**：禁止把 token 写进 `origin` URL 或任何被跟踪文件；推送时使用一次性认证，或
  `gh auth login --with-token` + `gh auth setup-git`。本机 `credential.helper=store` 可能是其它账号凭据，推送会被拒（403）。
- **推送前必须确认历史清晰**：`git log --oneline` 每个版本一条；`git tag` 与 `CHANGELOG.md` 的版本号一一对应。
- **绝不** `push --force` 已推送的 `main`。

## 12. 禁止提交的内容

`.env`、`config/vps.yaml`、`data/` 已被 `.gitignore` 忽略，**不得**用 `git add -f` 强行提交。提交前用 `git status` 目视确认。
