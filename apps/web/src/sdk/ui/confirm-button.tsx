"use client";

import { useState } from "react";
import { Button } from "./primitives";

/**
 * 两段式确认按钮：第一次点击变成「确认吗？」，再次点击才触发 `onConfirm`。
 * 用于危险操作（重启、强制停止、重装系统等）。
 */
export function ConfirmButton({
  label,
  confirmLabel = "确认执行？",
  onConfirm,
  disabled,
  variant = "danger",
}: {
  label: string;
  confirmLabel?: string;
  onConfirm: () => void;
  disabled?: boolean;
  variant?: "danger" | "default" | "primary";
}) {
  const [armed, setArmed] = useState(false);
  return (
    <Button
      variant={armed ? variant : "default"}
      disabled={disabled}
      onClick={() => {
        if (armed) {
          setArmed(false);
          onConfirm();
        } else {
          setArmed(true);
          setTimeout(() => setArmed(false), 4000);
        }
      }}
    >
      {armed ? confirmLabel : label}
    </Button>
  );
}
