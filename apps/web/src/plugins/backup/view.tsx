"use client";

import { useCallback, useEffect, useState } from "react";
import {
  defineView,
  formatBytes,
  formatUnixTime,
  type Backup,
  type BackupListResult,
  type PluginView,
  type PluginViewProps,
} from "@/sdk";
import {
  Alert,
  Button,
  Card,
  EmptyState,
  Grid,
  JsonView,
  KeyValue,
  PluginPage,
  Spinner,
  usePluginAction,
} from "@/sdk/ui";

function BackupView({ targets, currentVeid, onSelectVps }: PluginViewProps) {
  const { run: fetchList, data, error, running } = usePluginAction<BackupListResult>(
    "backup",
    "list",
  );
  const copy = usePluginAction("backup", "copyToSnapshot");

  const [copied, setCopied] = useState<Backup | null>(null);

  const refresh = useCallback(() => {
    void fetchList(currentVeid);
  }, [fetchList, currentVeid]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const backups = Array.isArray(data?.backups) ? data.backups : [];

  const handleCopy = async (backup: Backup) => {
    const res = await copy.run(currentVeid, { backupToken: backup.backupToken });
    if (res !== undefined) {
      setCopied(backup);
      refresh();
    }
  };

  return (
    <PluginPage
      title="自动备份"
      targets={targets}
      currentVeid={currentVeid}
      onSelectVps={onSelectVps}
      toolbar={
        <Button variant="ghost" onClick={refresh} disabled={running}>
          {running ? <Spinner label="刷新中" /> : "刷新"}
        </Button>
      }
    >
      {copy.error && (
        <Alert tone="error">转换为快照失败：{copy.error.message}（错误码 {copy.error.code}）</Alert>
      )}
      {copied && (
        <Alert tone="success">
          已把备份 {copied.backupToken} 转为快照，可在「快照」页查看。
        </Alert>
      )}

      <Card
        title="备份列表"
        description={`共 ${backups.length} 个自动备份`}
        actions={
          <Button variant="ghost" onClick={refresh} disabled={running}>
            {running ? <Spinner label="刷新中" /> : "刷新"}
          </Button>
        }
      >
        {error && <Alert tone="error">获取备份失败：{error.message}（错误码 {error.code}）</Alert>}
        {!error && backups.length === 0 && !running && <EmptyState>暂无自动备份</EmptyState>}
        {running && backups.length === 0 && <Spinner label="正在获取备份…" />}
        <div className="space-y-3">
          {backups.map((b) => (
            <div
              key={b.backupToken}
              className="rounded-lg border border-neutral-200 p-4 dark:border-neutral-800"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1">
                  <div className="font-mono text-sm font-medium">{b.backupToken}</div>
                  <div className="text-xs text-neutral-500">
                    备份时间：{formatUnixTime(b.timestamp)}
                  </div>
                </div>
                <Button disabled={copy.running} onClick={() => void handleCopy(b)}>
                  {copy.running ? <Spinner label="转换中" /> : "转为快照"}
                </Button>
              </div>
              <div className="mt-3">
                <Grid cols={3}>
                  <KeyValue label="操作系统" value={b.os} />
                  <KeyValue label="大小" value={formatBytes(b.size)} />
                  <KeyValue
                    label="MD5"
                    value={<span className="font-mono text-xs">{b.md5}</span>}
                  />
                </Grid>
              </div>
            </div>
          ))}
        </div>
      </Card>

      {data && (
        <Card title="原始数据">
          <JsonView value={data} collapsed />
        </Card>
      )}
    </PluginPage>
  );
}

export const backupViews: PluginView[] = [
  defineView({ id: "main", title: "自动备份", path: "", Component: BackupView }),
];
