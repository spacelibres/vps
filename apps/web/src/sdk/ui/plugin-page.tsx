"use client";

import type { ReactNode } from "react";
import type { PluginViewProps } from "../plugin/types";
import { Select } from "./primitives";

/**
 * 插件页面的统一外壳：标题 + 「当前 VPS」选择器 + 内容区。
 * 插件视图通常以它开头，从而共享一致的布局与 VPS 切换体验。
 */
export function PluginPage({
  title,
  description,
  targets,
  currentVeid,
  onSelectVps,
  toolbar,
  children,
}: PluginViewProps & {
  title: string;
  description?: string;
  toolbar?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">{title}</h1>
          {description && <p className="mt-0.5 text-sm text-neutral-500">{description}</p>}
        </div>
        <div className="flex items-center gap-2">
          {toolbar}
          <label className="flex items-center gap-2 text-sm">
            <span className="text-xs text-neutral-500">当前 VPS</span>
            <Select
              value={currentVeid}
              onChange={(e) => onSelectVps(e.target.value)}
              className="min-w-48"
            >
              {targets.map((t) => (
                <option key={t.veid} value={t.veid}>
                  {t.alias}（{t.veid}）
                </option>
              ))}
            </Select>
          </label>
        </div>
      </header>
      {children}
    </div>
  );
}
