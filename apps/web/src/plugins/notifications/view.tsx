"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  defineView,
  type NotificationPreferencesResult,
  type PluginView,
  type PluginViewProps,
  type SetNotificationPreferencesResult,
} from "@/sdk";
import {
  Alert,
  Button,
  Card,
  EmptyState,
  JsonView,
  PluginPage,
  Spinner,
  StatusBadge,
  usePluginAction,
} from "@/sdk/ui";

interface PrefItem {
  category: string;
  id: string;
  description: string;
}

function NotificationsView({ targets, currentVeid, onSelectVps }: PluginViewProps) {
  const get = usePluginAction<NotificationPreferencesResult>("notifications", "get");
  const set = usePluginAction<SetNotificationPreferencesResult>("notifications", "set");

  const [items, setItems] = useState<PrefItem[]>([]);
  const [prefs, setPrefs] = useState<Record<string, number>>({});
  const [original, setOriginal] = useState<Record<string, number>>({});
  const [notificationEmail, setNotificationEmail] = useState<string>("");
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const res = await get.run(currentVeid);
    if (!res) return;

    const flat: Record<string, number> = {};
    const list: PrefItem[] = [];
    for (const [category, group] of Object.entries(res.email_preferences ?? {})) {
      for (const [id, pref] of Object.entries(group ?? {})) {
        flat[id] = pref.is_enabled === 1 ? 1 : 0;
        list.push({ category, id, description: pref.friendly_description || id });
      }
    }
    setItems(list);
    setPrefs(flat);
    setOriginal(flat);
    setNotificationEmail(res.notificationEmail ?? "");
    setSavedAt(null);
  }, [get.run, currentVeid]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // set 返回的友好说明可用于补充标签。
  useEffect(() => {
    const fd = set.data?.friendly_descriptions;
    if (fd) {
      setItems((prev) =>
        prev.map((item) => (fd[item.id] ? { ...item, description: fd[item.id] as string } : item)),
      );
    }
    if (set.data) setSavedAt(new Date().toLocaleTimeString());
  }, [set.data]);

  const toggle = (id: string) => {
    setPrefs((prev) => ({ ...prev, [id]: prev[id] === 1 ? 0 : 1 }));
    setSavedAt(null);
  };

  const changedIds = useMemo(
    () => items.filter((i) => (prefs[i.id] ?? 0) !== (original[i.id] ?? 0)).map((i) => i.id),
    [items, prefs, original],
  );
  const dirty = changedIds.length > 0;

  const grouped = useMemo(() => {
    const map = new Map<string, PrefItem[]>();
    for (const item of items) {
      const bucket = map.get(item.category);
      if (bucket) bucket.push(item);
      else map.set(item.category, [item]);
    }
    return [...map.entries()];
  }, [items]);

  const handleSave = async () => {
    if (!dirty) return;
    const preferences: Record<string, number> = {};
    for (const id of changedIds) preferences[id] = prefs[id] === 1 ? 1 : 0;
    const res = await set.run(currentVeid, { preferences });
    if (res) {
      setOriginal((prev) => ({ ...prev, ...(res.submitted_email_preferences ?? {}) }));
      setPrefs((prev) => ({ ...prev, ...(res.updated_email_preferences ?? {}) }));
    }
  };

  return (
    <PluginPage
      title="通知偏好"
      targets={targets}
      currentVeid={currentVeid}
      onSelectVps={onSelectVps}
      toolbar={
        <Button variant="ghost" onClick={() => void refresh()} disabled={get.running}>
          {get.running ? <Spinner label="刷新中" /> : "刷新"}
        </Button>
      }
    >
      {get.error && (
        <Alert tone="error">
          获取通知偏好失败：{get.error.message}（错误码 {get.error.code}）
        </Alert>
      )}
      {set.error && <Alert tone="error">保存失败：{set.error.message}（错误码 {set.error.code}）</Alert>}
      {savedAt && !dirty && <Alert tone="success">已保存（{savedAt}）。</Alert>}

      <Card
        title="通知开关"
        description={notificationEmail ? `通知邮箱：${notificationEmail}` : undefined}
        actions={
          dirty ? (
            <StatusBadge tone="warning">有 {changedIds.length} 项未保存</StatusBadge>
          ) : (
            <StatusBadge tone="success">已同步</StatusBadge>
          )
        }
      >
        {items.length === 0 ? (
          get.running ? (
            <Spinner label="正在获取通知偏好…" />
          ) : (
            <EmptyState>没有可配置的通知项。</EmptyState>
          )
        ) : (
          <div className="space-y-5">
            {grouped.map(([category, list]) => (
              <div key={category} className="space-y-2">
                <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
                  {category}
                </div>
                {list.map((item) => (
                  <label
                    key={item.id}
                    className="flex items-center justify-between gap-4 rounded-md border border-neutral-200 px-3 py-2 text-sm dark:border-neutral-800"
                  >
                    <span className="flex min-w-0 flex-col">
                      <span>{item.description}</span>
                      <code className="truncate text-xs text-neutral-500">{item.id}</code>
                    </span>
                    <input
                      type="checkbox"
                      className="h-4 w-4 shrink-0"
                      checked={prefs[item.id] === 1}
                      onChange={() => toggle(item.id)}
                    />
                  </label>
                ))}
              </div>
            ))}
          </div>
        )}
        <div className="mt-4 flex items-center gap-3">
          <Button variant="primary" onClick={() => void handleSave()} disabled={!dirty || set.running}>
            {set.running ? <Spinner label="保存中" /> : "保存变更"}
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              setPrefs({ ...original });
              setSavedAt(null);
            }}
            disabled={!dirty}
          >
            还原
          </Button>
        </div>
      </Card>

      {get.data && (
        <Card title="原始数据">
          <JsonView value={get.data} collapsed />
        </Card>
      )}
    </PluginPage>
  );
}

export const notificationsViews: PluginView[] = [
  defineView({ id: "main", title: "通知偏好", path: "", Component: NotificationsView }),
];
