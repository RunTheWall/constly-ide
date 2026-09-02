// Helpers shared by the integration and activation suites (they run inside the
// VS Code extension host under @vscode/test-cli's mocha).
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export const EXTENSION_ID = "constly.constly";

export function makeTempDir(prefix = "constly-vscode-"): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export function writeFile(dir: string, name: string, content: string): string {
  const p = path.join(dir, name);
  fs.writeFileSync(p, content, "utf8");
  return p;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitFor(
  predicate: () => boolean,
  timeoutMs: number,
  what: string,
  intervalMs = 100,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`timed out after ${timeoutMs} ms waiting for: ${what}`);
    await sleep(intervalMs);
  }
}
