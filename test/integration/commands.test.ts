// Integration: the three commands inside a real VS Code, with the detector
// and launcher injected through the extension's exported API so no Constly is
// ever spawned. Files are created in a temp dir; dirty state is made through
// the VS Code API exactly as a user's typing would.
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as vscode from "vscode";
import { contractPath } from "../../src/argv";
import type { Detection } from "../../src/detect";
import type { ConstlyExtensionApi } from "../../src/extension";
import type { HandOffResult } from "../../src/handoff";
import type { LaunchInvocation } from "../../src/launch";
import { EXTENSION_ID, makeTempDir, writeFile } from "../shared/harness";

const fakeTarget = { kind: "binary", exe: "/nonexistent/constly", degraded: false } as const;
const found: Detection = { kind: "found", target: fakeTarget, source: "setting" };
const notFound: Detection = { kind: "not-found" };
const IDE_ID_RE = /^[a-z][a-z0-9-]{0,31}$/;

function expectedFrom(): string[] {
  const scheme = vscode.env.uriScheme;
  return IDE_ID_RE.test(scheme) ? [`--from=${scheme}`] : [];
}

let api: ConstlyExtensionApi;
let tmp: string;
let calls: (LaunchInvocation & { dirtyAtLaunch: boolean })[];
let detectorCalls: number;

function config(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration("constly");
}

async function setConfig(key: string, value: unknown): Promise<void> {
  await config().update(key, value, vscode.ConfigurationTarget.Global);
}

async function closeAllEditors(): Promise<void> {
  await vscode.commands.executeCommand("workbench.action.closeAllEditors");
}

async function openAndShow(file: string): Promise<vscode.TextEditor> {
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
  return vscode.window.showTextDocument(doc, { preview: false });
}

/** Make a document dirty without showing it (an Explorer-selected file the user edited earlier). */
async function dirty(file: string, text: string): Promise<vscode.TextDocument> {
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
  const edit = new vscode.WorkspaceEdit();
  edit.insert(doc.uri, new vscode.Position(doc.lineCount, 0), text);
  assert.ok(await vscode.workspace.applyEdit(edit), "applyEdit");
  assert.equal(doc.isDirty, true, `${file} should be dirty`);
  return doc;
}

function tabsShowing(file: string): vscode.Tab[] {
  const key = vscode.Uri.file(file).toString();
  return vscode.window.tabGroups.all
    .flatMap((g) => g.tabs)
    .filter((t) => t.input instanceof vscode.TabInputText && t.input.uri.toString() === key);
}

function run(...args: unknown[]): Thenable<HandOffResult> {
  return vscode.commands.executeCommand<HandOffResult>("constly.open", ...args);
}

suite("Constly bridge — commands", () => {
  suiteSetup(async function () {
    this.timeout(60_000);
    const ext = vscode.extensions.getExtension<ConstlyExtensionApi>(EXTENSION_ID);
    assert.ok(ext, `extension ${EXTENSION_ID} is installed in the test host`);
    api = await ext.activate();
    tmp = makeTempDir();
  });

  setup(async () => {
    calls = [];
    detectorCalls = 0;
    api.test.resetDetectionCache();
    api.test.setDetector(async () => {
      detectorCalls += 1;
      return found;
    });
    api.test.setLauncher(async (inv) => {
      const doc = vscode.workspace.textDocuments.find((d) => contractPath(d.uri.fsPath) === inv.path);
      calls.push({ ...inv, dirtyAtLaunch: doc?.isDirty === true });
    });
    await setConfig("afterOpen", "keep");
    await setConfig("passCaret", true);
    await closeAllEditors();
  });

  suiteTeardown(async () => {
    api.test.setDetector(undefined);
    api.test.setLauncher(undefined);
    await setConfig("afterOpen", undefined);
    await setConfig("passCaret", undefined);
    await closeAllEditors();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  test("registers constly.open, constly.locate and constly.install", async () => {
    const all = await vscode.commands.getCommands(true);
    for (const id of ["constly.open", "constly.locate", "constly.install"]) {
      assert.ok(all.includes(id), `${id} registered`);
    }
  });

  test("from the active editor: saves the dirty document, then launches once with the caret", async () => {
    const file = writeFile(tmp, "a.md", "line one\nline two\nline three\n");
    const editor = await openAndShow(file);
    await editor.edit((e) => e.insert(new vscode.Position(0, 8), " edited"));
    assert.equal(editor.document.isDirty, true);
    editor.selection = new vscode.Selection(new vscode.Position(2, 4), new vscode.Position(2, 4));

    const result = await run();

    assert.equal(result.status, "launched");
    assert.equal(editor.document.isDirty, false, "saved before hand-off");
    assert.equal(fs.readFileSync(file, "utf8"), "line one edited\nline two\nline three\n");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].dirtyAtLaunch, false, "the launcher saw a clean document");
    assert.deepEqual(calls[0].target, fakeTarget);
    assert.equal(calls[0].path, contractPath(editor.document.uri.fsPath));
    assert.deepEqual([...calls[0].argv], ["--goto=3:5", ...expectedFrom(), "--", contractPath(editor.document.uri.fsPath)]);
  });

  test("passCaret = false: no --goto", async () => {
    await setConfig("passCaret", false);
    const file = writeFile(tmp, "nocaret.md", "x\n");
    const editor = await openAndShow(file);
    const result = await run();
    assert.equal(result.status, "launched");
    assert.deepEqual([...calls[0].argv], [...expectedFrom(), "--", contractPath(editor.document.uri.fsPath)]);
  });

  test("from an Explorer multi-selection: saves each dirty target and launches once per path, in order, without a caret", async () => {
    const b = writeFile(tmp, "b.md", "b\n");
    const c = writeFile(tmp, "c.md", "c\n");
    const d = writeFile(tmp, "d.md", "d\n");
    const other = writeFile(tmp, "other.md", "other\n");
    const docB = await dirty(b, "more b\n");
    const docC = await dirty(c, "more c\n");
    await openAndShow(other); // the active editor is NOT the first target

    const uris = [b, c, d].map((f) => vscode.Uri.file(f));
    const result = await run(uris[0], uris);

    assert.equal(result.status, "launched");
    assert.deepEqual(result.launched, uris.map((u) => contractPath(u.fsPath)));
    assert.equal(docB.isDirty, false);
    assert.equal(docC.isDirty, false);
    assert.equal(fs.readFileSync(b, "utf8"), "b\nmore b\n");
    assert.equal(fs.readFileSync(c, "utf8"), "c\nmore c\n");
    assert.deepEqual(
      calls.map((x) => x.path),
      uris.map((u) => contractPath(u.fsPath)),
    );
    assert.deepEqual(
      calls.map((x) => x.dirtyAtLaunch),
      [false, false, false],
    );
    for (const call of calls) {
      assert.deepEqual([...call.argv], [...expectedFrom(), "--", call.path]);
    }
  });

  test("an Explorer selection whose first file is the active editor gets that editor's caret", async () => {
    const e = writeFile(tmp, "e.md", "1\n2\n3\n4\n");
    const f = writeFile(tmp, "f.md", "f\n");
    const editor = await openAndShow(e);
    editor.selection = new vscode.Selection(new vscode.Position(3, 0), new vscode.Position(3, 0));
    const uris = [e, f].map((x) => vscode.Uri.file(x));
    await run(uris[0], uris);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].argv[0], "--goto=4:1");
    assert.ok(!calls[1].argv.some((a) => a.startsWith("--goto=")), "--goto rides on the first launch only");
  });

  test("untitled document: refused with a Save As offer, nothing launched", async () => {
    const doc = await vscode.workspace.openTextDocument({ language: "markdown", content: "# draft\n" });
    await vscode.window.showTextDocument(doc);
    const result = await run();
    assert.equal(result.status, "nothing-to-open");
    assert.deepEqual(
      result.skipped.map((s) => s.reason),
      ["untitled"],
    );
    assert.equal(calls.length, 0);
    assert.equal(detectorCalls, 0, "no detection for a hand-off that cannot happen");
  });

  test("remote (non-file) URI: refused, nothing launched", async () => {
    const remote = vscode.Uri.parse("vscode-remote://ssh-remote%2Bbox/home/ada/notes.md");
    const result = await run(remote);
    assert.equal(result.status, "nothing-to-open");
    assert.deepEqual(result.skipped, [{ uri: remote.toString(), reason: "remote" }]);
    assert.equal(calls.length, 0);
  });

  test("a mixed selection hands over the local files and skips the remote one", async () => {
    const g = writeFile(tmp, "g.md", "g\n");
    const remote = vscode.Uri.parse("vscode-remote://wsl%2BUbuntu/home/ada/notes.md");
    const result = await run(remote, [remote, vscode.Uri.file(g)]);
    assert.equal(result.status, "launched");
    assert.deepEqual(result.launched, [contractPath(vscode.Uri.file(g).fsPath)]);
    assert.deepEqual(
      result.skipped.map((s) => s.reason),
      ["remote"],
    );
  });

  test("a negative detection is re-run on the next command; a positive one is cached for the session", async () => {
    const answers: Detection[] = [notFound, notFound, found];
    api.test.setDetector(async () => {
      detectorCalls += 1;
      return answers.shift() ?? found;
    });
    const h = writeFile(tmp, "h.md", "h\n");
    const uri = vscode.Uri.file(h);

    assert.equal((await run(uri)).status, "not-installed");
    assert.equal((await run(uri)).status, "not-installed");
    assert.equal(calls.length, 0, "nothing launched while Constly is absent");
    assert.equal((await run(uri)).status, "launched");
    assert.equal((await run(uri)).status, "launched");
    assert.equal(detectorCalls, 3, "two misses re-probed, then one hit served the fourth command from cache");
    assert.equal(calls.length, 2);
  });

  test("changing constly.path drops the cached detection", async () => {
    const i = writeFile(tmp, "i.md", "i\n");
    await run(vscode.Uri.file(i));
    assert.equal(detectorCalls, 1);
    await setConfig("path", "/tmp/somewhere-else");
    try {
      await run(vscode.Uri.file(i));
      assert.equal(detectorCalls, 2, "re-detected after the setting changed");
    } finally {
      await setConfig("path", undefined);
    }
  });

  test("afterOpen = close closes the handed-off tab; keep leaves it", async () => {
    const j = writeFile(tmp, "j.md", "j\n");
    await openAndShow(j);
    assert.equal(tabsShowing(j).length, 1);
    await run();
    assert.equal(tabsShowing(j).length, 1, "keep: still open");

    await setConfig("afterOpen", "close");
    await openAndShow(j);
    const result = await run();
    assert.equal(result.status, "launched");
    assert.equal(tabsShowing(j).length, 0, "close: tab gone");
  });

  test("a launcher failure stops the hand-off and reports it", async () => {
    api.test.setLauncher(async (inv) => {
      if (inv.path.endsWith("l.md")) throw new Error("spawn ENOENT");
      calls.push({ ...inv, dirtyAtLaunch: false });
    });
    const k = writeFile(tmp, "k.md", "k\n");
    const l = writeFile(tmp, "l.md", "l\n");
    const m = writeFile(tmp, "m.md", "m\n");
    const uris = [k, l, m].map((f) => vscode.Uri.file(f));
    const result = await run(uris[0], uris);
    assert.equal(result.status, "launch-failed");
    assert.deepEqual(result.launched, [contractPath(uris[0].fsPath)]);
    assert.match(result.error ?? "", /ENOENT/);
    assert.equal(calls.length, 1);
  });

  test("invalid constly.path is reported, not worked around", async () => {
    api.test.setDetector(async (configured) => ({ kind: "invalid-path", path: configured }));
    await setConfig("path", "/no/such/Constly.app");
    try {
      const n = writeFile(tmp, "n.md", "n\n");
      const result = await run(vscode.Uri.file(n));
      assert.equal(result.status, "invalid-path");
      assert.equal(calls.length, 0);
    } finally {
      await setConfig("path", undefined);
    }
  });

  test("with no active editor and no argument there is nothing to open", async () => {
    const result = await run();
    assert.equal(result.status, "nothing-to-open");
    assert.equal(calls.length, 0);
  });
});
