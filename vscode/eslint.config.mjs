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
// alias or assignment, a class field — bypasses the patch and would blind the
// spies while their positive control stayed green.
//
// The guard has two halves. (1) The watched modules may enter src/ only as
// namespace imports under a canonical local name (fs, fsp, cp) — or as a
// top-level require under that same name — so the namespace is always
// recognisable by name. (2) Every module-scope capture form is banned when
// keyed on one of those names, and nothing else: `const { join } = path` or
// `export const T = vscode.ConfigurationTarget.Global` stay legal, so nobody
// learns to write eslint-disable comments that would also hide a real capture.
// scripts/lint-guard-self-test.sh proves each selector fires and each innocent
// form passes.
const CAPTURE_MSG =
  "fs/child_process functions must be looked up at call time (namespace import as fs/fsp/cp, no module-scope alias, assignment or destructuring) so the activation spies see them.";
// Deliberately `fs\/promises`: require('fs/promises') is the same object as
// fs.promises, and a captured function from it hides just as well.
const WATCHED = "/^(node:)?(fs|fs\\/promises|child_process)$/";
const NS = "/^(fs|fsp|cp)$/";
/** `<field>` is a MemberExpression rooted in a watched namespace: `fs.x` or `fs.promises.x`. */
const rootedInNs = (field) => `:matches([${field}.object.name=${NS}], [${field}.object.object.name=${NS}])`;
/** `<field>` is a watched namespace or a member of one: `cp` or `fs.promises`. */
const isNsOrMember = (field) => `:matches([${field}.name=${NS}], [${field}.object.name=${NS}])`;
/** The node itself is a MemberExpression rooted in a watched namespace. */
const selfRootedInNs = `:matches([object.name=${NS}], [object.object.name=${NS}])`;
const requireOf = (field) => `[${field}.type='CallExpression'][${field}.callee.name='require'][${field}.arguments.0.value=${WATCHED}]`;

const captureBans = [
  // (1) how the watched modules may enter src/
  { selector: `ImportDeclaration[source.value=${WATCHED}] > ImportSpecifier`, message: CAPTURE_MSG },
  { selector: `ImportDeclaration[source.value=${WATCHED}] > ImportDefaultSpecifier`, message: CAPTURE_MSG },
  { selector: `ImportDeclaration[source.value=${WATCHED}] > ImportNamespaceSpecifier[local.name!=${NS}]`, message: CAPTURE_MSG },
  { selector: `Program > VariableDeclaration > VariableDeclarator${requireOf("init")}[id.name!=${NS}]`, message: CAPTURE_MSG },
  {
    selector: `Program > VariableDeclaration > VariableDeclarator[init.type='TSAsExpression']${requireOf("init.expression")}[id.name!=${NS}]`,
    message: CAPTURE_MSG,
  },
  // (2) capture forms, keyed on the namespace (or on the required module)
  { selector: `VariableDeclarator[id.type='ObjectPattern']${requireOf("init")}`, message: CAPTURE_MSG },
  { selector: `VariableDeclarator[id.type='ObjectPattern'][init.type='TSAsExpression']${requireOf("init.expression")}`, message: CAPTURE_MSG },
  { selector: `VariableDeclarator[init.type='MemberExpression']${requireOf("init.object")}`, message: CAPTURE_MSG },
  { selector: `Program > VariableDeclaration > VariableDeclarator[init.type='MemberExpression']${rootedInNs("init")}`, message: CAPTURE_MSG },
  {
    selector: `Program > ExportNamedDeclaration > VariableDeclaration > VariableDeclarator[init.type='MemberExpression']${rootedInNs("init")}`,
    message: CAPTURE_MSG,
  },
  { selector: `Program > VariableDeclaration > VariableDeclarator[id.type='ObjectPattern']${isNsOrMember("init")}`, message: CAPTURE_MSG },
  {
    selector: `Program > ExportNamedDeclaration > VariableDeclaration > VariableDeclarator[id.type='ObjectPattern']${isNsOrMember("init")}`,
    message: CAPTURE_MSG,
  },
  { selector: `Program > ExpressionStatement > AssignmentExpression[right.type='MemberExpression']${rootedInNs("right")}`, message: CAPTURE_MSG },
  { selector: `Program > ExpressionStatement > AssignmentExpression[left.type='ObjectPattern']${isNsOrMember("right")}`, message: CAPTURE_MSG },
  { selector: `PropertyDefinition[value.type='MemberExpression']${rootedInNs("value")}`, message: CAPTURE_MSG },
  // Optional chaining: `fs?.existsSync` is a ChainExpression wrapping the
  // MemberExpression, so the forms above would miss it while the capture still
  // happens at module load. Same shapes, keyed through `.expression`.
  { selector: `Program > VariableDeclaration > VariableDeclarator[init.type='ChainExpression']${rootedInNs("init.expression")}`, message: CAPTURE_MSG },
  {
    selector: `Program > ExportNamedDeclaration > VariableDeclaration > VariableDeclarator[init.type='ChainExpression']${rootedInNs("init.expression")}`,
    message: CAPTURE_MSG,
  },
  { selector: `Program > ExpressionStatement > AssignmentExpression[right.type='ChainExpression']${rootedInNs("right.expression")}`, message: CAPTURE_MSG },
  { selector: `PropertyDefinition[value.type='ChainExpression']${rootedInNs("value.expression")}`, message: CAPTURE_MSG },
  // Array pattern: `const [f] = [fs.existsSync]` captures through an array
  // literal; any member of a watched namespace inside that literal is banned
  // (a call there would be a module-load probe, which is worse, not better).
  { selector: `Program > VariableDeclaration > VariableDeclarator[id.type='ArrayPattern'] > ArrayExpression MemberExpression${selfRootedInNs}`, message: CAPTURE_MSG },
  {
    selector: `Program > ExportNamedDeclaration > VariableDeclaration > VariableDeclarator[id.type='ArrayPattern'] > ArrayExpression MemberExpression${selfRootedInNs}`,
    message: CAPTURE_MSG,
  },
  // Object literal: `const ops = { exists: fs.existsSync }` captures the same
  // way through a property value; same descendant shape as the array case.
  { selector: `Program > VariableDeclaration > VariableDeclarator > ObjectExpression MemberExpression${selfRootedInNs}`, message: CAPTURE_MSG },
  {
    selector: `Program > ExportNamedDeclaration > VariableDeclaration > VariableDeclarator > ObjectExpression MemberExpression${selfRootedInNs}`,
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
