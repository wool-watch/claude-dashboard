import path from "node:path";
import { defineConfig } from "vitest/config";

// テストは Asia/Tokyo 前提で日時境界を検証する（クロスプラットフォームのためここで固定）
process.env.TZ = "Asia/Tokyo";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // 全テストで CLAUDE_* パスを一時ディレクトリへ強制隔離（実データ保護）
    setupFiles: ["tests/setup-env-guard.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
