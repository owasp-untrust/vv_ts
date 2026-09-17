import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@untrust/vv": new URL("./packages/vv/src/index.ts", import.meta.url).pathname } },
  test: { include: ["packages/*/test/**/*.test.ts"] }
});
