import { sortPlugins, type VpsPlugin } from "@/sdk";
import { LifecyclePlugin } from "./lifecycle";
import { InfoPlugin } from "./info";
import { OsPlugin } from "./os";
import { AccountPlugin } from "./account";
import { SnapshotPlugin } from "./snapshot";
import { BackupPlugin } from "./backup";
import { NetworkPlugin } from "./network";
import { SecurityPlugin } from "./security";
import { MigratePlugin } from "./migrate";
import { ShellPlugin } from "./shell";
import { NotificationsPlugin } from "./notifications";
import { ipPoolDescriptor } from "./ip-pool/descriptor";

/**
 * 全部插件的实例列表（**客户端安全**：不含服务端动作的实现依赖）。
 *
 * - VPS 类插件的 `index.ts` 本身是同构的，可直接引入。
 * - `ip-pool` 的动作依赖 `node:fs`，因此这里只引入它的**描述符**
 *   （元数据 + 视图）；动作在 `./server.ts` 里补齐。
 *
 * 新增一个插件：建 `plugins/<name>/` 目录，然后在下面 import + `new`/加入一行。
 */
export const plugins: VpsPlugin[] = [
  new LifecyclePlugin(),
  new InfoPlugin(),
  new OsPlugin(),
  new AccountPlugin(),
  new SnapshotPlugin(),
  new BackupPlugin(),
  new NetworkPlugin(),
  new SecurityPlugin(),
  new MigratePlugin(),
  new ShellPlugin(),
  new NotificationsPlugin(),
  ipPoolDescriptor,
];

/** 供导航按 order 排序展示。 */
export const sortedPlugins = sortPlugins(plugins);
