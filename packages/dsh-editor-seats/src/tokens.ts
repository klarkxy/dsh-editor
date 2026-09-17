/*
 * Standalone Radix fallback. Injected by manuscript / overlay (and any host
 * that is not already inside `.radix-themes`) so those styles can read the
 * same variables the shell gets from `@radix-ui/themes`. Hex is allowed here
 * only; values are copied from Radix Themes gray + indigo (+ red / green /
 * amber) light/dark scales and tokens/base.css.
 *
 * Light: `:root:not(:has(.radix-themes))`
 * Dark:  `:root[data-theme="dark"]:not(:has(.radix-themes))`
 * When a `.radix-themes` ancestor exists, this block stays inert.
 */
const fonts = `
  --default-font-family: "Noto Sans SC", "PingFang SC", "Microsoft YaHei UI", system-ui, sans-serif;
  --code-font-family: ui-monospace, "SF Mono", "JetBrains Mono", Consolas, monospace;
  --font-weight-medium: 500;
  --font-size-1: 12px;
  --font-size-2: 14px;
  --font-size-3: 16px;
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 24px;
  --radius-2: 4px;
  --radius-3: 6px;
`

export const radixFallbackTokens = `:root:not(:has(.radix-themes)) {
  --gray-1: #fcfcfc;
  --gray-2: #f9f9f9;
  --gray-3: #f0f0f0;
  --gray-4: #e8e8e8;
  --gray-5: #e0e0e0;
  --gray-6: #d9d9d9;
  --gray-7: #cecece;
  --gray-8: #bbbbbb;
  --gray-9: #8d8d8d;
  --gray-10: #838383;
  --gray-11: #646464;
  --gray-12: #202020;
  --gray-a2: #00000006;
  --gray-a3: #0000000f;
  --gray-a4: #00000017;
  --gray-a5: #0000001f;
  --gray-a6: #00000026;
  --accent-8: #8da4ef;
  --accent-9: #3e63dd;
  --accent-10: #3358d4;
  --accent-11: #3a5bc7;
  --accent-a3: #0047f112;
  --accent-a4: #0044ff1e;
  --accent-a8: #0034dc72;
  --accent-contrast: #ffffff;
  --red-9: #e5484d;
  --red-11: #ce2c31;
  --green-9: #30a46c;
  --green-11: #218358;
  --amber-a4: #ffd40063;
  --amber-a6: #eab5008c;
  --color-background: #ffffff;
  --color-panel-solid: #ffffff;
  --color-surface: rgba(255, 255, 255, 0.85);
  --shadow-2: 0 0 0 1px #0000000f, 0 0 0 0.5px rgba(0, 0, 0, 0.05), 0 1px 1px 0 #00000006, 0 2px 1px -1px rgba(0, 0, 0, 0.05), 0 1px 3px 0 rgba(0, 0, 0, 0.05);
  --shadow-3: 0 0 0 1px #0000000f, 0 2px 3px -2px #0000000f, 0 3px 12px -4px rgba(0, 0, 0, 0.1), 0 4px 16px -8px rgba(0, 0, 0, 0.1);
  --shadow-4: 0 0 0 1px #0000000f, 0 8px 40px rgba(0, 0, 0, 0.05), 0 12px 32px -16px #0000000f;
${fonts}
  color-scheme: light;
}
:root[data-theme="dark"]:not(:has(.radix-themes)) {
  --gray-1: #111111;
  --gray-2: #191919;
  --gray-3: #222222;
  --gray-4: #2a2a2a;
  --gray-5: #313131;
  --gray-6: #3a3a3a;
  --gray-7: #484848;
  --gray-8: #606060;
  --gray-9: #6e6e6e;
  --gray-10: #7b7b7b;
  --gray-11: #b4b4b4;
  --gray-12: #eeeeee;
  --gray-a2: #ffffff09;
  --gray-a3: #ffffff12;
  --gray-a4: #ffffff1b;
  --gray-a5: #ffffff22;
  --gray-a6: #ffffff2c;
  --accent-8: #435db1;
  --accent-9: #3e63dd;
  --accent-10: #5472e4;
  --accent-11: #9eb1ff;
  --accent-a3: #2f62ff3c;
  --accent-a4: #3566ff57;
  --accent-a8: #5b81feac;
  --accent-contrast: #ffffff;
  --red-9: #e5484d;
  --red-11: #ff9592;
  --green-9: #30a46c;
  --green-11: #3dd68c;
  --amber-a4: #fc820032;
  --amber-a6: #fd9b0051;
  --color-background: #111111;
  --color-panel-solid: #191919;
  --color-surface: rgba(0, 0, 0, 0.25);
  --shadow-2: 0 0 0 1px #ffffff2c, 0 0 0 0.5px rgba(0, 0, 0, 0.15), 0 1px 1px 0 rgba(0, 0, 0, 0.4), 0 2px 1px -1px rgba(0, 0, 0, 0.4), 0 1px 3px 0 rgba(0, 0, 0, 0.3);
  --shadow-3: 0 0 0 1px #ffffff2c, 0 2px 3px -2px rgba(0, 0, 0, 0.15), 0 3px 8px -2px rgba(0, 0, 0, 0.4), 0 4px 12px -4px rgba(0, 0, 0, 0.5);
  --shadow-4: 0 0 0 1px #ffffff2c, 0 8px 40px rgba(0, 0, 0, 0.15), 0 12px 32px -16px rgba(0, 0, 0, 0.3);
${fonts}
  color-scheme: dark;
}`
