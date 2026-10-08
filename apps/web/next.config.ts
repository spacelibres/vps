import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // 仓库根还有 pnpm-lock.yaml，显式指定本应用为 tracing 根，避免 Next 判错 workspace root。
  outputFileTracingRoot: path.resolve(process.cwd()),
};

export default nextConfig;
