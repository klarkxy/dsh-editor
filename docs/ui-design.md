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

Light surfaces sit one step down from pure white: page `#f7f7f8`, surface
`#eff0f2`, sunken `#e8e9ec`, sidebar `#f0f1f3`, raised `#ffffff`, text `#1a1c1f`
and muted `#5c6166`. Pure white paper with near-black body text was the
light-mode glare source, so raised surfaces stay the brightest layer and cards
read as cards by depth rather than by a pure-white comparison. Dark surfaces run
the other way: background `#151517`, surface `#1e1e20`, raised `#2a2a2c`,
sidebar `#1a1a1c`, sunken `#0f0f11` below the surface, text `#f9fafb` and muted
`#adb2b8`. Links, business state and focus use `#4176e6` / `#7aaaff`. Small link
text uses the darker official step `#4868b2` in light so it stays at or above
4.5:1. An unset accent defaults to blue.

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
`superellipse(1.5)` applies only inside `@supports`. Planar dividers and resting
cards use a 0.5px neutral border and no shadow: dividers take `--dsh-ui-line`
(`rgba(0, 0, 0, 0.1)` light, `rgba(255, 255, 255, 0.12)` dark) and cards take
the stronger `--dsh-ui-line-strong`, with `.rt-Card`, `.home-card` and
`.home-entry-card` on one shared surface rule and Radix's `::before`/`::after`
decoration layers stripped. Settings blocks are the deliberate exception: inside
the settings dialog they drop the surface entirely — transparent, `border: 0`,
no radius, no shadow — and a 0.5px `border-top` between consecutive blocks is the
only thing separating them.

Elevation is reserved for surfaces that float, and every elevation token starts
with the 0.5px stroke as its first layer (`rgba(0, 0, 0, 0.16)` in light,
`rgba(255, 255, 255, 0.16)`–`0.2` in dark):

- `elevation-panel` — menu content and the assistant launcher;
- `elevation-prominent` — dialogs, the command palette and the narrow-window
  overlay drawers;
- `elevation-soft` — text fields, textareas, select triggers and the composer;
- `elevation-focus` — what fields and the composer swap in on focus-within: a
  0.5px accent stroke plus a 3px accent-soft ring. Other focusable controls use a
  2px accent outline with a 4px soft ring instead.

Menus, dialogs and the composer therefore use `border: 0` and an elevation
shadow rather than a hairline. The single exception to "flat cards stay flat" is
the home card hover, which lifts 2px with `elevation-prominent` so the target
under the pointer is unmistakable; every other interactive state is a fill
change. The official resource rail stays flat too: a left hairline border and
`box-shadow: none`.

Menu content may use the official translucent fill and `blur(40px) saturate(150%)`.
Modal masks are a black scrim (`rgba(0, 0, 0, 0.48)` light, `0.5` dark) and do
not blur the page.

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
secondary color step. Standard controls use 13px or larger text; compact
controls and peripheral descriptions may use the 12px scale. The shell's own
control heights run 32 / 36 / 40 / 44px with a 28px compact step.

Native status tags tint their foreground color into their background. The host
maps their state aliases to readable colors on that composite surface, including
small error text and plugin links. Success and error text retain their semantic
colors in both themes; the business state follows the saved accent. No component
selector crosses the plugin boundary.

Three version-pinned pnpm patches in `patches/` raise the official rc.2 tag and
plugin-manager text to these same minimum sizes. The plugin-manager patch also
keeps package names and internal component rows inside an advanced disclosure;
failed components and component metadata errors expand it, while configuration
and management errors remain visible.
The patches cover the plugin manager,
the primitive source stylesheet, and the primitive tag CSS embedded in the
prebundled Web frontend. They change the dependencies' own styles rather than
adding host selectors for generated plugin class names.
The patches apply during installation and are copied into development and
packaged runtimes. Development preparation invalidates its cached runtime when
the dependency lock changes. Review or remove these patches when upgrading DSH;
do not carry them onto a different upstream version without checking its styles.

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

## Layout and hit targets

Controls are sized from the token scale, not from their label: the sidebar
resizer keeps a 1px drawn rule inside a 12px hit strip, search fields are at
least one control tall, and the palette field is sized like the control it is.
The topbar shortcut hint is peripheral copy and never renders below the 12px
scale, including the `Kbd` inside the palette trigger, which is its own element
rather than the button.

Below 760px the topbar gives up its least useful width first: the palette
shortcut hint is hidden and the trigger keeps a full control width, while the
work menu keeps a real hit target with a truncated title. An earlier rule forced
`min-width: 0` on the work menu and left the author with an unreachable menu
(measured: 3px) at 390px. Where a row is tight, the label yields and the
controls do not: the sidebar title truncates before the create action and the
overflow menu shrink.

An empty conversation keeps the composer anchored at the bottom like a
non-empty one. Lifting the composer to the top of an empty rail left a screen
of dead space under the input and moved the input the moment the first turn
arrived.

The settings dialog keeps one height on every page
(`min(760px, 100dvh - margins)`): sizing it to each page's content made the
window jump between tabs, which is worse than slack inside a short page.

The topbar layout toggles are neutral controls, not locations: pressed state is
a sunken fill (hover fill in dark) with a hairline inset, never the accent
block, and the sidebar/assistant toggles use the paired panel glyphs rather than
the brand mark.

## Paper defaults

The manuscript surface is author-owned, so these are only the values an author
gets before touching the writing settings: system sans
(`"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei UI", "Microsoft YaHei",
"Noto Sans CJK SC", "Source Han Sans SC", system-ui, sans-serif`), 17px /
1.9, paragraph spacing 0.4em, paper width `medium` (76ch, centred). The serif
stack stays selectable; it was the previous default and fell back to SimSun on
Windows, where Noto Serif CJK is rarely installed. Headings in live preview
scale 1.6 / 1.35 / 1.15 / 1.05em at weight 600. The shell
(`writing-settings.tsx`, `writing-config.ts`) and the standalone editor core
(`dsh-manuscript` `typography.ts`, editor-core `styles.ts`) declare the same
defaults and their specs assert them.

Plugin surfaces take their primary colour from `--s-brand`, which aliases
`--dsh-ui-brand` (the saved accent) in `dsh-editor-seats/tokens`. It previously
aliased the text colour, so every plugin primary button rendered black beside an
accent-coloured shell.

## Narrow windows and author preference

A window that cannot fit both rails beside the paper is a size event, not a
layout choice, so `src/client/narrow-layout.ts` settles each rail as a pure
function over `{ open, yielded, crowded, authored }`:

- `yielded` records the choice the window made on the author's behalf, so
  widening restores the author's own layout instead of leaving the collapse as
  the new default;
- `authored` records that the author opened or closed the rail themselves in the
  current size class, and the width rule stands down until the class changes.
  Clearing only `yielded` is not enough: the follow-up settle closes the rail
  the author just opened, which makes the explicit control a no-op;
- **The saved layout preference belongs to the author, not to the current window.**
  `dsh-editor.layout.sidebar-open` / `assistant-open` may only be written by an
  author action. A width settle records its own choice in `yielded` instead, and
  the single-manuscript auto-collapse leaves the stored key alone, so neither
  one can become the author's new default;
- **"Skip the next write" is the wrong shape for that rule.** A one-shot skip flag
  is consumed by whichever persist effect runs first, and on mount the settle and
  the persist effect run in the same commit: the flag was spent writing the value
  that was already stored, and the yielded value landed in localStorage
  afterwards. A narrow-window reload permanently rewrote the assistant
  preference to `false`. The shell instead tracks whether the current `open`
  value *is* an author choice, and only an author action clears it — no
  consumption counting, so mount order cannot defeat it;
- **Every author open/close claims ownership**, including the ones that only exist
  in a narrow window: the topbar toggles, the official layout actions, the search
  and reveal paths, the assistant launcher, Escape closing an overlay drawer, and
  the overlay dismiss buttons. A path that changes a rail without claiming is a
  bug, because the preference silently stops following the author;
- switching workspaces reads the stored preference back and hands ownership to
  the author with it; the manuscript census claims it only when the decision came
  from the author's explicit single-manuscript choice, not from the auto-collapse.

Below 1040px the assistant becomes an overlay; below 760px the sidebar does
too, and the two overlays are mutually exclusive by a forced yield that ignores
`authored`. Nothing here writes to the author's saved preference except an
explicit toggle.

**Pixel widths are re-asserted after a breakpoint, not trusted to the panel
library.** react-resizable-panels keeps the assistant panel mounted at 0 width
when it leaves the grid, and its ResizeObserver rebalances the group by
percentage before the `collapse()` effect runs. On 1440 to 1024 the assistant's
stale share pushed the editor below its minimum, which clamped the sidebar from
260px to 200px, and `preserve-pixel-size` then kept 200px after widening. The
sync effect in `root-layout.ts` therefore resizes each rail back to the
author's stored pixel width whenever the grid membership or stored width
changes (two animation frames, because the observer may run after the first),
and wraps the imperative calls: a panel that has just remounted throws
`Layout not found` until it has a layout slot, and an uncaught throw in that
effect unmounted the whole tree when crossing 760px upward.

A tool that reveals the sidebar (proofread, memory) widens it to at least 336px
for the current window only; it does not write `sidebar-width`. An author drag
still persists through `onLayoutChanged` with `isUserInteraction`.

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

The fixture cannot see a window resize, a saved preference or an overlay that
replaces the layout. For those, drive the real editor in a real host: see
[UI/UX 实测记录](ui-ux-audit-2026-10.md) for the harness and the current
measurements.
