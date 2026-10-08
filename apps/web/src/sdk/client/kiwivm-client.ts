import { KiwiVmError, envelopeError, envelopeMessage } from "../errors";
import type {
  AuditLog,
  AvailableOs,
  Backup,
  BackupListResult,
  Ipv6AddResult,
  LiveServiceInfo,
  MigrateLocationsResult,
  MigrateStartResult,
  NotificationPreferencesResult,
  PolicyViolationsResult,
  PrivateIpAssignResult,
  PrivateIpListResult,
  RateLimitStatus,
  RawUsageStats,
  ReinstallOsResult,
  ResetRootPasswordResult,
  ServiceInfo,
  SetNotificationPreferencesResult,
  ShellCdResult,
  ShellExecResult,
  ShellScriptResult,
  SnapshotCreateResult,
  SnapshotExportResult,
  SnapshotListResult,
  SshKeysResult,
  SuspensionDetails,
} from "../api/types";

/**
 * 传输层：只负责「把一个 endpoint + 参数发出去，拿回解析后的 JSON」。
 * 鉴权、base url、限流、重试等 IO 细节由宿主注入的实现负责。
 */
export interface KiwiVmTransport {
  (endpoint: string, params: Record<string, unknown>): Promise<unknown>;
}

/**
 * 把 `backup/list` 的真实返回（`token → 备份` 的对象）归一化成数组。
 * 官方文档写的是数组，但实际返回是对象映射；已在客户端统一处理。
 */
export function normalizeBackups(value: unknown): Backup[] {
  if (Array.isArray(value)) return value as Backup[];
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, Omit<Backup, "backupToken">>).map(
      ([backupToken, backup]) => ({ ...backup, backupToken }),
    );
  }
  return [];
}

/**
 * KiwiVM API 客户端。
 *
 * 一个实例绑定一台 VPS（veid）。方法名与官方 endpoint 一一对应，
 * 返回值已做类型化。当 API 返回 `error != 0` 时抛出 {@link KiwiVmError}。
 *
 * 该类不包含任何 IO：所有网络请求都通过构造时注入的 {@link KiwiVmTransport} 完成，
 * 因此可以在测试里注入假传输层。
 */
export class KiwiVmClient {
  constructor(
    private readonly transport: KiwiVmTransport,
    /** 该客户端绑定的 VPS ID。 */
    readonly veid: string,
  ) {}

  /** 直接调用任意 endpoint（逃生通道，供插件调用尚未封装的接口）。 */
  async call<T = unknown>(endpoint: string, params: Record<string, unknown> = {}): Promise<T> {
    const res = await this.transport(endpoint, { veid: this.veid, ...params });
    const code = envelopeError(res);
    if (code !== 0) {
      throw new KiwiVmError(code, envelopeMessage(res), endpoint);
    }
    return res as T;
  }

  /**
   * 调用 `error` 字段被复用为「命令退出码」的接口（目前仅 basicShell/exec）。
   * 不做 envelope 校验，把原始返回交给调用方解释。
   */
  async callRaw<T = unknown>(endpoint: string, params: Record<string, unknown> = {}): Promise<T> {
    const res = await this.transport(endpoint, { veid: this.veid, ...params });
    return res as T;
  }

  // ── 生命周期 ─────────────────────────────────────────────
  start(): Promise<void> {
    return this.call("start");
  }

  stop(): Promise<void> {
    return this.call("stop");
  }

  restart(): Promise<void> {
    return this.call("restart");
  }

  /** 强制停止卡死的 VPS（未保存数据会丢失）。 */
  kill(): Promise<void> {
    return this.call("kill");
  }

  // ── 信息 / 监控 ──────────────────────────────────────────
  getServiceInfo(): Promise<ServiceInfo> {
    return this.call<ServiceInfo>("getServiceInfo");
  }

  /** 注意：官方文档说明该调用最长可能需要 15 秒。 */
  getLiveServiceInfo(): Promise<LiveServiceInfo> {
    return this.call<LiveServiceInfo>("getLiveServiceInfo");
  }

  getRawUsageStats(): Promise<RawUsageStats> {
    return this.call<RawUsageStats>("getRawUsageStats");
  }

  getAuditLog(): Promise<AuditLog> {
    return this.call<AuditLog>("getAuditLog");
  }

  getRateLimitStatus(): Promise<RateLimitStatus> {
    return this.call<RateLimitStatus>("getRateLimitStatus");
  }

  // ── 操作系统 / ISO ───────────────────────────────────────
  getAvailableOS(): Promise<AvailableOs> {
    return this.call<AvailableOs>("getAvailableOS");
  }

  reinstallOS(os: string): Promise<ReinstallOsResult> {
    return this.call<ReinstallOsResult>("reinstallOS", { os });
  }

  /** 设置要启动的 ISO 镜像。调用后需完全关机并重启。 */
  mountIso(iso: string): Promise<void> {
    return this.call("iso/mount", { iso });
  }

  /** 卸载 ISO，恢复从主存储启动。调用后需完全关机并重启。 */
  unmountIso(): Promise<void> {
    return this.call("iso/unmount");
  }

  // ── SSH keys / root 密码 ─────────────────────────────────
  updateSshKeys(sshKeys: string): Promise<void> {
    return this.call("updateSshKeys", { ssh_keys: sshKeys });
  }

  getSshKeys(): Promise<SshKeysResult> {
    return this.call<SshKeysResult>("getSshKeys");
  }

  resetRootPassword(): Promise<ResetRootPasswordResult> {
    return this.call<ResetRootPasswordResult>("resetRootPassword");
  }

  // ── 主机名 / 反向解析 ────────────────────────────────────
  setHostname(newHostname: string): Promise<void> {
    return this.call("setHostname", { newHostname });
  }

  setPTR(ip: string, ptr: string): Promise<void> {
    return this.call("setPTR", { ip, ptr });
  }

  // ── 快照 ─────────────────────────────────────────────────
  snapshotCreate(description?: string): Promise<SnapshotCreateResult> {
    return this.call<SnapshotCreateResult>("snapshot/create", { description });
  }

  snapshotList(): Promise<SnapshotListResult> {
    return this.call<SnapshotListResult>("snapshot/list");
  }

  snapshotDelete(snapshot: string): Promise<void> {
    return this.call("snapshot/delete", { snapshot });
  }

  snapshotRestore(snapshot: string): Promise<void> {
    return this.call("snapshot/restore", { snapshot });
  }

  snapshotToggleSticky(snapshot: string, sticky: 0 | 1): Promise<void> {
    return this.call("snapshot/toggleSticky", { snapshot, sticky });
  }

  snapshotExport(snapshot: string): Promise<SnapshotExportResult> {
    return this.call<SnapshotExportResult>("snapshot/export", { snapshot });
  }

  snapshotImport(sourceVeid: string, sourceToken: string): Promise<void> {
    return this.call("snapshot/import", { sourceVeid, sourceToken });
  }

  // ── 自动备份 ────────────────────────────────────────────
  async backupList(): Promise<BackupListResult> {
    const res = await this.call<Omit<BackupListResult, "backups"> & { backups?: unknown }>(
      "backup/list",
    );
    return { ...res, backups: normalizeBackups(res.backups) };
  }

  backupCopyToSnapshot(backupToken: string): Promise<void> {
    return this.call("backup/copyToSnapshot", { backupToken });
  }

  // ── 网络 ─────────────────────────────────────────────────
  ipv6Add(): Promise<Ipv6AddResult> {
    return this.call<Ipv6AddResult>("ipv6/add");
  }

  ipv6Delete(ip: string): Promise<void> {
    return this.call("ipv6/delete", { ip });
  }

  privateIpGetAvailableIps(): Promise<PrivateIpListResult> {
    return this.call<PrivateIpListResult>("privateIp/getAvailableIps");
  }

  privateIpAssign(ip?: string): Promise<PrivateIpAssignResult> {
    return this.call<PrivateIpAssignResult>("privateIp/assign", { ip });
  }

  privateIpDelete(ip: string): Promise<void> {
    return this.call("privateIp/delete", { ip });
  }

  // ── 迁移 / 克隆 ──────────────────────────────────────────
  migrateGetLocations(): Promise<MigrateLocationsResult> {
    return this.call<MigrateLocationsResult>("migrate/getLocations");
  }

  migrateStart(location: string | number): Promise<MigrateStartResult> {
    return this.call<MigrateStartResult>("migrate/start", { location });
  }

  cloneFromExternalServer(
    externalServerIP: string,
    externalServerSSHport: number,
    externalServerRootPassword: string,
  ): Promise<void> {
    return this.call("cloneFromExternalServer", {
      externalServerIP,
      externalServerSSHport,
      externalServerRootPassword,
    });
  }

  // ── Shell ────────────────────────────────────────────────
  basicShellCd(currentDir: string, newDir: string): Promise<ShellCdResult> {
    return this.call<ShellCdResult>("basicShell/cd", { currentDir, newDir });
  }

  basicShellExec(command: string): Promise<ShellExecResult> {
    return this.callRaw<ShellExecResult>("basicShell/exec", { command });
  }

  shellScriptExec(script: string): Promise<ShellScriptResult> {
    return this.call<ShellScriptResult>("shellScript/exec", { script });
  }

  // ── 挂起 / 违规 ──────────────────────────────────────────
  getSuspensionDetails(): Promise<SuspensionDetails> {
    return this.call<SuspensionDetails>("getSuspensionDetails");
  }

  unsuspend(recordId: number): Promise<void> {
    return this.call("unsuspend", { record_id: recordId });
  }

  getPolicyViolations(): Promise<PolicyViolationsResult> {
    return this.call<PolicyViolationsResult>("getPolicyViolations");
  }

  resolvePolicyViolation(recordId: number): Promise<void> {
    return this.call("resolvePolicyViolation", { record_id: recordId });
  }

  // ── 通知偏好 ─────────────────────────────────────────────
  getNotificationPreferences(): Promise<NotificationPreferencesResult> {
    return this.call<NotificationPreferencesResult>("kiwivm/getNotificationPreferences");
  }

  setNotificationPreferences(
    preferences: Record<string, number>,
  ): Promise<SetNotificationPreferencesResult> {
    return this.call<SetNotificationPreferencesResult>("kiwivm/setNotificationPreferences", {
      json_notification_preferences: JSON.stringify(preferences),
    });
  }
}
