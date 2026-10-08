"use client";

import { useParams } from "next/navigation";
import { useVps } from "@/components/vps-context";
import { plugins } from "@/plugins";
import { Alert } from "@/sdk/ui";

export default function PluginViewPage() {
  const params = useParams<{ pluginId: string; path?: string[] }>();
  const { targets, currentVeid, setCurrentVeid } = useVps();

  const pluginId = params.pluginId;
  const viewPath = (params.path ?? []).join("/");

  const plugin = plugins.find((p) => p.id === pluginId);
  if (!plugin) {
    return <Alert tone="error">未找到插件：{pluginId}</Alert>;
  }

  const view = plugin.views.find((v) => v.path === viewPath) ?? plugin.views[0];
  if (!view) {
    return <Alert tone="warning">插件「{plugin.name}」没有可展示的视图。</Alert>;
  }

  const Component = view.Component;
  return (
    <Component targets={targets} currentVeid={currentVeid} onSelectVps={setCurrentVeid} />
  );
}
