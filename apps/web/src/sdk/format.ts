const UNITS = ["B", "KB", "MB", "GB", "TB", "PB"] as const;

/** 把字节数格式化成人类可读的字符串。 */
export function formatBytes(bytes: number | null | undefined, decimals = 2): string {
  if (bytes === null || bytes === undefined || Number.isNaN(bytes)) return "-";
  if (bytes === 0) return "0 B";
  const exponent = Math.min(
    Math.floor(Math.log(Math.abs(bytes)) / Math.log(1024)),
    UNITS.length - 1,
  );
  const value = bytes / Math.pow(1024, exponent);
  return `${value.toFixed(decimals)} ${UNITS[exponent]}`;
}

/**
 * KiwiVM 的流量字段需要乘以 `monthly_data_multiplier` 才是真实字节数。
 */
export function formatDataWithMultiplier(
  bytes: number | null | undefined,
  multiplier: number | null | undefined,
): string {
  if (bytes === null || bytes === undefined) return "-";
  return formatBytes(bytes * (multiplier ?? 1));
}

/** 把 UNIX 时间戳（秒）格式化成指定时区的可读字符串，默认浏览器本地时区。 */
export function formatUnixTime(ts: number | null | undefined): string {
  if (!ts) return "-";
  return new Date(ts * 1000).toLocaleString();
}

/** 计算距离某个 UNIX 时间戳还有多久（用于「流量将于 X 重置」）。 */
export function formatRelativeToNow(ts: number | null | undefined): string {
  if (!ts) return "-";
  const diffMs = ts * 1000 - Date.now();
  if (diffMs <= 0) return "已过期";
  return `还有 ${formatDuration(diffMs / 1000)}`;
}

/** 把秒数格式化成「3天4小时」这类字符串。 */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const days = Math.floor(s / 86400);
  const hours = Math.floor((s % 86400) / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const parts: string[] = [];
  if (days) parts.push(`${days}天`);
  if (hours) parts.push(`${hours}小时`);
  if (minutes && !days) parts.push(`${minutes}分`);
  return parts.length ? parts.join("") : `${s}秒`;
}

/** 计算已用百分比（0-100），无总量时返回 0。 */
export function percent(used: number, total: number): number {
  if (!total) return 0;
  return Math.min(100, Math.round((used / total) * 100));
}
