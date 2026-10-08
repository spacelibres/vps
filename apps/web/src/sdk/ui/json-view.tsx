"use client";

import { useState } from "react";

/** 折叠展示任意 JSON 结果。 */
export function JsonView({ value, collapsed = false }: { value: unknown; collapsed?: boolean }) {
  const [open, setOpen] = useState(!collapsed);
  const text = JSON.stringify(value, null, 2);
  return (
    <div className="text-xs">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="mb-1 text-blue-600 hover:underline dark:text-blue-400"
      >
        {open ? "收起原始数据" : "查看原始数据"}
      </button>
      {open && (
        <pre className="max-h-96 overflow-auto rounded-md bg-neutral-950 p-3 text-neutral-100">
          {text}
        </pre>
      )}
    </div>
  );
}
