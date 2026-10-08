"use client";

import { useCallback, useEffect } from "react";
import {
  defineView,
  formatUnixTime,
  type PluginView,
  type PluginViewProps,
  type PolicyViolationsResult,
  type SuspensionDetails,
} from "@/sdk";
import {
  Alert,
  Button,
  Card,
  ConfirmButton,
  EmptyState,
  Grid,
  JsonView,
  KeyValue,
  PluginPage,
  Spinner,
  StatusBadge,
  usePluginAction,
} from "@/sdk/ui";

const thClass = "px-3 py-2 text-left text-xs font-medium text-neutral-500";
const tdClass = "px-3 py-2 align-top text-sm";
const rowClass = "border-b border-neutral-100 last:border-0 dark:border-neutral-800";

function SecurityView({ targets, currentVeid, onSelectVps }: PluginViewProps) {
  const suspensions = usePluginAction<SuspensionDetails>("security", "suspensions");
  const violations = usePluginAction<PolicyViolationsResult>("security", "violations");
  const unsuspend = usePluginAction("security", "unsuspend");
  const resolve = usePluginAction("security", "resolve");

  const refreshSuspensions = useCallback(() => {
    void suspensions.run(currentVeid);
  }, [suspensions.run, currentVeid]);

  const refreshViolations = useCallback(() => {
    void violations.run(currentVeid);
  }, [violations.run, currentVeid]);

  const refreshAll = useCallback(() => {
    refreshSuspensions();
    refreshViolations();
  }, [refreshSuspensions, refreshViolations]);

  useEffect(() => {
    refreshAll();
  }, [refreshAll]);

  const busy = unsuspend.running || resolve.running;
  const actionError = unsuspend.error ?? resolve.error;
  const loading = suspensions.running || violations.running;

  const handleUnsuspend = async (recordId: number) => {
    await unsuspend.run(currentVeid, { recordId });
    refreshAll();
  };

  const handleResolve = async (recordId: number) => {
    await resolve.run(currentVeid, { recordId });
    refreshAll();
  };

  const suspensionData = suspensions.data;
  const violationData = violations.data;
  const suspensionsList = suspensionData?.suspensions ?? [];
  const evidence = suspensionData?.evidence ?? {};
  const violationsList = violationData?.policy_violations ?? [];

  return (
    <PluginPage
      title="挂起与违规"
      targets={targets}
      currentVeid={currentVeid}
      onSelectVps={onSelectVps}
      toolbar={
        <Button variant="ghost" onClick={refreshAll} disabled={loading}>
          {loading ? <Spinner label="刷新中" /> : "刷新"}
        </Button>
      }
    >
      {actionError && (
        <Alert tone="error">
          操作失败：{actionError.message}（错误码 {actionError.code}）
        </Alert>
      )}
      {suspensions.error && (
        <Alert tone="error">
          获取挂起详情失败：{suspensions.error.message}（错误码 {suspensions.error.code}）
        </Alert>
      )}
      {violations.error && (
        <Alert tone="error">
          获取违规记录失败：{violations.error.message}（错误码 {violations.error.code}）
        </Alert>
      )}

      {suspensionData && (
        <>
          <Card
            title="挂起概览"
            actions={
              suspensionData.suspension_count > 0 ? (
                <StatusBadge tone="warning">已挂起 {suspensionData.suspension_count} 次</StatusBadge>
              ) : (
                <StatusBadge tone="success">无挂起</StatusBadge>
              )
            }
          >
            <Grid cols={3}>
              <KeyValue label="累计挂起次数" value={suspensionData.suspension_count} />
              <KeyValue
                label="累计违规分"
                value={`${suspensionData.total_abuse_points} / ${suspensionData.max_abuse_points}`}
              />
              <KeyValue label="违规分上限" value={suspensionData.max_abuse_points} />
            </Grid>
          </Card>

          <Card title="挂起记录">
            {suspensionsList.length === 0 ? (
              <EmptyState>暂无挂起记录。</EmptyState>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr>
                      <th className={thClass}>记录 ID</th>
                      <th className={thClass}>原因</th>
                      <th className={thClass}>类型</th>
                      <th className={thClass}>违规分</th>
                      <th className={thClass}>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {suspensionsList.map((record) => (
                      <tr key={record.record_id} className={rowClass}>
                        <td className={tdClass}>{record.record_id}</td>
                        <td className={tdClass}>{record.flag}</td>
                        <td className={tdClass}>
                          {record.is_soft === 1 ? (
                            <StatusBadge tone="warning">软挂起</StatusBadge>
                          ) : (
                            <StatusBadge tone="error">硬挂起</StatusBadge>
                          )}
                        </td>
                        <td className={tdClass}>{record.abuse_points}</td>
                        <td className={tdClass}>
                          {record.is_soft === 1 ? (
                            <ConfirmButton
                              label="解封"
                              confirmLabel="确认解封？"
                              disabled={busy}
                              onConfirm={() => void handleUnsuspend(record.record_id)}
                            />
                          ) : (
                            <span className="text-xs text-neutral-500">
                              硬挂起无法自助解封，请联系客服处理。
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {Object.keys(evidence).length > 0 && (
            <Card title="证据">
              <Grid cols={2}>
                {Object.entries(evidence).map(([key, value]) => (
                  <KeyValue key={key} label={key} value={value} />
                ))}
              </Grid>
            </Card>
          )}
        </>
      )}

      {!suspensionData && suspensions.running && <Spinner label="正在获取挂起详情…" />}

      {violationData && (
        <Card title="违规记录">
          {violationsList.length === 0 ? (
            <EmptyState>暂无待处理的违规记录。</EmptyState>
          ) : (
            <>
              <div className="mb-3">
                <Alert tone="warning">
                  共 {violationsList.length} 条违规，累计{" "}
                  {violationData.total_abuse_points} 分（上限 {violationData.max_abuse_points}）。
                  若不处理将到期被暂停。
                </Alert>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr>
                      <th className={thClass}>记录 ID</th>
                      <th className={thClass}>发现时间</th>
                      <th className={thClass}>若不处理将于</th>
                      <th className={thClass}>原因</th>
                      <th className={thClass}>类型</th>
                      <th className={thClass}>违规分</th>
                      <th className={thClass}>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {violationsList.map((v) => (
                      <tr key={v.record_id} className={rowClass}>
                        <td className={tdClass}>{v.record_id}</td>
                        <td className={tdClass}>{formatUnixTime(v.timestamp)}</td>
                        <td className={tdClass}>
                          若不处理将于 {formatUnixTime(v.suspend_at)} 被暂停
                        </td>
                        <td className={tdClass}>{v.flag}</td>
                        <td className={tdClass}>
                          {v.is_soft === 1 ? (
                            <StatusBadge tone="warning">软违规</StatusBadge>
                          ) : (
                            <StatusBadge tone="error">硬违规</StatusBadge>
                          )}
                        </td>
                        <td className={tdClass}>{v.abuse_points}</td>
                        <td className={tdClass}>
                          <ConfirmButton
                            label="标记已处理"
                            confirmLabel="确认标记为已处理？"
                            variant="primary"
                            disabled={busy}
                            onConfirm={() => void handleResolve(v.record_id)}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-3">
                <JsonView value={violationsList} collapsed />
              </div>
            </>
          )}
        </Card>
      )}

      {!violationData && violations.running && <Spinner label="正在获取违规记录…" />}
    </PluginPage>
  );
}

export const securityViews: PluginView[] = [
  defineView({ id: "main", title: "挂起与违规", path: "", Component: SecurityView }),
];
