import { readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import { z } from "zod";
import type { VpsTarget } from "@/sdk";

const VpsEntrySchema = z.object({
  veid: z.coerce.string().min(1),
  api_key: z.string().min(1),
  alias: z.coerce.string().min(1),
});

const ConfigFileSchema = z.object({
  vps: z.array(VpsEntrySchema).min(1, "vps.yaml 至少需要配置一台 VPS"),
});

/** 一台 VPS 的完整凭据（含 api_key，仅在服务端使用）。 */
export interface VpsCredential extends VpsTarget {
  apiKey: string;
}

let cache: VpsCredential[] | null = null;

/** 配置文件路径，可用 VPS_CONFIG_FILE 覆盖。 */
function configFilePath(): string {
  return process.env.VPS_CONFIG_FILE ?? path.join(process.cwd(), "config", "vps.yaml");
}

/**
 * 从 `config/vps.yaml` 读取全部 VPS 凭据（带进程内缓存）。
 * 仅供服务端调用；api_key 绝不能出现在客户端。
 */
export function loadVpsCredentials(): VpsCredential[] {
  if (cache) return cache;
  const file = configFilePath();
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    throw new Error(
      `无法读取 VPS 配置文件：${file}\n请复制 config/vps.yaml.example 为 config/vps.yaml 并填入凭据。`,
    );
  }
  const parsed = ConfigFileSchema.parse(parse(raw));
  cache = parsed.vps.map((v) => ({ veid: v.veid, apiKey: v.api_key, alias: v.alias }));
  return cache;
}

/** 全部 VPS 的公开目标信息（可安全传给前端）。 */
export function getTargets(): VpsTarget[] {
  return loadVpsCredentials().map(({ veid, alias }) => ({ veid, alias }));
}

/** 取指定 VPS 的凭据。 */
export function getCredential(veid: string): VpsCredential {
  const found = loadVpsCredentials().find((c) => c.veid === veid);
  if (!found) throw new Error(`未找到 VPS ${veid} 的凭据`);
  return found;
}

/** 校验 veid 是否已配置。 */
export function isKnownVeid(veid: string): boolean {
  return loadVpsCredentials().some((c) => c.veid === veid);
}
