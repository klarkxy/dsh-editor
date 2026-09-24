# DSH Editor UI design

## Reference and scope

The visual reference is **the official MoonshotAI/kimi-code Web UI**, at revision
`e7d5a0aee74e7f116cca0273c416ece9139a78a0`, before `apps/kimi-web` was moved out
of the public repository. It is not a third-party Kimi desktop client, and it is
not a claim of pixel parity with today's internally maintained desktop client.

Reference files: `apps/kimi-web/src/style.css`, `components/ui/Button.vue`, and
`views/DesignSystemView.vue`. Adapted upstream portions retain their MIT notice
in `packages/dsh-editor-shell/resources/third-party/kimi-web-MIT.txt`, included
by the shell package's existing `resources` packaging rule. DSH's name, artwork
and identity stay DSH's; no Kimi logo, character art or font files are copied.

React, Electron, Radix, CodeMirror, DSH's connection/runtime services, the model
router, conversation state, approval checks and file-write contracts are unchanged.
This is a **visual adapter**, not a replacement frontend or an engine fork.

## Appearance ownership

`src/design-system/tokens.ts` owns the namespaced semantic tokens. Light/dark
palettes follow the official reference: white/near-black reading surfaces,
slightly separate navigation surfaces, neutral selection and a blue action accent.
The darker upstream blue is used for small white primary-button labels to meet
4.5:1 contrast. Dark primary labels use dark ink on the lighter blue. Existing
explicit accent preferences are retained; only an unset accent defaults to blue.

`src/design-system/styles.ts` owns appearance over the existing Radix and shell
DOM. `styles.ts` still provides structural contracts (CodeMirror, native titlebar,
resizers, hidden/inert panels and plugin seats). The adapter is an explicit bridge
for the frozen frontend stack, not permission to add a second competing skin.
For subsequent changes, edit the relevant rule in this adapter; do not append
new overrides to the old file or scatter per-screen color literals.

The active shell installs a reference-counted `html[data-dsh-ui="kimi-web"]`
scope before paint. This reaches Radix's body portals, whose theme wrappers do
not necessarily retain `.shell-theme`. Each wrapper's own light/dark class is
respected, including the two simultaneous themes in the component gallery.
Unmount restores the prior host marker without undoing a later external change.

Namespaced spacing/radius/type/motion tokens coexist with Radix's own scales.
Radix spacing and stacking values are not globally renumbered, preserving existing
geometry and overlay ordering. Plugins inherit tokens but component-selector
rules explicitly stop at `[data-dsh-plugin-surface]`.

## Surfaces covered

The adapter covers shell chrome, neutral file navigation and active settings tabs,
buttons/inputs/selects/badges, manuscript surroundings and action strip, assistant
prose and user bubbles, disclosure/process rows, one-surface composer, send/stop
controls, proposal/conflict cards, menus, dialogs, command palette, scrollbars,
narrow layouts and reduced-motion/forced-colors fallbacks.

The author's font, size, line-height, line-width and completion settings are not
reset. Theme changes do not replace or key the editor. Existing actions remain
reachable; hiding advanced capabilities is not part of this change. Process
cards keep their real statuses and no synthetic progress percentages are added.
The proposal preview's height cap is increased; proposal approval and stale-file
checks are unchanged. A dedicated full-document review workflow is not introduced
by this visual change.

## Live component reference

Press **Ctrl + Alt + Shift + D** in the shell to open the live design-system
gallery. It uses production Radix controls and production tokens, with light and
dark examples together. Its controls are examples and never write to a workspace.
The shortcut does not steal an open modal, repeat keydown or IME composition.
Escape closes the dialog and returns focus. The gallery is a developer reference,
not an additional everyday authoring toolbar.

Before changing UI: identify the user action and hierarchy, reuse the existing
primitive, use the finite token scales, and inspect both themes and keyboard
states. Avoid gradients, blur, glowing shadows, tiny essential copy, unrelated
emoji icons and perpetual decorative animation. Color is not the only status cue.

## Validation

Dependency-free token/lifecycle/contrast checks:

```sh
node --experimental-strip-types scripts/check-ui-design.mjs
```

Existing workspace build, typecheck and tests remain the integration gates:

```sh
pnpm build
pnpm typecheck
pnpm test --maxWorkers=2
```

Real Radix browser fixture (no model request or workspace write):

```sh
pnpm exec playwright install chromium
node e2e/ui-design.mjs
```

The fixture bundles the production `ShellTheme`, production Radix stylesheet,
existing structural shell CSS and the new adapter through the existing tsdown
stack. It checks portalled dialog theming, focus return, stable input nodes on
theme changes, disabled send state, plugin isolation, viewport overflow and
reduced motion. Screenshots are written to `.artifacts/ui-design/` and uploaded
by the `UI design contracts` workflow. No new package or lockfile is needed.

**The fixture is not the complete app.** It does not validate real CodeMirror IME,
Electron window controls, model streaming or saving/conflict handling. Final
acceptance still needs the running desktop: 100/125/150% OS scaling, Chinese IME,
long titles and documents, docked/pinned/focus layouts, long conversations,
reconnecting, pending approvals, conflicts, and actual installed plugin surfaces.
Passing CSS checks or reviewing fixture screenshots is not a substitute.
