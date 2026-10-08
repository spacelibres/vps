import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { getTargets } from "@/lib/config";

export default function PanelLayout({ children }: { children: ReactNode }) {
  const targets = getTargets();
  return <AppShell targets={targets}>{children}</AppShell>;
}
