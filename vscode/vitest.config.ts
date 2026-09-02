import { defineConfig } from "vitest/config";

// Unit tests only: pure modules with injected fs/exec/registry readers. The
// integration and activation suites run inside a real VS Code via
// @vscode/test-cli (.vscode-test.mjs), not here.
export default defineConfig({
  test: {
    environment: "node",
    include: ["test/unit/**/*.test.ts"],
  },
});
