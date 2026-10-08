import { loadPoolRecords } from "./pool";
import type { HostPinFamily, HostPinRecord } from "./types";

/** 一次钉 IP 的结果（借鉴 GeoClaw 的 `HostPinResolveResult`）。 */
export interface HostPin {
  hostname: string;
  pinnedIp: string;
  record: HostPinRecord;
  /** 传给 node-wreq 的 DNS 覆盖：绕过系统解析，直连指定 IP。 */
  dns: { hosts: Record<string, string[]> };
}

export interface HostPinPoolOptions {
  hostname: string;
  poolFile: string;
  family?: "all" | HostPinFamily;
}

/**
 * 从池塘 YAML 加载 IP 并按**轮询**分配（绕过 DNS）。
 * 借鉴 `GeoClaw/src/fetch/HostPinPool.ts`。
 */
export class HostPinPool {
  private records: HostPinRecord[] | null = null;
  private index = 0;

  constructor(private readonly options: HostPinPoolOptions) {}

  size(): number {
    return this.load().length;
  }

  /** 取下一条记录（轮询）。 */
  nextRecord(): HostPinRecord {
    const list = this.load();
    if (list.length === 0) {
      throw new Error(`HostPinPool 为空：${this.options.hostname}`);
    }
    const record = list[this.index % list.length]!;
    this.index = (this.index + 1) % list.length;
    return record;
  }

  /** 为一次请求解析出钉住的 IP。 */
  resolveForUrl(_url: string): HostPin {
    const record = this.nextRecord();
    return {
      hostname: this.options.hostname,
      pinnedIp: record.ip,
      record,
      dns: { hosts: { [this.options.hostname]: [record.ip] } },
    };
  }

  private load(): HostPinRecord[] {
    if (!this.records) {
      const all = loadPoolRecords(this.options.poolFile);
      const family = this.options.family ?? "all";
      this.records = family === "all" ? all : all.filter((r) => r.family === family);
    }
    return this.records;
  }
}

let singleton: HostPinPool | null = null;

/** 进程内单例（按 hostname + 池文件）。 */
export function getHostPinPool(options: HostPinPoolOptions): HostPinPool {
  if (!singleton) singleton = new HostPinPool(options);
  return singleton;
}
