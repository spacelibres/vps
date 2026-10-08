import type { ApiEnvelope } from "./api/types";

/**
 * KiwiVM API 返回 `error != 0` 时抛出的统一错误。
 */
export class KiwiVmError extends Error {
  readonly code: number;
  readonly endpoint: string;

  constructor(code: number, message: string, endpoint: string) {
    super(message || `KiwiVM API 返回错误码 ${code}`);
    this.name = "KiwiVmError";
    this.code = code;
    this.endpoint = endpoint;
  }

  /** 是否是可预期的业务错误（能拿到 API 错误码）。 */
  static isKiwiVmError(err: unknown): err is KiwiVmError {
    return err instanceof KiwiVmError;
  }
}

/** 网络 / 传输层面的错误（连不上、超时、返回非 JSON）。 */
export class TransportError extends Error {
  readonly endpoint: string;
  readonly status?: number;

  constructor(message: string, endpoint: string, status?: number) {
    super(message);
    this.name = "TransportError";
    this.endpoint = endpoint;
    this.status = status;
  }
}

/** 从 API 返回体中提取错误码，缺省视为 0。 */
export function envelopeError(res: unknown): number {
  if (res && typeof res === "object" && "error" in res) {
    const value = (res as ApiEnvelope).error;
    return typeof value === "number" ? value : 0;
  }
  return 0;
}

/** 从 API 返回体中提取 message。 */
export function envelopeMessage(res: unknown): string {
  if (res && typeof res === "object" && "message" in res) {
    const value = (res as ApiEnvelope).message;
    return typeof value === "string" ? value : "";
  }
  return "";
}
