/**
 * 64clouds / KiwiVM REST API 的返回类型定义。
 *
 * 官方文档：https://api.64clouds.com/v1
 * 所有调用都会返回一个 `error` 字段，0 表示成功，非 0 时参考 `message`。
 */

/** 所有 API 响应共有的字段。 */
export interface ApiEnvelope {
  error: number;
  message?: string;
}

export interface PtrRecord {
  [ip: string]: string;
}

export interface NullrouteInfo {
  nullroute_timestamp: number;
  nullroute_duration_s: number;
  log: string;
}

/**
 * `getServiceInfo` 的返回。
 */
export interface ServiceInfo extends ApiEnvelope {
  vm_type: "ovz" | "kvm";
  hostname: string;
  node_alias: string;
  node_location: string;
  /** 节点位置 ID（如 USCA_2），部分账号返回。 */
  node_location_id?: string;
  /** 节点机房描述，部分账号返回。 */
  node_datacenter?: string;
  location_ipv6_ready: boolean;
  plan: string;
  plan_disk: number;
  plan_ram: number;
  plan_swap: number;
  os: string;
  email: string;
  plan_monthly_data: number;
  data_counter: number;
  monthly_data_multiplier: number;
  data_next_reset: number;
  ip_addresses: string[];
  private_ip_addresses: string[];
  /**
   * 被 DDoS 攻击时进入 nullroute 的 IP 信息。
   * 注意：不同账号/版本返回结构不同（对象或数组），故用宽松类型。
   */
  ip_nullroutes: Record<string, NullrouteInfo> | unknown[];
  /** 已挂载的 ISO #1（未挂载时为空字符串）。 */
  iso1: string;
  /** 已挂载的 ISO #2（当前不支持）。 */
  iso2: string;
  available_isos: string[];
  /** IPv6 SIT 隧道端点，部分账号返回。 */
  ipv6_sit_tunnel_endpoint?: string | null;
  plan_max_ipv6s: number;
  rdns_api_available: boolean;
  plan_private_network_available: boolean;
  location_private_network_available: boolean;
  ptr: PtrRecord;
  suspended: boolean;
  policy_violation: boolean;
  suspension_count: number;
  total_abuse_points: number;
  max_abuse_points: number;
}

/** OpenVZ 专有的实时状态。 */
export interface OvzStatus {
  vz_status: Record<string, unknown>;
  vz_quota: Record<string, unknown>;
  is_cpu_throttled: number;
  ssh_port: number;
}

/** KVM 专有的实时状态。 */
export interface KvmStatus {
  ve_status: "Starting" | "Running" | "Stopped";
  ve_mac1: string;
  ve_used_disk_space_b: number;
  ve_disk_quota_gb: number;
  is_cpu_throttled: number;
  is_disk_throttled: number;
  ssh_port?: number;
  live_hostname?: string;
  load_average?: string;
  mem_available_kb?: number;
  swap_total_kb?: number;
  swap_available_kb?: number;
  screendump_png_base64?: string;
}

/** `getLiveServiceInfo` = ServiceInfo + 实时状态（按 hypervisor 二选一）。 */
export type LiveServiceInfo = ServiceInfo & Partial<OvzStatus> & Partial<KvmStatus>;

export interface AvailableOs extends ApiEnvelope {
  installed: string;
  templates: string[];
}

export interface ReinstallOsResult extends ApiEnvelope {
  rootPassword: string;
  sshPort: number;
  sshKeys: string;
  sshKeysBrief: string;
  notificationEmail: string;
}

export interface SshKeysResult extends ApiEnvelope {
  ssh_keys_veid: string;
  ssh_keys_user: string;
  ssh_keys_preferred: string;
  shortened_ssh_keys_veid: string;
  shortened_ssh_keys_user: string;
  shortened_ssh_keys_preferred: string;
}

export interface ResetRootPasswordResult extends ApiEnvelope {
  password: string;
}

export interface Snapshot {
  fileName: string;
  os: string;
  description: string;
  size: number;
  md5: string;
  sticky: boolean;
  purgesIn: number;
  downloadLink: string;
  downloadLinkSSL: string;
}

export interface SnapshotListResult extends ApiEnvelope {
  snapshots: Snapshot[];
}

export interface SnapshotExportResult extends ApiEnvelope {
  token: string;
}

export interface SnapshotCreateResult extends ApiEnvelope {
  notificationEmail: string;
}

export interface Backup {
  backupToken: string;
  size: number;
  os: string;
  md5: string;
  timestamp: number;
}

/**
 * `backup/list` 的返回。
 * 真实 API 的 `backups` 是「以 token 为键的对象」，客户端已归一化成数组。
 */
export interface BackupListResult extends ApiEnvelope {
  backups: Backup[];
}

export interface Ipv6AddResult extends ApiEnvelope {
  assigned_subnet: string;
}

export interface PrivateIpListResult extends ApiEnvelope {
  available_ips: string[];
}

export interface PrivateIpAssignResult extends ApiEnvelope {
  assigned_ips: string[];
}

export interface MigrateLocationsResult extends ApiEnvelope {
  /** 当前节点 ID（如 "USCA_2"）。 */
  currentLocation: string;
  /** 可迁移到的节点 ID 列表。 */
  locations: string[];
  /** 节点 ID → 友好说明。 */
  descriptions: Record<string, string>;
  /** 节点 ID → 流量计费倍率。 */
  dataTransferMultipliers: Record<string, number>;
}

export interface MigrateStartResult extends ApiEnvelope {
  notificationEmail?: string;
  newIps?: string[];
}

export interface RateLimitStatus extends ApiEnvelope {
  remaining_points_15min: number;
  remaining_points_24h: number;
}

export interface SuspensionRecord {
  record_id: number;
  flag: string;
  is_soft: number;
  evidence_record_id: number;
  abuse_points: number;
}

export interface SuspensionDetails extends ApiEnvelope {
  suspension_count: number;
  total_abuse_points: number;
  max_abuse_points: number;
  /** 无挂起记录时该字段可能缺席。 */
  suspensions?: SuspensionRecord[];
  /** 证据：evidence_record_id → 全文；无挂起时可能缺席。 */
  evidence?: Record<string, string>;
}

export interface PolicyViolation {
  record_id: number;
  timestamp: number;
  suspend_at: number;
  flag: string;
  is_soft: number;
  abuse_points: number;
  evidence_data: string;
}

export interface PolicyViolationsResult extends ApiEnvelope {
  total_abuse_points: number;
  max_abuse_points: number;
  /** 无违规记录时该字段可能缺席。 */
  policy_violations?: PolicyViolation[];
}

/** 单个通知偏好项（嵌套结构里的叶子）。 */
export interface NotificationPreference {
  friendly_description: string;
  is_enabled: number;
  changed_timestamp: number;
  s_value: string;
}

export interface NotificationPreferencesResult extends ApiEnvelope {
  /** 分类 →（preference_id → 偏好详情）。注意是两层对象，不是扁平映射。 */
  email_preferences: Record<string, Record<string, NotificationPreference>>;
  notificationEmail?: string;
}

export interface SetNotificationPreferencesResult extends ApiEnvelope {
  submitted_email_preferences?: Record<string, number>;
  updated_email_preferences?: Record<string, number>;
  friendly_descriptions?: Record<string, string>;
}

/** `getRawUsageStats` / `getAuditLog` 的结构随账号而变，统一用宽松类型。 */
export type RawUsageStats = unknown;
export type AuditLog = unknown;

/** `basicShell/exec` 返回的命令退出码与输出。 */
export interface ShellExecResult extends ApiEnvelope {
  /** 被执行的命令退出状态码（成功时为 0）。 */
  error: number;
  message: string;
}

/** `basicShell/cd` 的返回。 */
export interface ShellCdResult extends ApiEnvelope {
  pwd: string;
}

/** `shellScript/exec` 的返回。 */
export interface ShellScriptResult extends ApiEnvelope {
  log: string;
}
