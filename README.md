# Constly IDE bridges

Extensions that open Markdown files from your IDE in [Constly](https://constly.com),
the byte-faithful WYSIWYG Markdown editor. They contain no editor of their own:
Constly must be installed.

| Directory | What it is | Where it ships |
|---|---|---|
| [`vscode/`](vscode/) | **Open Markdown in Constly** for VS Code and its forks (Cursor, Windsurf, VSCodium, …) | Visual Studio Marketplace · Open VSX |
| `jetbrains/` | Constly for IntelliJ-based IDEs — not started yet | JetBrains Marketplace |

Each bridge does four things: detects the installed Constly, saves the file you
are handing over, launches Constly with the file and your cursor position, and
points you at the download page if Constly is missing. Nothing runs at IDE
start-up, nothing talks to the network, and nothing is collected.

How the bridges talk to Constly is a plain command line, documented at
[constly.com/docs/ide](https://constly.com/docs/ide).

## Contributing

Each directory has its own README with the build and test steps. CI runs the
test suites and packages the artifacts; publishing runs from a maintainer's
machine. Commits carry the author's own identity and no AI-assistant attribution
(the `no-ai-attribution` CI job enforces this).

## Licence

MIT — see [LICENSE](LICENSE).
