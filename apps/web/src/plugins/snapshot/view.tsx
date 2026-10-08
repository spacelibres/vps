"use client";

import { useCallback, useEffect, useState } from "react";
import {
  defineView,
  formatBytes,
  type PluginView,
  type PluginViewProps,
  type Snapshot,
  type SnapshotExportResult,
  type SnapshotListResult,
} from "@/sdk";
import {
  Alert,
  Button,
  Card,
  ConfirmButton,
  EmptyState,
  Field,
  Grid,
  JsonView,
  KeyValue,
  PluginPage,
  Spinner,
  StatusBadge,
  TextInput,
  usePluginAction,
} from "@/sdk/ui";

function SnapshotView({ targets, currentVeid, onSelectVps }: PluginViewProps) {
  const { run: fetchList, data, error, running } = usePluginAction<SnapshotListResult>(
    "snapshot",
    "list",
  );
  const create = usePluginAction("snapshot", "create");
  const del = usePluginAction("snapshot", "delete");
  const restore = usePluginAction("snapshot", "restore");
  const toggle = usePluginAction("snapshot", "toggleSticky");
  const exportAction = usePluginAction<SnapshotExportResult>("snapshot", "export");
  const importAction = usePluginAction("snapshot", "import");

  const [description, setDescription] = useState("");
  const [importVeid, setImportVeid] = useState("");
  const [importToken, setImportToken] = useState("");
  const [exportToken, setExportToken] = useState<string | null>(null);

  const refresh = useCallback(() => {
    void fetchList(currentVeid);
  }, [fetchList, currentVeid]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const snapshots = Array.isArray(data?.snapshots) ? data.snapshots : [];
  const busy =
    create.running ||
    del.running ||
    restore.running ||
    toggle.running ||
    exportAction.running ||
    importAction.running;
  const actionError =
    create.error ??
    del.error ??
    restore.error ??
    toggle.error ??
    exportAction.error ??
    importAction.error;

  const runThenRefresh = async (
    run: (veid: string, input?: unknown) => Promise<unknown>,
    input?: unknown,
  ) => {
    await run(currentVeid, input);
    refresh();
  };

  const handleCreate = async () => {
    const desc = description.trim();
    await create.run(currentVeid, desc ? { description: desc } : {});
    setDescription("");
    refresh();
  };

  const handleExport = async (snapshot: Snapshot) => {
    const res = await exportAction.run(currentVeid, { snapshot: snapshot.fileName });
    if (res) setExportToken(res.token);
  };

  const handleImport = async () => {
    await importAction.run(currentVeid, {
      sourceVeid: importVeid.trim(),
      sourceToken: importToken.trim(),
    });
    setImportVeid("");
    setImportToken("");
    refresh();
  };

  return (
    <PluginPage
      title="快照"
      targets={targets}
      currentVeid={currentVeid}
      onSelectVps={onSelectVps}
      toolbar={
        <Button variant="ghost" onClick={refresh} disabled={running}>
          {running ? <Spinner label="刷新中" /> : "刷新"}
        </Button>
      }
    >
      <Card title="创建快照" description="描述可选，用于区分不同时间点的快照">
        {create.error && (
          <div className="mb-3">
            <Alert tone="error">创建失败：{create.error.message}（错误码 {create.error.code}）</Alert>
          </div>
        )}
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-64 flex-1">
            <Field label="快照描述">
              <TextInput
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="例如：升级前备份"
              />
            </Field>
          </div>
          <Button variant="primary" disabled={busy} onClick={() => void handleCreate()}>
            {create.running ? <Spinner label="创建中" /> : "创建快照"}
          </Button>
        </div>
      </Card>

      <Card title="导入快照" description="使用另一台 VPS 导出的令牌导入快照">
        {importAction.error && (
          <div className="mb-3">
            <Alert tone="error">导入失败：{importAction.error.message}（错误码 {importAction.error.code}）</Alert>
          </div>
        )}
        <Grid cols={2}>
          <Field label="源 VPS ID（sourceVeid）">
            <TextInput
              value={importVeid}
              onChange={(e) => setImportVeid(e.target.value)}
              placeholder="例如：123456"
            />
          </Field>
          <Field label="快照令牌（sourceToken）">
            <TextInput
              value={importToken}
              onChange={(e) => setImportToken(e.target.value)}
              placeholder="导出的 token"
            />
          </Field>
        </Grid>
        <div className="mt-3">
          <ConfirmButton
            label="导入快照"
            confirmLabel="确认导入？"
            disabled={busy || !importVeid.trim() || !importToken.trim()}
            onConfirm={() => void handleImport()}
          />
        </div>
      </Card>

      {exportToken && (
        <Alert tone="success">
          导出令牌：<code className="font-mono">{exportToken}</code>
          <span className="ml-2">请妥善保存，可在其他 VPS 上导入该快照。</span>
        </Alert>
      )}

      {actionError && (
        <Alert tone="error">操作失败：{actionError.message}（错误码 {actionError.code}）</Alert>
      )}

      <Card
        title="快照列表"
        description={`共 ${snapshots.length} 个快照`}
        actions={
          <Button variant="ghost" onClick={refresh} disabled={running}>
            {running ? <Spinner label="刷新中" /> : "刷新"}
          </Button>
        }
      >
        {error && <Alert tone="error">获取快照失败：{error.message}（错误码 {error.code}）</Alert>}
        {!error && snapshots.length === 0 && !running && <EmptyState>暂无快照</EmptyState>}
        {running && snapshots.length === 0 && <Spinner label="正在获取快照…" />}
        <div className="space-y-3">
          {snapshots.map((s) => (
            <div
              key={s.fileName}
              className="rounded-lg border border-neutral-200 p-4 dark:border-neutral-800"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{s.description || "（无描述）"}</span>
                    {s.sticky ? (
                      <StatusBadge tone="success">常驻</StatusBadge>
                    ) : (
                      s.purgesIn >= 0 && (
                        <StatusBadge tone="warning">{s.purgesIn} 天后清除</StatusBadge>
                      )
                    )}
                  </div>
                  <div className="font-mono text-xs text-neutral-500">{s.fileName}</div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button disabled={busy} onClick={() => void handleExport(s)}>
                    {exportAction.running ? <Spinner label="导出中" /> : "导出"}
                  </Button>
                  <Button
                    disabled={busy}
                    onClick={() =>
                      void runThenRefresh(toggle.run, {
                        snapshot: s.fileName,
                        sticky: s.sticky ? 0 : 1,
                      })
                    }
                  >
                    {s.sticky ? "取消常驻" : "置为常驻"}
                  </Button>
                  <ConfirmButton
                    label="恢复"
                    confirmLabel="确认恢复？会覆盖全部数据"
                    variant="primary"
                    disabled={busy}
                    onConfirm={() => void runThenRefresh(restore.run, { snapshot: s.fileName })}
                  />
                  <ConfirmButton
                    label="删除"
                    confirmLabel="确认删除？"
                    disabled={busy}
                    onConfirm={() => void runThenRefresh(del.run, { snapshot: s.fileName })}
                  />
                </div>
              </div>
              <div className="mt-3">
                <Grid cols={3}>
                  <KeyValue label="操作系统" value={s.os} />
                  <KeyValue label="大小" value={formatBytes(s.size)} />
                  <KeyValue
                    label="MD5"
                    value={<span className="font-mono text-xs">{s.md5}</span>}
                  />
                </Grid>
              </div>
              {(s.downloadLink || s.downloadLinkSSL) && (
                <div className="mt-3 flex flex-wrap gap-4 text-xs">
                  {s.downloadLink && (
                    <a
                      className="text-blue-600 hover:underline dark:text-blue-400"
                      href={s.downloadLink}
                    >
                      HTTP 下载
                    </a>
                  )}
                  {s.downloadLinkSSL && (
                    <a
                      className="text-blue-600 hover:underline dark:text-blue-400"
                      href={s.downloadLinkSSL}
                    >
                      HTTPS 下载
                    </a>
                  )}
                </div>
              )}
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

export const snapshotViews: PluginView[] = [
  defineView({ id: "main", title: "快照", path: "", Component: SnapshotView }),
];
