# 插件设计：IP 池管理 · 请求统计 · 弹道航线

- 日期：2026-10-08
- 状态：待评审
- 插件 id：`ip-pool`，名称：「IP 池 · 航线」
- 归属：本项目（VPS 管理面板）的一个插件；**借鉴** `GeoClaw/viz/flight-map` 与 `GeoClaw/src/fetch` 的做法，**不集成** GeoClaw。

## 1. 目标

在面板里做一个插件，用来**管理 kh.google.com 的 Google 前端 IP 池**、**统计每个 IP 的真实请求表现**，并以**弹道航线 + 请求日志**的形式可视化。

## 2. 范围 / 非目标

**做：**
- 加载并管理 IP 池（`kh.google.com.yaml`），按 `country → city → ip` 合并去重并计数。
- 接收**真实请求事件**（每次请求一条），累计每 IP / 每国家 / 每地区的统计。
- 弹道航线可视化 + 请求日志（按 IP 哈希着色）。
- 事件实时推送到浏览器（SSE）。

**不做（明确排除）：**
- **不发起业务抓取**（抓取派发属于独立的 fetch 插件）。插件只**消费**外部事件；仅后台保持整池**常驻热连接**（预热，见 §16）。
- **不集成 GeoClaw**：不内嵌、不移植其服务端、不连其 WS、不读其文件。
- **不碰 VPS / KiwiVM**：与那 13 台机器无关。

## 3. 数据模型（借鉴 `GeoClaw/src/fetch`）

### 3.1 入口数据

```ts
/** IP 池单条（= GeoClaw HostPinRecord；解析自 kh.google.com.yaml 的 ipv4/ipv6 两段） */
type HostPinRecord = {
  ip: string;
  family: "ipv4" | "ipv6";
  hostname?: string; city?: string; region?: string; country?: string;
  loc?: string;        // "lat,lng"
  org?: string; timezone?: string;
};

/** 每次「尝试」记录（= GeoClaw FetchAttemptRecord） */
type FetchAttemptRecord = {
  requestId: string; url: string; attempt: number; ip?: string;
  outcome: "success" | "http_error" | "transport_error" | "no_hot_ip";
  httpStatus?: number; durationMs: number; bytes?: number;
  city?: string; region?: string; country?: string; at: number;
};

/** 一次「业务请求」的最终结果（= GeoClaw FetchRequestRecord） */
type FetchRequestRecord = {
  requestId: string; url: string;
  outcome: "success" | "failed";
  attempts: number; totalDurationMs: number;
  finalIp?: string; finalStatus?: number; ipsUsed: string[]; bytes?: number; at: number;
};

/** 弹道起点（= GeoClaw FetchRouteOrigin） */
type FetchRouteOrigin = { lat: number; lng: number; city?: string; region?: string; country?: string; label?: string };
```

### 3.2 出口数据

```ts
/** 单 IP 累计统计（= GeoClaw IpFetchStatRow） */
type IpFetchStatRow = {
  requests: number; success: number; failed: number;
  totalBytes: number; totalDurationMs: number; avgDurationMs?: number;
  city?: string; region?: string; country?: string; loc?: string;
};

/** 计数器桶（= GeoClaw FetchCounterBucket） */
type FetchCounterBucket = {
  attempts: number; success: number; failed: number;
  totalDurationMs: number; totalBytes?: number; avgDurationMs?: number;
};

/** 弹道航线（= GeoClaw FetchFlightPath） */
type FetchFlightPath = {
  requestId: string; url: string; targetHostname: string;
  dnsMode: "hostpin" | "system";
  pinnedIp?: string;
  waypoints: FlightWaypoint[]; legs: FlightLeg[];
  totalDurationMs: number; bodyBytes?: number; httpStatus?: number;
  viaHot?: boolean; http2?: boolean;
};
type FlightWaypoint = {
  role: "origin" | "proxy" | "target";
  lat: number; lng: number; label: string;
  city?: string; region?: string; country?: string;
  ip?: string; hostname?: string;
};
type FlightLeg = { fromIndex: number; toIndex: number; durationMs: number };
```

### 3.3 池子聚合（本插件新增，flight-map 没有）

```ts
type PoolAggregate = {
  country: string;
  total: number;                     // 该国家 IP 数
  cities: {
    city: string;
    total: number;
    ips: HostPinRecord[];            // 同一 IP 只出现一次（按 ip 去重）
  }[];
};
```

## 4. 入口（三种，全部支持）

### 4.1 A. HTTP 接入
`POST /api/plugins/ip-pool/actions/ingest`

```jsonc
{
  // needsVps=false：不需要 veid，路由不校验（带不带都忽略）
  "input": {
    "hostname": "kh.google.com",
    "origin": { "lat": 0, "lng": 0, "label": "…" },   // 可选，首次设置
    "attempts": [ /* FetchAttemptRecord[] */ ],
    "requests": [ /* FetchRequestRecord[] */ ],
    "flightPaths": [ /* FetchFlightPath[] */ ]         // 可选：调用方直接给现成航路
  }
}
```

- 幂等：按 `requestId` 去重；`attempts` 按 `(requestId, attempt)` 去重。
- 若未提供 `flightPaths`，由 `attempts`/`requests` **在后端合成**航路（见 §6）。

### 4.2 B. 文件快照
插件启动时与之后定时读取（可配置多个来源）：
- **池文件**：`kh.google.com.yaml`（默认项目根，可用配置覆盖）。
- **统计快照**：GeoClaw 同格式 YAML（`{hostname, updatedAt, ips: Record<ip, IpFetchStatRow>}`），用于「历史累计」或冷启动回填。
- **事件快照**（可选）：JSONL，每行一个 `FetchAttemptRecord`/`FetchRequestRecord`。

> 文件读取只用于**回填/对齐**，不替代实时事件；解析结果合并进内存 Store。

### 4.3 C. 实时推送（出口方向）
`GET /api/plugins/ip-pool/actions/stream`（SSE）：把内存 Store 的增量推给浏览器。
消息类型（借鉴 flight-map 的 WS 语义，改用 SSE）：
`snapshot`（首帧全量）、`pulse`（新弹道）、`stats`（统计增量）、`poolStatus`（池子概览）。

> **为什么用 SSE 不用 WS**：Next.js App Router 的 route handler 不支持原生 WebSocket；SSE 是同样语义下最省事、且能穿透现有密码门中间件的方案。
> **注意**：`EventSource` 只能发 **GET** 且不能自定义请求头，但会带同源 Cookie → 能过密码门。因此该动作 `method: "GET"`，且动作路由需要同时导出 `GET`（见 §9）。

## 5. 存储（内存 Store）

一个进程内单例，按 `hostname` 分域：

- `pool: HostPinRecord[]` + 索引 `byIp`（来自 §4.2 池文件）
- `geo: Map<ip, IpGeoInfo>`（池的地理信息；事件缺 geo 时用它补全）
- `stats.byIp: Map<ip, IpFetchStatRow>`、`byCountry`、`byRegion`（§3.2）
- `recent.attempts`、`recent.requests`、`recent.flightPaths`（环形缓冲，上限可配）
- `revision`（每次记账 +1，供 SSE 增量判断）
- `aggregate: PoolAggregate[]`（§3.3，池文件加载时计算一次并缓存）

**持久化（必须）**：统计**必须落盘**，不能纯内存。
- 位置：`apps/web/data/ip-stats/<hostname>.yaml`（格式同 §4.2，已 gitignore）。
- 策略：启动时**回填** → 每次记账后**去抖（~2s）**写盘，另加**定时兜底刷盘**（默认 15s，可配）。
- 原子性：写「临时文件 + rename」，避免写一半掉电损坏。

## 6. 航路合成（没有现成 `flightPaths` 时）

按 GeoClaw `buildFetchFlightPath` 的思路：
- 起点：`origin`（§3.1）。未配置时用占位并提示。
- 途经：`pinnedIp`（或 `finalIp`）对应的池记录 → 目标航点（`role: "target"`，带 city/country/loc）。
- 若配置了代理：插入 `role: "proxy"` 航点。
- `legs`：相邻航点耗时（按 attempt 的 `durationMs` 拆分；缺失则均分 `totalDurationMs`）。
- 输出 `FetchFlightPath` 存入 `recent.flightPaths`。

## 7. 弹道与配色（借鉴 `arc.js`）

- **弹道几何**：大圆插值 + 拱高（`leoOrbitBow`），参数：`earthRadiusKm=6371`、`leoAltitudeMinKm=12`、`leoAltitudeMaxKm=48`、`orbitDisplayExaggeration=2.5`、`steps∈[16,48]`。
- **配色**：`color = hsl(hash(ip) * 137.508° % 360, s, l)`；`s/l` 由 `hash % 3` 分档 → **每个 IP 颜色稳定且互不相同**。
- **动画**：`routeDrawMs` 绘制 → `routeHoldMs` 停留 → `routeFadeMs` 淡出。

## 8. 界面

单个插件视图（`/plugins/ip-pool`），暗色地图 + 可拖拽侧栏：

- **地图**：Leaflet + `world` 底图（暗色）；灰色骨架 = 池子里所有目标点（可开关）；弹道弧 = 最近的请求事件。
- **侧栏（可折叠块）**：
  1. **池子聚合**：`国家 → 城市 → IP` 树，带计数；支持搜索/按国家筛选/按 ipv4·ipv6 筛选。
  2. **IP 统计表**：`# / 族 / IP / 请求 / 成功 / 失败 / 字节 / 均耗时`（点击某行只显示该 IP 的弹道）。
  3. **请求日志**：与弹道联动、清晰可读（时间 / 目标 IP / 地区 / 状态 / 耗时 / 字节）。
  4. **概览**：总请求、成功率、RPS 心跳波峰（借鉴 flight-map 的 canvas）。
- 未接入事件时，各块显示空态提示，不显示假数据。

## 9. 框架适配（对现有插件框架的三处扩展）

1. **`PluginAction.needsVps?: boolean`**（默认 `true`）
   为 `false` 时：动作路由**不要求也不校验 `veid`**；注入的 `ctx.client` / `ctx.clientFor` 被调用即抛「该动作不需要 VPS」。
   → 现有插件行为不变。
2. **`PluginAction.raw?: boolean`**（默认 `false`）
   为 `true` 时：`run` 返回 `Response`，路由**直接透传**（用于 SSE 等流式响应），不做 JSON 包装。
3. **动作路由新增 `GET` 处理器**
   现有 `/api/plugins/[pluginId]/actions/[actionId]` 只导出 `POST`。为支持 SSE（`EventSource` 只能 GET），该路由同时导出 `GET` 与 `POST`，由动作的 `method` 字段决定放行哪个。
   → 现有插件行为不变（它们都是 `POST`）。

其余不动：`PluginViewProps` 仍传 `targets/currentVeid/onSelectVps`，本插件视图忽略即可（不使用 `PluginPage`，因为不需要 VPS 选择器）。

## 10. 安全

- 仍由现有中间件（密码门）保护：SSE 与 ingest 都走 `/api/**`，未登录一律 401。
- `ingest` 属于**写入**接口：可选要求额外 `INGEST_TOKEN`（env），未配置则仅依赖登录态。
- 池文件与落盘统计都在项目内，`kh.google.com.yaml` / `data/` 均在 `.gitignore` 或本地产物范围内。

## 11. 目录结构

```
apps/web/src/plugins/ip-pool/
├── index.ts          # 插件类 + 动作：ingest / stats / pool / snapshot / resetStats / stream(SSE)
├── descriptor.ts     # 客户端安全：元数据 + 视图
├── view.tsx          # "use client" 视图：地图 + 侧栏（聚合树/统计表/日志/概览）
├── types.ts          # 领域类型（客户端安全）
├── store.ts          # 内存 Store（池/统计/最近事件/聚合/revision/resetEpoch）+ 落盘
├── pool.ts           # kh.google.com.yaml 解析 + 聚合（PoolCountryNode[]）
├── snapshot.ts       # 文件快照读取（JSONL 事件 + 统计 YAML）
├── flight.ts         # 航路合成 + 弹道几何 + 配色（纯函数）
├── pulses.ts         # 脉冲骨架 / 激活 / 剪枝（纯函数）
├── geo.ts / origin.ts# 地理点与弹道起点（纯逻辑）
├── hot-pool.ts       # 整池常驻热连接池（保持连接 + 经热连接派发单次请求）
├── warm.ts           # 热池单例 + 面板打开即整池预热 + 取池实例
├── dispatch.ts       # 「经热池派发」作业（外部触发，复用热连接出网）
├── plan.ts           # 派发调度（纯逻辑，可单测）
├── sse.ts            # SSE 实时流（snapshot / pulse / metrics / reset）
├── net.ts            # 读 /proc/net/dev 网卡累计流量
├── map-layer.ts / bing.ts # Leaflet 脉冲图层 / Bing 底图（回退 CARTO dark）
└── <name>.test.ts    # 纯逻辑单测
```

## 12. 测试与验证

- **纯函数单测**（vitest）：
  - `pool.ts`：解析 fixture yaml → 计数、按 ip 去重、`country→city→ip` 聚合正确。
  - `flight.ts`：同 IP 配色稳定、不同 IP 不同色；同起止点弧线端点与拱高符合预期。
  - `ingest.ts`：重复 `requestId` 幂等；统计累加与 `avgDurationMs` 正确。
- **端到端**：`POST ingest` → `GET stats` 数值正确 → SSE 收到 `pulse`/`stats`。
- **构建**：`pnpm typecheck` / `pnpm test` / `pnpm build` 全绿。

## 13. 交付计划（分期）

1. **骨架 + 数据层**：`pool.ts` / `store.ts` / `flight.ts` + 框架两处扩展（`needsVps`/`raw`）。
2. **入口**：`ingest.ts`（HTTP）+ `snapshot.ts`（文件）+ 动作注册。
3. **出口**：`stats`、`pool`、`stream`(SSE)。
4. **界面**：地图 + 侧栏四块 + 与弹道联动。
5. **可选**：落盘（`data/ip-stats/*.yaml`）、`INGEST_TOKEN`、心跳波峰。

## 14. 已确认

- **池文件**：就用**本项目根**的 `kh.google.com.yaml`（3801 条）。代码仍按 `hostname` 参数化，便于以后扩展。
- **统计**：**必须落盘**（见 §5），不允许纯内存。
- **底图**：**暗色底图**（无 key，如 CARTO dark）即可。
- **入口**：A（HTTP `ingest`）+ B（文件快照）+ C（SSE 实时推）三者全支持。
- **事件来源**：本插件**不发请求**；由外部发送方推送（发送方不在本插件范围内）。

## 15. 实现补充（与初稿的差异，已定稿）

- **客户端/服务端拆分**：`ip-pool` 的动作依赖 `node:fs`，不能进浏览器包。因此：
  - `plugins/index.ts` 改为**客户端安全**（对 ip-pool 只引入 `descriptor.ts`：元数据 + 视图）；
  - 新增 `plugins/server.ts`（仅 API 路由用）为 ip-pool 补齐 `actions`；
  - 纯逻辑拆到客户端安全的 `geo.ts` / `types.ts`。
- **接口瘦身**：`stats` **不再返回庞大的池子聚合**（降到 1KB 级），聚合改由 `pool` 动作单独提供（首次加载一次）。SSE 的 `snapshot` 也不含聚合。
- **落盘位置**：`apps/web/data/ip-stats/<hostname>.yaml`（已 gitignore；原子写：临时文件 + rename）。
- **依赖**：新增 `leaflet`（暗色底图用 CARTO tiles，无 key）。
- **已验证**：`tsc` 无错；vitest 23/23 通过；`next build` 通过；真实链路 —— `pool` 返回 3801 个 IP / 40 国 / 106 城市；`ingest` 幂等计数正确；`stats` 汇总与逐 IP 行正确且**自动从池文件回填地理位置**；落盘与重启回填正常；SSE 正常下发 `hello` / `snapshot`。

## 16. 变更记录

### 2026-10-08：移除测试工具，ip-pool 收敛为「管理 + 统计」

- **删除**本地抓取/测试入口：`fetch`（抓取一次）、`fetchBatch`（全池抓取）、`batchStatus`（全池抓取进度）
  三个动作及其实现（`fetch.ts` / `host-pin.ts` / `concurrency.ts` / `hot-picker.ts`，以及 `batch.ts` 的作业机制与
  `hot-pool.ts` 的 `probe`/`pickHot` 派发方法）。测试/压测一律在**系统之外**进行
  （外部发送方经 `ingest` 接入事件）。
- **保留**整池常驻热连接（`hot-pool.ts` + `warm.ts`）：面板打开即在后台预热整池，
  为可视化提供「绿色通道」热状态；`IP_POOL_AUTO_WARM=0` 可关闭。
- 移除面板上常驻的「全池抓取进度」卡片。
- 新增 `resetStats`（重置统计）动作：清空所有计数与最近事件并落盘，经 SSE `reset` 广播到各客户端。

### 2026-10-08：新增「经热池派发」（dispatch）

- 外部（本机）可 `POST dispatch { url?, count }` 触发一次作业：服务端复用**已预热的常驻热连接**
  （绿色通道）对 `url` 发起 `count` 次请求，结果写入统计 + 生成弹道（SSE 推送）；
  后台异步运行，`GET dispatchStatus` 查进度。
- 只走热 IP；某 IP 无热连接直接报错（不做冷建连）。每个热 IP 一个 worker。
- `hot-pool.ts` 重新提供一个「经热连接发一次请求」的原语 `dispatch()`（v0.0.27 删掉的是作业机制，不是这个原语）。
- 这不是插件内的测试入口：它由**外部**触发，插件本身不自循环发请求。

### 2026-10-08：dispatch 改为有界并发

- 实测：单条复用连接 ~52ms；一次铺开全部 3458 worker 时每个请求被拉到 ~6.5s，总吞吐反而只有 ~490 请求/秒；
  吞吐在 ~200-400 并发见顶（~1150 请求/秒）。
- 改：worker 数 = `min(cap, count, 热 IP 数)`，worker 从共享队列取请求、按下标**轮询整张热 IP 表**
  （所有热 IP 都参与），在飞数有界。`concurrency`（输入）或 `IP_POOL_DISPATCH_CONCURRENCY`（默认 256）控制上限。

### 2026-10-08：航线配色回归 flight-map

- 移除「热连接一律画绿色」的覆盖（整池预热后所有弹道都变一种绿）。
- 与参照工程一致：未激活=灰色虚线骨架；激活=按 IP 哈希取**本 IP 颜色** + 流动虚线。
  热/冷仅作为表格与 HUD 的状态，不再影响线色（`hot-pool` 仍保留热状态供显示）。
