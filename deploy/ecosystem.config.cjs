// PM2 进程守护配置：VPS 管理面板（Next.js 15）
//
//   pm2 start deploy/ecosystem.config.cjs
//   pm2 restart deploy/ecosystem.config.cjs --update-env
//
// 可用环境变量覆盖：APP_NAME / PORT / HOST
//
// 注意：`cwd` 必须是 `apps/web`——应用用 `process.cwd()` 解析
// `config/vps.yaml`、`config/kh.google.com.yaml` 与 `data/`。
const path = require("node:path");

const webDir = path.resolve(__dirname, "..", "apps", "web");
const appName = process.env.APP_NAME || "vps-panel";
const port = String(process.env.PORT || "3000");
const host = process.env.HOST || "0.0.0.0";

module.exports = {
  apps: [
    {
      name: appName,
      cwd: webDir,
      script: "node_modules/next/dist/bin/next",
      args: `start -p ${port} -H ${host}`,
      interpreter: "node",
      exec_mode: "fork",
      instances: 1,
      env: {
        NODE_ENV: "production",
        PORT: port,
      },
      max_memory_restart: "512M",
      autorestart: true,
      max_restarts: 10,
      restart_delay: 2000,
      kill_timeout: 5000,
      merge_logs: true,
      time: true,
      out_file: path.resolve(__dirname, "..", "logs", "out.log"),
      error_file: path.resolve(__dirname, "..", "logs", "error.log"),
    },
  ],
};
