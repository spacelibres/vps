"use client";

import type { ReactNode } from "react";

/** 面板卡片容器。 */
export function Card({
  title,
  description,
  actions,
  children,
}: {
  title?: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-neutral-200 bg-white shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
      {(title || actions) && (
        <header className="flex items-start justify-between gap-4 border-b border-neutral-100 px-5 py-3 dark:border-neutral-800">
          <div>
            {title && <h2 className="text-sm font-semibold">{title}</h2>}
            {description && (
              <p className="mt-0.5 text-xs text-neutral-500">{description}</p>
            )}
          </div>
          {actions}
        </header>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
        {title}
      </h3>
      {children}
    </div>
  );
}

/** 一排字段的响应式网格。 */
export function Grid({ children, cols = 2 }: { children: ReactNode; cols?: 1 | 2 | 3 | 4 }) {
  const map = {
    1: "sm:grid-cols-1",
    2: "sm:grid-cols-2",
    3: "sm:grid-cols-3",
    4: "sm:grid-cols-4",
  } as const;
  return <div className={`grid grid-cols-1 gap-4 ${map[cols]}`}>{children}</div>;
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-xs font-medium text-neutral-600 dark:text-neutral-400">
        {label}
      </span>
      {children}
    </label>
  );
}

const inputClass =
  "rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm outline-none focus:border-blue-500 dark:border-neutral-700 dark:bg-neutral-950";

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${inputClass} ${props.className ?? ""}`} />;
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={`${inputClass} font-mono ${props.className ?? ""}`}
    />
  );
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`${inputClass} ${props.className ?? ""}`} />;
}

type ButtonVariant = "primary" | "default" | "danger" | "ghost";

export function Button({
  variant = "default",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  const variants: Record<ButtonVariant, string> = {
    primary: "bg-blue-600 text-white hover:bg-blue-700 border-transparent",
    default:
      "bg-white hover:bg-neutral-50 dark:bg-neutral-900 dark:hover:bg-neutral-800 border-neutral-300 dark:border-neutral-700",
    danger: "bg-red-600 text-white hover:bg-red-700 border-transparent",
    ghost: "bg-transparent hover:bg-neutral-100 dark:hover:bg-neutral-800 border-transparent",
  };
  return (
    <button
      {...props}
      className={`inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${variants[variant]} ${props.className ?? ""}`}
    />
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-xs text-neutral-500">
      <span className="h-3 w-3 animate-spin rounded-full border-2 border-neutral-300 border-t-blue-600" />
      {label ?? "加载中…"}
    </span>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-md border border-dashed border-neutral-300 px-4 py-8 text-center text-sm text-neutral-500 dark:border-neutral-700">
      {children}
    </div>
  );
}

export function Alert({
  tone = "info",
  children,
}: {
  tone?: "info" | "success" | "warning" | "error";
  children: ReactNode;
}) {
  const tones = {
    info: "border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-200",
    success:
      "border-green-200 bg-green-50 text-green-800 dark:border-green-900 dark:bg-green-950 dark:text-green-200",
    warning:
      "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200",
    error:
      "border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200",
  } as const;
  return (
    <div className={`rounded-md border px-3 py-2 text-sm ${tones[tone]}`}>{children}</div>
  );
}

export function StatusBadge({
  tone = "neutral",
  children,
}: {
  tone?: "neutral" | "success" | "warning" | "error";
  children: ReactNode;
}) {
  const tones = {
    neutral: "bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300",
    success: "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300",
    warning: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
    error: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
  } as const;
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${tones[tone]}`}>
      {children}
    </span>
  );
}

/** 键值对展示。 */
export function KeyValue({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-neutral-500">{label}</span>
      <span className="text-sm wrap-break-word">{value}</span>
    </div>
  );
}
