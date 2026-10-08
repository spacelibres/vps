"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { VpsTarget } from "@/sdk";

/** URL 中记录「当前 VPS」的参数名（便于刷新 / 分享 / 深链）。 */
export const VEID_PARAM = "veid";

interface VpsContextValue {
  targets: readonly VpsTarget[];
  currentVeid: string;
  currentAlias: string;
  setCurrentVeid: (veid: string) => void;
}

const VpsContext = createContext<VpsContextValue | null>(null);

export function VpsProvider({
  targets,
  children,
}: {
  targets: VpsTarget[];
  children: ReactNode;
}) {
  const [currentVeid, setCurrentVeid] = useState(() => targets[0]?.veid ?? "");

  // 首次挂载：若 URL 带合法 `?veid=`，采用它（例如从总览卡片点进来 / 分享链接）。
  useEffect(() => {
    const fromUrl = new URL(window.location.href).searchParams.get(VEID_PARAM);
    if (fromUrl && targets.some((t) => t.veid === fromUrl)) setCurrentVeid(fromUrl);
    // 仅挂载时执行一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 选择变化时同步回 URL，保证刷新后仍是同一台。
  useEffect(() => {
    if (!currentVeid) return;
    const url = new URL(window.location.href);
    if (url.searchParams.get(VEID_PARAM) === currentVeid) return;
    url.searchParams.set(VEID_PARAM, currentVeid);
    window.history.replaceState(null, "", url.toString());
  }, [currentVeid]);

  const value = useMemo<VpsContextValue>(() => {
    const current = targets.find((t) => t.veid === currentVeid);
    return {
      targets,
      currentVeid,
      currentAlias: current?.alias ?? "",
      setCurrentVeid,
    };
  }, [targets, currentVeid]);

  return <VpsContext.Provider value={value}>{children}</VpsContext.Provider>;
}

export function useVps(): VpsContextValue {
  const ctx = useContext(VpsContext);
  if (!ctx) throw new Error("useVps 必须在 <VpsProvider> 内使用");
  return ctx;
}
