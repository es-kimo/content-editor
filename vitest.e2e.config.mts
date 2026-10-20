import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// 빌드한 앱을 띄우고 Chrome으로 실행한다 (`pnpm build && pnpm e2e`). `pnpm test`에는 넣지 않는다.
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["e2e/**/*.e2e.ts"],
    testTimeout: 60_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
});
