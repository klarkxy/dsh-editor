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

Light surfaces are white for the page and raised cards, with sidebar `#f9fafb`,
text `#0f1115` and muted `#61666b`. Dark surfaces are background `#151517`,
surface `#232324`, raised `#2c2c2e`, sidebar `#1b1b1c`, text `#f9fafb` and
muted `#adb2b8`. The primary button is neutral: `#0f1115` on white in light,
and `#f9fafb` with `#0f1115` text in dark. Links, business state and focus use
`#4176e6` / `#7aaaff`. Small link text uses the darker official step `#4868b2`
in light so it stays at or above 4.5:1. The seven saved accent preferences still
recolor links, focus and business state together. They do not recolor the neutral
primary button. An unset accent defaults to blue.

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
