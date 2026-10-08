"use client";

import { useCallback, useEffect, useState } from "react";
import {
  defineView,
  type PluginView,
  type PluginViewProps,
  type ResetRootPasswordResult,
  type SshKeysResult,
} from "@/sdk";
import {
  Alert,
  Button,
  Card,
  ConfirmButton,
  Field,
  Grid,
  JsonView,
  KeyValue,
  PluginPage,
  Spinner,
  Textarea,
  usePluginAction,
} from "@/sdk/ui";

function AccountView({ targets, currentVeid, onSelectVps }: PluginViewProps) {
  const getKeys = usePluginAction<SshKeysResult>("account", "getSshKeys");
  const updateKeys = usePluginAction("account", "updateSshKeys");
  const resetPassword = usePluginAction<ResetRootPasswordResult>("account", "resetRootPassword");

  const [draft, setDraft] = useState("");

  const runGetKeys = getKeys.run;

  const refresh = useCallback(async () => {
    const data = await runGetKeys(currentVeid);
    setDraft(
      data ? data.ssh_keys_preferred || data.ssh_keys_veid || data.ssh_keys_user || "" : "",
    );
  }, [runGetKeys, currentVeid]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const save = async () => {
    await updateKeys.run(currentVeid, { sshKeys: draft });
    await refresh();
  };

  const doReset = async () => {
    await resetPassword.run(currentVeid);
  };

  return (
    <PluginPage
      title="账号与 SSH"
      targets={targets}
      currentVeid={currentVeid}
      onSelectVps={onSelectVps}
      toolbar={
        <Button variant="ghost" onClick={() => void refresh()} disabled={getKeys.running}>
          {getKeys.running ? <Spinner label="读取中" /> : "重新读取"}
        </Button>
      }
    >
      <Card title="SSH 公钥">
        {getKeys.error && (
          <div className="mb-3">
            <Alert tone="error">
              读取失败：{getKeys.error.message}（错误码 {getKeys.error.code}）
            </Alert>
          </div>
        )}
        {getKeys.data ? (
          <Grid cols={2}>
            <KeyValue
              label="当前生效（摘要）"
              value={getKeys.data.shortened_ssh_keys_preferred || "-"}
            />
            <KeyValue
              label="VPS 专属（摘要）"
              value={getKeys.data.shortened_ssh_keys_veid || "-"}
            />
            <KeyValue
              label="账号通用（摘要）"
              value={getKeys.data.shortened_ssh_keys_user || "-"}
            />
          </Grid>
        ) : (
          !getKeys.running && <Alert tone="info">尚未加载，点击「重新读取」开始获取。</Alert>
        )}

        <div className="mt-4 space-y-3">
          <Field label="编辑 SSH 公钥（每行一个）">
            <Textarea
              rows={6}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="ssh-ed25519 AAAA... user@host"
            />
          </Field>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary" disabled={updateKeys.running} onClick={() => void save()}>
              {updateKeys.running ? <Spinner label="保存中" /> : "保存公钥"}
            </Button>
          </div>
          {updateKeys.error && (
            <Alert tone="error">
              保存失败：{updateKeys.error.message}（错误码 {updateKeys.error.code}）
            </Alert>
          )}
        </div>
      </Card>

      <Card title="重置 root 密码" description="生成新的 root 密码，旧密码将立即失效">
        <ConfirmButton
          label="重置 root 密码"
          confirmLabel="确认重置 root 密码？"
          variant="danger"
          disabled={resetPassword.running}
          onConfirm={() => void doReset()}
        />
        {resetPassword.error && (
          <div className="mt-3">
            <Alert tone="error">
              重置失败：{resetPassword.error.message}（错误码 {resetPassword.error.code}）
            </Alert>
          </div>
        )}
        {resetPassword.data && (
          <div className="mt-3 space-y-3">
            <Alert tone="warning">请立即保存新的 root 密码，页面刷新后将无法再次查看。</Alert>
            <KeyValue
              label="新 root 密码"
              value={
                <span className="font-mono text-base font-semibold text-red-600 dark:text-red-400">
                  {resetPassword.data.password}
                </span>
              }
            />
            <JsonView value={resetPassword.data} collapsed />
          </div>
        )}
      </Card>
    </PluginPage>
  );
}

export const accountViews: PluginView[] = [
  defineView({ id: "main", title: "账号与 SSH", path: "", Component: AccountView }),
];
