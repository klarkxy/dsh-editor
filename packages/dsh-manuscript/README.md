# dsh-manuscript

DSH GUI plugin: generic workspace file tree, prose editor, ghost completion, confirm bar for pending Chat proposals, selection rewrite, new/rename, prev/next, word count. Official Chat stays the Agent surface. Dotfiles such as `.dsh-editor` are hidden in the tree.

Compatible with `@deepseek-ai/dsh` 0.1.1-rc.1 (nested first-party packages 0.1.1-rc.2). Dual-face package: host ESM plus lazy-CJS `./client`. Seats tree+editor on `shell.overlay` so official Chat keeps `root`. Independent of `dsh-grill`.
