"use client";

import { useEffect, useState } from "react";
import {
  defineView,
  type PluginView,
  type PluginViewProps,
  type ShellCdResult,
  type ShellExecResult,
  type ShellScriptResult,
} from "@/sdk";
import {
  Alert,
  Button,
  Card,
  Field,
  Grid,
  PluginPage,
  Spinner,
  Textarea,
  TextInput,
  usePluginAction,
} from "@/sdk/ui";

function ShellView({ targets, currentVeid, onSelectVps }: PluginViewProps) {
  const cd = usePluginAction<ShellCdResult>("shell", "cd");
  const exec = usePluginAction<ShellExecResult>("shell", "exec");
  const script = usePluginAction<ShellScriptResult>("shell", "script");

  const [cwd, setCwd] = useState("/");
  const [newDir, setNewDir] = useState("");
  const [command, setCommand] = useState("");
  const [lastCommand, setLastCommand] = useState("");
  const [scriptText, setScriptText] = useState("");

  // 切换 VPS 时重置本地终端状态。
  useEffect(() => {
    setCwd("/");
    setLastCommand("");
    setCommand("");
    setNewDir("");
  }, [currentVeid]);

  const handleCd = async () => {
    if (!newDir.trim()) return;
    const res = await cd.run(currentVeid, { currentDir: cwd, newDir: newDir.trim() });
    if (res?.pwd) {
      setCwd(res.pwd);
      setNewDir("");
    }
  };

  const handleExec = async () => {
    const cmd = command.trim();
    if (!cmd) return;
    setLastCommand(cmd);
    setCommand("");
    await exec.run(currentVeid, { command: cmd });
  };

  const handleScript = async () => {
    if (!scriptText.trim()) return;
    await script.run(currentVeid, { script: scriptText });
  };

  return (
    <PluginPage
      title="命令行"
      targets={targets}
      currentVeid={currentVeid}
      onSelectVps={onSelectVps}
    >
      {cd.error && (
        <Alert tone="error">
          切换目录失败：{cd.error.message}（错误码 {cd.error.code}）
        </Alert>
      )}
      {exec.error && (
        <Alert tone="error">
          命令请求失败：{exec.error.message}（错误码 {exec.error.code}）
        </Alert>
      )}
      {script.error && (
        <Alert tone="error">
          脚本执行失败：{script.error.message}（错误码 {script.error.code}）
        </Alert>
      )}

      <Card title="切换目录">
        <Grid cols={2}>
          <Field label="当前目录">
            <TextInput value={cwd} readOnly />
          </Field>
          <Field label="目标目录">
            <TextInput
              value={newDir}
              onChange={(e) => setNewDir(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleCd();
              }}
              placeholder="例如 /root 或 ../"
            />
          </Field>
        </Grid>
        <div className="mt-3">
          <Button onClick={() => void handleCd()} disabled={cd.running || !newDir.trim()}>
            {cd.running ? <Spinner label="切换中" /> : "切换目录"}
          </Button>
        </div>
      </Card>

      <Card title="执行命令">
        <Field label="命令">
          <TextInput
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleExec();
            }}
            placeholder="例如 uname -a"
          />
        </Field>
        <div className="mt-3 flex items-center gap-3">
          <Button
            variant="primary"
            onClick={() => void handleExec()}
            disabled={exec.running || !command.trim()}
          >
            {exec.running ? <Spinner label="执行中" /> : "执行"}
          </Button>
          {lastCommand && <code className="text-xs text-neutral-500">$ {lastCommand}</code>}
        </div>
        <div className="mt-3">
          {exec.data ? (
            <div className="space-y-1">
              <div className="text-xs text-neutral-500">
                退出码：
                {exec.data.error === 0 ? (
                  <span className="text-green-600">0（成功）</span>
                ) : (
                  <span className="text-amber-600">
                    {exec.data.error}（命令返回非零，属正常结果）
                  </span>
                )}
              </div>
              <pre className="max-h-96 overflow-auto rounded-md bg-neutral-950 p-3 font-mono text-xs text-neutral-100">
                {exec.data.message || "（无输出）"}
              </pre>
            </div>
          ) : (
            <pre className="max-h-96 overflow-auto rounded-md bg-neutral-950 p-3 font-mono text-xs text-neutral-100">
              {exec.running ? "执行中…" : "（尚无输出）"}
            </pre>
          )}
        </div>
      </Card>

      <Card title="运行脚本" description="脚本异步执行，完成后日志写入返回的文件名">
        <Field label="脚本内容">
          <Textarea
            rows={6}
            value={scriptText}
            onChange={(e) => setScriptText(e.target.value)}
            placeholder={"#!/bin/sh\necho hello"}
          />
        </Field>
        <div className="mt-3">
          <Button onClick={() => void handleScript()} disabled={script.running || !scriptText.trim()}>
            {script.running ? <Spinner label="提交中" /> : "运行脚本"}
          </Button>
        </div>
        {script.data && (
          <div className="mt-3">
            <Alert tone="success">
              脚本已提交执行。日志文件：<code>{script.data.log}</code>
            </Alert>
          </div>
        )}
      </Card>
    </PluginPage>
  );
}

export const shellViews: PluginView[] = [
  defineView({ id: "main", title: "命令行", path: "", Component: ShellView }),
];
