/**
 * 有界去重集合：容量上限 + 插入序淘汰最旧键（`Map` 保持插入序）。
 *
 * 用于 `ingest` 的事件幂等去重。原实现用无上限 `Set`，面板长时间运行后
 * `seenAttempts/seenRequests/seenFlightPaths` 无限增长，把进程内存顶到 PM2
 * `max_memory_restart` 触发重启，热池随之清零、出网 502。
 *
 * 去重只需覆盖「重试窗口」（秒级到分钟级），有界即可；淘汰最旧键不会影响
 * 新事件的幂等性。
 */
export class BoundedKeySet {
  private readonly capacity: number;
  private readonly map = new Map<string, true>();

  constructor(capacity: number) {
    this.capacity = capacity > 0 ? Math.floor(capacity) : 1;
  }

  has(key: string): boolean {
    return this.map.has(key);
  }

  /** 加入键；超出容量时按插入序淘汰最旧键。 */
  add(key: string): void {
    if (this.map.has(key)) return;
    this.map.set(key, true);
    while (this.map.size > this.capacity) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
  }

  clear(): void {
    this.map.clear();
  }

  get size(): number {
    return this.map.size;
  }
}
