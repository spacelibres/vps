/** 最小日志接口，由宿主（apps/web）注入实现。 */
export interface Logger {
  debug(message: string, meta?: unknown): void;
  info(message: string, meta?: unknown): void;
  warn(message: string, meta?: unknown): void;
  error(message: string, meta?: unknown): void;
}

/** 默认实现：写入 console，便于独立运行与测试。 */
export const consoleLogger: Logger = {
  debug: (message, meta) => console.debug(`[debug] ${message}`, meta ?? ""),
  info: (message, meta) => console.info(`[info] ${message}`, meta ?? ""),
  warn: (message, meta) => console.warn(`[warn] ${message}`, meta ?? ""),
  error: (message, meta) => console.error(`[error] ${message}`, meta ?? ""),
};
