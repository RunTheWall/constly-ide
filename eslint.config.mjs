import js from "@eslint/js";
import tseslint from "typescript-eslint";

// The whole point of the bridge is an args array and never a shell:
// child_process.exec/execSync and `shell: true` are banned outright.
const SHELL_MSG = "Never run a shell: use execFile/spawn with an args array.";
const shellBans = [
  {
    selector:
      "CallExpression[callee.object.name=/^(cp|childProcess|child_process)$/][callee.property.name=/^(exec|execSync)$/]",
    message: SHELL_MSG,
  },
  { selector: "ImportSpecifier[imported.name=/^(exec|execSync)$/]", message: SHELL_MSG },
  { selector: "Property[key.name='shell'][value.value=true]", message: SHELL_MSG },
];

// The activation test (test/activation) attributes fs/child_process calls to
// the bundle by patching the MODULE objects. A function captured at module
// scope — a named or default import, a destructured require, a top-level
// alias — bypasses the patch and would blind the spies while their positive
// control stayed green. src/ therefore imports these modules as namespaces
// only and looks every function up at call time. scripts/lint-guard-self-test.sh
// proves each of these selectors fires.
const CAPTURE_MSG =
  "fs/child_process functions must be looked up at call time (namespace import, no module-scope alias or destructuring) so the activation spies see them.";
const WATCHED_MODULES = "/^(node:)?(fs|fs.promises|child_process)$/";
const captureBans = [
  { selector: `ImportDeclaration[source.value=${WATCHED_MODULES}] > ImportSpecifier`, message: CAPTURE_MSG },
  { selector: `ImportDeclaration[source.value=${WATCHED_MODULES}] > ImportDefaultSpecifier`, message: CAPTURE_MSG },
  {
    selector: `VariableDeclarator[id.type='ObjectPattern'][init.type='CallExpression'][init.callee.name='require'][init.arguments.0.value=${WATCHED_MODULES}]`,
    message: CAPTURE_MSG,
  },
  {
    selector:
      "VariableDeclarator[init.type='MemberExpression'][init.object.type='CallExpression'][init.object.callee.name='require']",
    message: CAPTURE_MSG,
  },
  { selector: "Program > VariableDeclaration > VariableDeclarator[init.type='MemberExpression']", message: CAPTURE_MSG },
  {
    selector: "Program > ExportNamedDeclaration > VariableDeclaration > VariableDeclarator[init.type='MemberExpression']",
    message: CAPTURE_MSG,
  },
  { selector: "Program > VariableDeclaration > VariableDeclarator[id.type='ObjectPattern']", message: CAPTURE_MSG },
  {
    selector: "Program > ExportNamedDeclaration > VariableDeclaration > VariableDeclarator[id.type='ObjectPattern']",
    message: CAPTURE_MSG,
  },
];

export default tseslint.config(
  { ignores: ["dist/", "out/", "node_modules/", ".vscode-test/"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "no-restricted-syntax": ["error", ...shellBans],
    },
  },
  {
    // Rule arrays replace rather than merge, so the src/ block restates the
    // shell bans alongside the capture bans.
    files: ["src/**/*.ts"],
    rules: {
      "no-restricted-syntax": ["error", ...shellBans, ...captureBans],
    },
  },
  {
    files: ["esbuild.mjs", "eslint.config.mjs", ".vscode-test.mjs", "vitest.config.ts"],
    languageOptions: { globals: { process: "readonly", console: "readonly" } },
  },
);
