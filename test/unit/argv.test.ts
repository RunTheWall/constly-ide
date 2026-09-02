import { describe, expect, it } from "vitest";
import { buildArgv, caretFromZeroBased, fromIdFor, planLaunches } from "../../src/argv";

describe("argv — IDE contract v1", () => {
  it("produces the worked example byte for byte: --goto=42:9 --from=vscode -- /home/ada/notes/plan.md", () => {
    expect(buildArgv("/home/ada/notes/plan.md", { goto: { line: 42, col: 9 }, from: "vscode" })).toEqual([
      "--goto=42:9",
      "--from=vscode",
      "--",
      "/home/ada/notes/plan.md",
    ]);
  });

  it("converts VS Code's 0-based line/character to the contract's 1-based line:col", () => {
    expect(caretFromZeroBased(41, 8)).toEqual({ line: 42, col: 9 });
    expect(caretFromZeroBased(0, 0)).toEqual({ line: 1, col: 1 });
  });

  it("always emits the literal -- as its own token, right before the path", () => {
    const argv = buildArgv("/abs/-leading-dash.md");
    expect(argv).toEqual(["--", "/abs/-leading-dash.md"]);
    expect(argv.indexOf("--")).toBe(argv.length - 2);
  });

  it("omits --goto without a caret and --from without an id (the three-files example)", () => {
    expect(buildArgv("/abs/a.md", { from: "cursor" })).toEqual(["--from=cursor", "--", "/abs/a.md"]);
    expect(buildArgv("/abs/a.md", {})).toEqual(["--", "/abs/a.md"]);
  });

  it("plans one launch per path in order: --goto on the first only, --from on every one", () => {
    const plan = planLaunches(["/abs/a.md", "/abs/b.md", "/abs/c.md"], {
      goto: { line: 3, col: 1 },
      from: "cursor",
    });
    expect(plan.map((p) => p.path)).toEqual(["/abs/a.md", "/abs/b.md", "/abs/c.md"]);
    expect(plan[0].argv).toEqual(["--goto=3:1", "--from=cursor", "--", "/abs/a.md"]);
    expect(plan[1].argv).toEqual(["--from=cursor", "--", "/abs/b.md"]);
    expect(plan[2].argv).toEqual(["--from=cursor", "--", "/abs/c.md"]);
    expect(plan.filter((p) => p.argv.some((a) => a.startsWith("--goto="))).length).toBe(1);
  });

  describe("fromIdFor — the raw uriScheme only if it matches ^[a-z][a-z0-9-]{0,31}$", () => {
    it.each(["vscode", "vscode-insiders", "vscodium", "cursor", "windsurf", "code-oss", "a", "a".repeat(32)])(
      "accepts %s",
      (id) => expect(fromIdFor(id)).toBe(id),
    );
    it.each(["VSCode", "1code", "-code", "a".repeat(33), "with space", "under_score", "", "ü"])(
      "rejects %j (flag omitted, never mislabelled as vscode)",
      (id) => expect(fromIdFor(id)).toBeUndefined(),
    );
    it("rejects a missing scheme", () => expect(fromIdFor(undefined)).toBeUndefined());
  });
});
