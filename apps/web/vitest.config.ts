import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // 与 tsconfig 的 "@/*" 别名保持一致
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
