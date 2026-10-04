# DSH Editor UI design

## Reference and scope

The visual reference is the official **deepseek-ai/deepseek-harness** Web UI at tag
`dsh-v0.2.0-rc.2`, commit `639ed015397290b3745d163aafe02ffee4aa3f84`.

Reference files: `docs/web-styling.zh.md`, `docs/ui-radius.zh.md`, and
`packages/client/ui-theme/src/styles/base.css`, `design-platform.css`, and
`gradient-shadow-text.css`. Adapted upstream portions keep their MIT notice in
`packages/dsh-editor-shell/resources/third-party/deepseek-harness-MIT.txt`.
The earlier Kimi Web notice stays at
`packages/dsh-editor-shell/resources/third-party/kimi-web-MIT.txt`.
DSH's name, artwork and identity stay DSH's. No upstream font files are copied.

React, Electron, Radix, CodeMirror, DSH's connection/runtime services, the model
router, conversation state, approval checks and file-write contracts are unchanged.
This is a **visual adapter**, not a replacement frontend or an engine fork.
UI chrome uses the system font stack. Author typography for manuscript text is unchanged.

## Appearance ownership

`src/design-system/tokens.ts` owns the namespaced semantic tokens.

Light surfaces sit one step down from pure white: page `#f7f7f8`, surface and
sunken `#eff0f2`, raised `#ffffff`, sidebar `#f2f3f4`, text `#1a1c1f` and muted
`#5c6166`. Pure white paper with near-black body text was the light-mode glare
source, so raised surfaces stay the brightest layer and cards read as cards by
depth rather than by a pure-white comparison. Dark surfaces are background
`#151517`, surface `#232324`, raised `#2c2c2e`, sidebar `#1b1b1c`, text
`#f9fafb` and muted `#adb2b8`. Links, business state and focus use `#4176e6` /
`#7aaaff`. Small link text uses the darker official step `#4868b2` in light so
it stays at or above 4.5:1. An unset accent defaults to blue.

**The saved accent owns the shell, not only the links.** The primary action,
the send button, the current location in the sidebar and settings, the user
bubble, links and focus all follow the saved accent, so a saved accent is
recognisable from the main interface alone. The primary fill is not taken from
Radix's accent scale: Radix pairs `accent-9` with `accent-contrast` and that
pair does not clear 4.5:1 for every saved accent in light mode (teal is
3.07:1, blue 3.26:1). `ACCENT_SOLIDS` therefore pins a fill, hover and label
per accent and per mode, and `scripts/check-ui-design.mjs` verifies all fourteen
pairs. A Radix `Theme` without an `accentColor` keeps the static blue values.
The accent picker shows each choice as the exact fill that choice produces in
the current mode, because a swatch that previews a different colour is worse
than no swatch.

Radius follows the official roles: R4 details, R8 compact, R12 standard controls
and menu items, R16 code, diff and menus, R20 settings cards and bubbles, R28
composer, dialogs and main floating panels. Circles and pills set `corner-shape: round`.
`superellipse(1.5)` applies only inside `@supports`. Planar dividers and cards use
a 0.5px neutral border and no shadow. Menus, dialogs and the composer use
`border: 0` and an elevation shadow whose first layer is the 0.5px stroke.
Menu content may use the official translucent fill and `blur(40px) saturate(150%)`.
Modal masks are black and do not blur the page.

`src/design-system/styles.ts` owns appearance over the existing Radix and shell
DOM. `styles.ts` still provides structural contracts (CodeMirror, native titlebar,
resizers, hidden/inert panels and plugin seats). Edit the relevant adapter rule
when the appearance changes. Do not append a second skin to the old stylesheet.

The active shell installs a reference-counted `html[data-dsh-ui="dsh-official"]`
scope before paint. This reaches Radix's body portals, whose theme wrappers do
not necessarily retain `.shell-theme`. Each wrapper's own light/dark class is
respected, including the two simultaneous themes in the component gallery.
Unmount restores the prior host marker without undoing a later external change.

Namespaced spacing, radius, type and motion tokens coexist with Radix's own scales.
Radix spacing and stacking values are not globally renumbered. Plugins inherit
tokens, but component-selector rules stop at `[data-dsh-plugin-surface]`.

Official configuration components inherit DSH background, label, button, link
and border aliases from their local Radix Theme, including portals. Plugin
selectors remain with their owner. Small descriptions use the readable
secondary color step. Standard controls use 13px or larger text; the official
compact H20–28 controls and peripheral descriptions may use the 12px scale.

## Surfaces covered

The adapter covers home and recent work, shell chrome, neutral file navigation,
search, buttons, inputs, selects, badges, manuscript surroundings, assistant prose
and user bubbles, disclosure and process rows, one composer, send and stop,
proposal and conflict cards, menus, dialogs, command palette, import and export,
history, the plugin-page shell, scrollbars, narrow layouts, and reduced-motion
and forced-colors fallbacks.

The author's font, size, line-height, line-width and completion settings are not
reset. Theme changes do not replace or key the editor. Process rows keep their
real statuses. Proposal approval and stale-file checks are unchanged.

Built-in plugin panels, cards, overview, memory and proofread keep their own
style owners. This shell pass does not restyle their interiors.

## Live component reference

Press **Ctrl + Alt + Shift + D** in the shell to open the live design-system
gallery. It uses production Radix controls and production tokens, with light and
dark examples together. Its controls are examples and never write to a workspace.
The shortcut does not steal an open modal, repeat keydown or IME composition.
Escape closes the dialog and returns focus. The gallery is a developer reference,
not an additional everyday authoring toolbar.

Before changing UI: identify the user action and hierarchy, reuse the existing
primitive, use the finite token scales, and inspect both themes and keyboard
states. Do not add a second glass surface. Menu blur stays on the existing menu
rule. Color is not the only status cue.

## Validation

Dependency-free token, lifecycle and contrast checks:

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
existing structural shell CSS and the adapter through the existing tsdown stack.
It checks portalled dialog theming, an unblurred modal mask, menu material,
focus return, stable input nodes on theme changes, disabled send state, plugin
isolation, viewport overflow and reduced motion. Screenshots are written to
`.artifacts/ui-design/`. No new package or lockfile is needed.

**The fixture is not the complete app.** It does not validate Electron window
controls, model streaming or saving and conflict handling. Passing CSS checks
or reviewing fixture screenshots is not a substitute for the running desktop.

Input methods and display scaling use the existing operating system, Electron
and CodeMirror capabilities. Preserve existing input guards and verify affected
behavior when it changes or a problem is reported.
