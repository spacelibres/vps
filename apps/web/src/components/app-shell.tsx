"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import type { VpsTarget } from "@/sdk";
import { Button } from "@/sdk/ui";
import { sortedPlugins } from "@/plugins";
import { VpsProvider, useVps } from "./vps-context";

const navItemClass = (active: boolean) =>
  `flex items-center gap-2 rounded-md px-3 py-2 text-sm transition ${
    active
      ? "bg-blue-50 font-medium text-blue-700 dark:bg-blue-950 dark:text-blue-300"
      : "text-neutral-600 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800"
  }`;

function NavLinks() {
  const pathname = usePathname();
  const { currentVeid } = useVps();
  // 带上当前 VPS，切换页面也能保持选择（刷新/分享不丢）。
  const withVeid = (href: string) =>
    currentVeid ? `${href}?veid=${encodeURIComponent(currentVeid)}` : href;
  return (
    <nav className="space-y-1">
      <Link href={withVeid("/")} className={navItemClass(pathname === "/")}>
        <span aria-hidden>▦</span>
        <span>总览</span>
      </Link>
      <div className="px-3 pt-3 pb-1 text-xs font-semibold uppercase tracking-wide text-neutral-400">
        插件
      </div>
      {sortedPlugins.map((plugin) => {
        const href = `/plugins/${plugin.id}`;
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link key={plugin.id} href={withVeid(href)} className={navItemClass(active)}>
            <span aria-hidden>{plugin.icon ?? "◆"}</span>
            <span>{plugin.name}</span>
          </Link>
        );
      })}
    </nav>
  );
}

function TopBar() {
  const [loggingOut, setLoggingOut] = useState(false);

  const logout = async () => {
    setLoggingOut(true);
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  };

  return (
    <header className="flex items-center justify-end gap-4 border-b border-neutral-200 bg-white px-6 py-3 dark:border-neutral-800 dark:bg-neutral-900">
      <Button onClick={logout} disabled={loggingOut}>
        退出登录
      </Button>
    </header>
  );
}

export function AppShell({
  targets,
  children,
}: {
  targets: VpsTarget[];
  children: ReactNode;
}) {
  return (
    <VpsProvider targets={targets}>
      <div className="flex min-h-screen">
        <aside className="hidden w-60 shrink-0 border-r border-neutral-200 bg-white p-4 md:block dark:border-neutral-800 dark:bg-neutral-900">
          <div className="mb-4 px-1">
            <div className="text-base font-semibold">VPS 管理面板</div>
            <div className="text-xs text-neutral-500">共 {targets.length} 台</div>
          </div>
          <NavLinks />
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar />
          <main className="min-w-0 flex-1 p-6">{children}</main>
        </div>
      </div>
    </VpsProvider>
  );
}
