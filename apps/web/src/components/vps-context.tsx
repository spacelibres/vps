"use client";

import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { VpsTarget } from "@/sdk";

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
