# Open Markdown in Constly

This extension requires [Constly](https://constly.com), the byte-faithful WYSIWYG
Markdown editor, to be installed on this machine (placing the cursor needs
Constly 4.7.0 or later). **Open in Constly** saves the file if it has unsaved
changes, then opens it in Constly at the same line and column; nothing else
happens without you asking. Constly saves on ⌘S / Ctrl+S — it does not autosave
to disk — so press save in Constly to see a change back in VS Code. A file that
is dirty in *another* VS Code window is not saved by this extension; VS Code's
own "newer on disk" prompt protects that window's edits. The extension makes no
network requests and collects no data (Constly's own privacy policy covers
Constly). After a hand-off the VS Code tab is closed by default, because Constly
edits the file in place rather than previewing it; set `constly.afterOpen` to
`keep` to leave it open.

## Using it

- **Editor title bar** — the Open in Constly button on any `.md`, `.markdown`
  or `.mdx` file (hide it with `constly.showEditorTitleButton`).
- **Right-click** in the editor, on the editor tab, or on files in the Explorer
  (select several to open them all, in order).
- **Command Palette** — `Constly: Open in Constly`, `Constly: Locate Constly…`,
  `Constly: Install Constly…`.

No keyboard shortcut is bound by default. To add one, open *Preferences:
Open Keyboard Shortcuts (JSON)* and add, for example:

```json
{ "key": "ctrl+alt+o", "command": "constly.open", "when": "editorLangId == markdown" }
```

## Settings

| Setting | Default | What it does |
|---|---|---|
| `constly.path` | `""` | Explicit path to Constly: `Constly.app` on macOS, the `constly` executable elsewhere. Overrides detection. Machine-scoped — a workspace cannot set it. |
| `constly.afterOpen` | `close` | `close` the VS Code tab after handing the file over, or `keep` it (VS Code reloads it when Constly saves). |
| `constly.passCaret` | `true` | Put Constly's cursor where VS Code's was (Constly ≥ 4.7.0). |
| `constly.showEditorTitleButton` | `true` | Show the title-bar button on Markdown files. |

## How Constly is found

Detection runs only when you invoke a command, never at start-up, and a
positive result is remembered for the session. If Constly is not found you are
offered **Download Constly** and **Locate…**; once installed, the next command
finds it without a reload.

| OS | Looked at, in order |
|---|---|
| macOS | `/Applications/Constly.app`, `~/Applications/Constly.app`, then Spotlight (`mdfind`, scoped to those two folders) by bundle id |
| Windows | the installer's Uninstall registry entry (per-user, then per-machine), then `%LOCALAPPDATA%\Constly\constly.exe`, then `where constly` |
| Linux | `which constly`, then `/usr/bin/constly`; inside a Flatpak-sandboxed VS Code, the same through `flatpak-spawn --host` |

`Constly: Locate Constly…` lets you pick the app or executable yourself and
stores it in `constly.path`. On macOS, point it at `Constly.app`: a bare
`constly` binary also works, but runs as a child process of VS Code instead of
being launched by the system (the "degraded" mode).

## What it does not do

- **Remote workspaces** (SSH, WSL, containers, Codespaces): Constly opens files
  on this machine, so files in a remote workspace are refused with a message.
- **Untitled files**: save the file first so Constly has something to open.
- **The browser** (vscode.dev): not available.
- **Write your file**: the extension only saves what you already typed, and
  never touches the file otherwise.

The command line Constly accepts is documented at
[constly.com/docs/ide](https://constly.com/docs/ide).

## Privacy

This extension makes no network requests and collects no data. The
*Install Constly…* command opens `constly.com/download` in your browser; that is
the only link it follows, and only when you choose it.

## License

MIT — see [LICENSE](LICENSE).
