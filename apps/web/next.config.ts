import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // 仓库根还有 pnpm-lock.yaml，显式指定本应用为 tracing 根，避免 Next 判错 workspace root。
  outputFileTracingRoot: path.resolve(process.cwd()),
  // node-wreq 是 Rust 原生绑定（含平台预编译包），必须保持外部化，
  // 由运行时从 node_modules 加载；否则 webpack 打包会破坏原生模块解析。
  serverExternalPackages: ["node-wreq"],
};

export default nextConfig;
