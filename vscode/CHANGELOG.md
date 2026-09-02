# Changelog

All notable changes to the Constly extension for VS Code. Pre-release versions
carry an odd minor (`0.1.x`); stable releases an even one.

## 0.1.0 — pre-release

The first bridge. It contains no editor: Constly must be installed.

- **Open in Constly** from the editor title bar, the editor and tab context
  menus, the Explorer (multi-select opens each file, in order) and the Command
  Palette. Unsaved changes are saved first; the cursor position travels along
  (Constly 4.7.0 or later).
- Finds Constly in the usual places on macOS, Windows and Linux (including a
  Flatpak-sandboxed VS Code), remembers a hit for the session, and offers
  **Download Constly** / **Locate…** when there is nothing to find. `constly.path`
  pins an explicit app or executable.
- `constly.afterOpen` (`close` by default, `keep` available), `constly.passCaret`,
  `constly.showEditorTitleButton`.
- Refuses remote files and untitled documents with a plain message rather than
  a broken launch. Nothing runs at start-up; there is no network access and no
  data collection.
