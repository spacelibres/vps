"use client";

import { Suspense, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Alert, Button, Card, Field, TextInput } from "@/sdk/ui";

function LoginForm() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") ?? "/";

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const json = (await res.json()) as {
        ok: boolean;
        error?: { message?: string };
      };
      if (!json.ok) {
        setError(json.error?.message ?? "登录失败");
        return;
      }
      router.replace(next.startsWith("/") ? next : "/");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <Card title="VPS 管理面板" description="请输入访问密码">
        <form onSubmit={onSubmit} className="w-80 space-y-4">
          {error && <Alert tone="error">{error}</Alert>}
          <Field label="密码">
            <TextInput
              type="password"
              value={password}
              autoFocus
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          <Button
            type="submit"
            variant="primary"
            disabled={loading || !password}
            className="w-full justify-center"
          >
            {loading ? "登录中…" : "登录"}
          </Button>
        </form>
      </Card>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
