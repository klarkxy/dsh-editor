/*
 * 稿纸 paper/ink 设计令牌的唯一来源。shell、manuscript editor-core、
 * manuscript overlay、proofread、zhihu 的样式在构建期内联本模块,
 * 运行时各自注入的 token 块因此字节一致(相同规则无特异度冲突),
 * 取代原先三份手抄副本。accent 色彩风格覆盖仍只由 shell 注入。
 */
export const paperInkTokens = `:root,
:root[data-theme="paper"] {
  --bg: #f3f1e8;
  --bg-sunken: #ebe9df;
  --surface: #fdfcf6;
  --surface-warm: #e8e6dc;
  --fg: #141413;
  --fg-2: #3d3d3a;
  --muted: #504e49;
  --meta: #5a5954;
  --border: #d8d5c7;
  --border-soft: #e5e3d8;
  --hairline: rgba(20, 20, 19, 0.08);
  --hairline-strong: rgba(20, 20, 19, 0.12);
  --accent: #1b365d;
  --accent-soft: rgba(27, 54, 93, 0.08);
  --accent-on: #faf9f5;
  --accent-active: #142a48;
  --ghost: #615f57;
  --selection: #e4e6dc;
  --danger: #8a3a30;
  --confirm: #4a6b3a;
  --chrome-bg: #e6e5e0;
  --chrome-raised: #f2f1ec;
  --chrome-sunken: #dddbd4;
  --chrome-fg: #1c1c1b;
  --chrome-muted: #5c5b57;
  --elev-raised: 0 1px 2px rgba(20, 20, 19, 0.05), 0 8px 24px rgba(20, 20, 19, 0.07);
  --elev-card: 0 2px 6px rgba(20, 20, 19, 0.06), 0 14px 36px rgba(20, 20, 19, 0.1);
  --studio: #141413;
  color-scheme: light;
}
:root[data-theme="ink"] {
  --bg: #161310;
  --bg-sunken: #100e0b;
  --surface: #221e18;
  --surface-warm: #2c2820;
  --fg: #ede7d7;
  --fg-2: #cdc7b8;
  --muted: #a8a294;
  --meta: #979285;
  --border: #3d382f;
  --border-soft: #2a261f;
  --hairline: rgba(237, 231, 215, 0.07);
  --hairline-strong: rgba(237, 231, 215, 0.14);
  --accent: #9db4d0;
  --accent-soft: rgba(157, 180, 208, 0.16);
  --accent-on: #161310;
  --accent-active: #b6c9e0;
  --ghost: #979285;
  --selection: #2e3547;
  --danger: #c4786a;
  --confirm: #8aaa70;
  --chrome-bg: #1c1b18;
  --chrome-raised: #25231f;
  --chrome-sunken: #171612;
  --chrome-fg: #e9e4d9;
  --chrome-muted: #aaa397;
  --elev-raised: 0 1px 2px rgba(0, 0, 0, 0.4), 0 8px 28px rgba(8, 7, 6, 0.45);
  --elev-card: 0 2px 8px rgba(0, 0, 0, 0.42), 0 16px 40px rgba(0, 0, 0, 0.55);
  --studio: #0c0b0a;
  color-scheme: dark;
}`
