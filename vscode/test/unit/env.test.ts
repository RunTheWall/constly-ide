import { describe, expect, it } from "vitest";
import { sanitisedEnv, shouldDropEnvVar } from "../../src/env";

const ideEnv = {
  PATH: "/usr/bin",
  HOME: "/Users/ada",
  ELECTRON_RUN_AS_NODE: "1",
  ELECTRON_NO_ATTACH_CONSOLE: "1",
  VSCODE_PID: "123",
  VSCODE_IPC_HOOK: "/tmp/x.sock",
  NODE_OPTIONS: "--max-old-space-size=4096",
  GTK_PATH: "/snap/code/current/usr/lib/gtk-3.0",
  GTK_EXE_PREFIX: "/snap/code/current/usr",
  GIO_MODULE_DIR: "/snap/code/current/usr/lib/gio/modules",
  GSETTINGS_SCHEMA_DIR: "/snap/code/current/usr/share/glib-2.0/schemas",
  LD_LIBRARY_PATH: "/snap/code/current/lib",
  LD_PRELOAD: "libfoo.so",
  UNDEFINED_ONE: undefined,
};

describe("sanitised environment", () => {
  it("drops ELECTRON_RUN_AS_NODE, ELECTRON_*, VSCODE_* and NODE_OPTIONS on every platform", () => {
    for (const platform of ["darwin", "win32", "linux"] as const) {
      const env = sanitisedEnv(ideEnv, platform);
      expect(env).not.toHaveProperty("ELECTRON_RUN_AS_NODE");
      expect(env).not.toHaveProperty("ELECTRON_NO_ATTACH_CONSOLE");
      expect(env).not.toHaveProperty("VSCODE_PID");
      expect(env).not.toHaveProperty("VSCODE_IPC_HOOK");
      expect(env).not.toHaveProperty("NODE_OPTIONS");
      expect(env.PATH).toBe("/usr/bin");
      expect(env.HOME).toBe("/Users/ada");
      expect(env).not.toHaveProperty("UNDEFINED_ONE");
    }
  });

  it("drops the GTK/GIO/LD set on Linux only (snap/Flatpak/AppImage exports that break WebKitGTK)", () => {
    const linux = sanitisedEnv(ideEnv, "linux");
    for (const k of ["GTK_PATH", "GTK_EXE_PREFIX", "GIO_MODULE_DIR", "GSETTINGS_SCHEMA_DIR", "LD_LIBRARY_PATH", "LD_PRELOAD"]) {
      expect(linux).not.toHaveProperty(k);
    }
    const mac = sanitisedEnv(ideEnv, "darwin");
    expect(mac.GTK_PATH).toBe(ideEnv.GTK_PATH);
    expect(mac.LD_PRELOAD).toBe(ideEnv.LD_PRELOAD);
  });

  it("matches names case-insensitively on Windows and exactly elsewhere", () => {
    expect(shouldDropEnvVar("vscode_pid", "win32")).toBe(true);
    expect(shouldDropEnvVar("Node_Options", "win32")).toBe(true);
    expect(shouldDropEnvVar("vscode_pid", "linux")).toBe(false);
    expect(shouldDropEnvVar("VSCODE_PID", "linux")).toBe(true);
  });

  it("returns a copy — the IDE's own environment is untouched", () => {
    const env = { ...ideEnv };
    sanitisedEnv(env, "linux");
    expect(env.VSCODE_PID).toBe("123");
  });
});
