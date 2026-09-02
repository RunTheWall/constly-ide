// The manifest is a contract too: activation surface, menus, settings, and
// identity are asserted here so a well-meaning edit cannot quietly widen the
// start-up surface (E4), put the button into a diff view, or ship a runtime
// dependency. "No menu contribution in a diff editor" is asserted on the
// `when` clauses — VS Code exposes no API to enumerate rendered menu items.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DOWNLOAD_URL, EXTENSION_ID } from "../../src/identity";

const pkg = JSON.parse(readFileSync(join(__dirname, "..", "..", "package.json"), "utf8"));
const menus: Record<string, { command: string; when: string; group?: string }[]> = pkg.contributes.menus;
const REQUIRED_WHEN = [
  "resourceScheme == file",
  "resourceExtname =~ /\\.(md|markdown|mdx)$/i",
  "!isWeb",
  "!isInDiffEditor",
];

describe("package.json — identity", () => {
  it("publisher.name is the id the code uses", () => {
    expect(`${pkg.publisher}.${pkg.name}`).toBe(EXTENSION_ID);
    expect(pkg.displayName).toBe("Open Markdown in Constly");
    expect(pkg.license).toBe("MIT");
    expect(pkg.pricing).toBe("Free");
    expect(pkg.homepage).toBe("https://constly.com");
    expect(pkg.repository).toEqual({ type: "git", url: "https://github.com/RunTheWall/constly-ide.git", directory: "vscode" });
    expect(pkg.icon).toBe("icon.png");
    expect(pkg.keywords.length).toBeLessThanOrEqual(30);
  });

  it("pre-release convention: odd minor", () => {
    expect(Number(pkg.version.split(".")[1]) % 2).toBe(1);
  });

  it("the install funnel URL carries only the ref query", () => {
    expect(DOWNLOAD_URL).toBe("https://constly.com/download?ref=vscode");
  });
});

describe("package.json — activation surface (E4)", () => {
  it("activates on onStartupFinished and onUri only; commands are inferred", () => {
    expect(pkg.activationEvents).toEqual(["onStartupFinished", "onUri"]);
  });

  it("is a UI extension pinned to the 1.85 API, with matching typings", () => {
    expect(pkg.extensionKind).toEqual(["ui"]);
    expect(pkg.engines.vscode).toBe("^1.85.0");
    expect(pkg.devDependencies["@types/vscode"]).toBe("~1.85.0");
  });

  it("has zero runtime dependencies and ships the bundle", () => {
    expect(pkg.dependencies).toBeUndefined();
    expect(pkg.main).toBe("./dist/extension.js");
  });

  it("contributes no walkthrough (it would auto-open on install) and no default keybinding", () => {
    expect(pkg.contributes.walkthroughs).toBeUndefined();
    expect(pkg.contributes.keybindings).toBeUndefined();
  });
});

describe("package.json — commands and menus", () => {
  it("contributes exactly the B1 commands, all palette-reachable (no commandPalette hiding)", () => {
    expect(pkg.contributes.commands.map((c: { command: string }) => c.command)).toEqual([
      "constly.open",
      "constly.locate",
      "constly.install",
    ]);
    expect(menus.commandPalette).toBeUndefined();
    for (const c of pkg.contributes.commands) expect(c.category).toBe("Constly");
  });

  it.each(["editor/title", "editor/context", "editor/title/context", "explorer/context"])(
    "%s shows Open in Constly only for local Markdown files outside diff editors and the web",
    (menu) => {
      const entries = menus[menu];
      expect(entries).toHaveLength(1);
      expect(entries[0].command).toBe("constly.open");
      for (const clause of REQUIRED_WHEN) expect(entries[0].when).toContain(clause);
    },
  );

  it("the title-bar button also honours constly.showEditorTitleButton and sits in the navigation group", () => {
    expect(menus["editor/title"][0].when).toContain("config.constly.showEditorTitleButton");
    expect(menus["editor/title"][0].group).toBe("navigation");
    expect(pkg.contributes.commands[0].icon).toBeDefined();
  });

  it("contributes menus nowhere else", () => {
    expect(Object.keys(menus).sort()).toEqual(["editor/context", "editor/title", "editor/title/context", "explorer/context"]);
  });
});

describe("package.json — settings", () => {
  const props = pkg.contributes.configuration.properties;

  it("constly.path is machine-scoped so a workspace cannot choose the binary", () => {
    expect(props["constly.path"]).toMatchObject({ type: "string", default: "", scope: "machine" });
  });

  it("constly.afterOpen is keep | close, default close", () => {
    expect(props["constly.afterOpen"]).toMatchObject({ type: "string", enum: ["keep", "close"], default: "close", scope: "window" });
  });

  it("constly.passCaret and constly.showEditorTitleButton default on", () => {
    expect(props["constly.passCaret"]).toMatchObject({ type: "boolean", default: true });
    expect(props["constly.showEditorTitleButton"]).toMatchObject({ type: "boolean", default: true });
  });

  it("contributes exactly the B1 settings", () => {
    expect(Object.keys(props).sort()).toEqual(["constly.afterOpen", "constly.passCaret", "constly.path", "constly.showEditorTitleButton"]);
  });
});
