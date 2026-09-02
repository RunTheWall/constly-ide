import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/", "out/", "node_modules/", ".vscode-test/"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      // The whole point of the bridge is an args array and never a shell:
      // child_process.exec/execSync and `shell: true` are banned outright.
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "CallExpression[callee.object.name=/^(cp|childProcess|child_process)$/][callee.property.name=/^(exec|execSync)$/]",
          message: "Never run a shell: use execFile/spawn with an args array.",
        },
        {
          selector: "ImportSpecifier[imported.name=/^(exec|execSync)$/]",
          message: "Never run a shell: use execFile/spawn with an args array.",
        },
        {
          selector: "Property[key.name='shell'][value.value=true]",
          message: "Never run a shell: use execFile/spawn with an args array.",
        },
      ],
    },
  },
  {
    files: ["esbuild.mjs", "eslint.config.mjs", ".vscode-test.mjs", "vitest.config.ts"],
    languageOptions: { globals: { process: "readonly", console: "readonly" } },
  },
);
