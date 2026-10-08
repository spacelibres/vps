import {
  KiwiVmClient,
  TransportError,
  consoleLogger,
  type KiwiVmTransport,
  type PluginContext,
} from "@/sdk";
import { getCredential, getTargets } from "./config";

const API_BASE = process.env.KIWIVM_API_BASE ?? "https://api.64clouds.com/v1";
const MIN_INTERVAL_MS = Number(process.env.KIWIVM_MIN_INTERVAL_MS ?? 120);

/**
 * 串行队列：保证任意两次出站 API 调用之间至少间隔 {@link MIN_INTERVAL_MS} 毫秒。
 * KiwiVM 对短时间内的密集调用会丢请求，这里用最小间隔 + 串行化来规避。
 */
class SerialQueue {
  private tail: Promise<unknown> = Promise.resolve();
  private lastAt = 0;

  run<T>(task: () => Promise<T>): Promise<T> {
    const next = this.tail.then(async () => {
      const wait = this.lastAt + MIN_INTERVAL_MS - Date.now();
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      this.lastAt = Date.now();
      return task();
    });
    this.tail = next.catch(() => undefined);
    return next;
  }
}

const queue = new SerialQueue();

/**
 * 创建一个绑定到某把 api_key 的传输层实现。
 * 用 POST + 表单编码发送（与官方 curl 示例一致），并把 api_key 作为参数附加。
 */
export function createTransport(apiKey: string): KiwiVmTransport {
  return (endpoint, params) =>
    queue.run(async () => {
      const body = new URLSearchParams();
      for (const [key, value] of Object.entries(params)) {
        if (value === undefined || value === null) continue;
        body.append(key, typeof value === "string" ? value : String(value));
      }
      body.append("api_key", apiKey);

      const res = await fetch(`${API_BASE}/${endpoint}`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body,
        cache: "no-store",
      });

      if (!res.ok) {
        throw new TransportError(
          `HTTP ${res.status} ${res.statusText}`,
          endpoint,
          res.status,
        );
      }

      const text = await res.text();
      try {
        return JSON.parse(text) as unknown;
      } catch {
        throw new TransportError("API 返回的不是合法 JSON", endpoint, res.status);
      }
    });
}

let factory: ((veid: string) => KiwiVmClient) | null = null;

/** 惰性创建、并按 veid 缓存客户端实例。 */
function getClientFactory(): (veid: string) => KiwiVmClient {
  if (factory) return factory;
  const clients = new Map<string, KiwiVmClient>();
  factory = (veid: string) => {
    const existing = clients.get(veid);
    if (existing) return existing;
    const cred = getCredential(veid);
    const client = new KiwiVmClient(createTransport(cred.apiKey), veid);
    clients.set(veid, client);
    return client;
  };
  return factory;
}

/** 取指定 VPS 的客户端（进程内按 veid 缓存）。 */
export function getClient(veid: string): KiwiVmClient {
  return getClientFactory()(veid);
}

/** 为一个「不需要 VPS」的插件动作构造 `PluginContext`（`client` 不可用）。 */
export function buildVpslessPluginContext(): PluginContext {
  const unavailable = () => {
    throw new Error("该动作 needsVps=false，未提供 VPS 客户端");
  };
  const client = new Proxy({} as KiwiVmClient, { get: unavailable });
  return {
    client,
    clientFor: unavailable as unknown as (veid: string) => KiwiVmClient,
    targets: getTargets(),
    logger: consoleLogger,
  };
}

/** 为一次插件调用构造 `PluginContext`。 */
export function buildPluginContext(veid: string): PluginContext {
  const clientFor = getClientFactory();
  return {
    client: clientFor(veid),
    clientFor,
    targets: getTargets(),
    logger: consoleLogger,
  };
}
