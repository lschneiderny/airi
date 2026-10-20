/**
 * The page's design tokens follow `DESIGN.md`: the theme hue (`--chromatic-hue` default 220.44), neutral
 * surfaces for reading, a small type scale (`text-xs` 12 px to `text-xl` 24 px), and status conveyed by
 * text as well as color. Everything is inline; no font, script or image is loaded from a URL.
 */
export const reportStyles = `
:root {
  --hue: 220.44;
  --c-bg: oklch(98% 0.004 var(--hue));
  --c-surface: oklch(100% 0 0);
  --c-surface-2: oklch(96% 0.006 var(--hue));
  --c-text: oklch(24% 0.02 var(--hue));
  --c-muted: oklch(48% 0.02 var(--hue));
  --c-border: oklch(88% 0.01 var(--hue));
  --c-primary: oklch(52% 0.17 var(--hue));
  --c-primary-soft: oklch(92% 0.05 var(--hue));
  --c-pass: oklch(46% 0.14 150);
  --c-pass-soft: oklch(94% 0.05 150);
  --c-fail: oklch(50% 0.19 25);
  --c-fail-soft: oklch(94% 0.05 25);
  --c-warn: oklch(55% 0.15 70);
  --c-warn-soft: oklch(95% 0.06 70);
  --space-1: 4px; --space-2: 8px; --space-3: 12px; --space-4: 16px; --space-5: 24px; --space-6: 32px; --space-8: 48px;
  --text-xs: 12px; --text-sm: 14px; --text-base: 16px; --text-lg: 20px; --text-xl: 24px; --text-2xl: 30px;
  --radius: 8px;
  --shadow-sm: 0 1px 2px oklch(0% 0 0 / 0.06);
  --font-sans: ui-sans-serif, system-ui, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  --font-mono: ui-monospace, "Cascadia Mono", "Segoe UI Mono", Consolas, monospace;
}
@media (prefers-color-scheme: dark) {
  :root {
    --c-bg: oklch(18% 0.01 var(--hue));
    --c-surface: oklch(23% 0.012 var(--hue));
    --c-surface-2: oklch(28% 0.014 var(--hue));
    --c-text: oklch(94% 0.01 var(--hue));
    --c-muted: oklch(70% 0.02 var(--hue));
    --c-border: oklch(36% 0.015 var(--hue));
    --c-primary: oklch(72% 0.14 var(--hue));
    --c-primary-soft: oklch(32% 0.06 var(--hue));
    --c-pass: oklch(78% 0.15 150);
    --c-pass-soft: oklch(30% 0.06 150);
    --c-fail: oklch(76% 0.17 25);
    --c-fail-soft: oklch(32% 0.07 25);
    --c-warn: oklch(80% 0.14 70);
    --c-warn-soft: oklch(32% 0.06 70);
    --shadow-sm: 0 1px 2px oklch(0% 0 0 / 0.4);
  }
}
* { box-sizing: border-box; }
html { background: var(--c-bg); color: var(--c-text); font-family: var(--font-sans); font-size: var(--text-base); line-height: 1.5; -webkit-text-size-adjust: 100%; }
body { margin: 0; padding: var(--space-5) var(--space-4) var(--space-8); max-width: 1180px; margin-inline: auto; }
h1 { font-size: var(--text-2xl); line-height: 1.2; letter-spacing: -0.01em; margin: 0 0 var(--space-2); }
h2 { font-size: var(--text-xl); line-height: 1.25; letter-spacing: -0.01em; margin: var(--space-8) 0 var(--space-3); }
h3 { font-size: var(--text-lg); line-height: 1.3; margin: var(--space-5) 0 var(--space-2); }
p { margin: 0 0 var(--space-3); }
code, .mono { font-family: var(--font-mono); font-size: 0.92em; }
a { color: var(--c-primary); }
.muted { color: var(--c-muted); }
.small { font-size: var(--text-sm); }
.xs { font-size: var(--text-xs); }
.lede { font-size: var(--text-sm); color: var(--c-muted); margin-bottom: var(--space-4); }
.callout { border-left: 4px solid var(--c-primary); background: var(--c-primary-soft); border-radius: var(--radius); padding: var(--space-3) var(--space-4); margin: var(--space-4) 0; }
.callout.warn { border-left-color: var(--c-warn); background: var(--c-warn-soft); }
.callout.fail { border-left-color: var(--c-fail); background: var(--c-fail-soft); }
.callout p:last-child { margin-bottom: 0; }
.card { background: var(--c-surface); border: 1px solid var(--c-border); border-radius: var(--radius); box-shadow: var(--shadow-sm); padding: var(--space-4); margin: var(--space-3) 0; }
.table-wrap { overflow-x: auto; border: 1px solid var(--c-border); border-radius: var(--radius); background: var(--c-surface); }
table { border-collapse: collapse; width: 100%; font-size: var(--text-sm); }
th, td { text-align: left; padding: var(--space-2) var(--space-3); border-bottom: 1px solid var(--c-border); vertical-align: top; white-space: nowrap; }
th { font-weight: 600; background: var(--c-surface-2); position: sticky; top: 0; }
td.wrap, th.wrap { white-space: normal; min-width: 14rem; }
tr:last-child td { border-bottom: 0; }
.num { text-align: right; font-variant-numeric: tabular-nums; }
.badge { display: inline-block; font-size: var(--text-xs); font-weight: 600; line-height: 1; padding: var(--space-1) var(--space-2); border-radius: 999px; border: 1px solid transparent; }
.badge.pass { color: var(--c-pass); background: var(--c-pass-soft); }
.badge.fail { color: var(--c-fail); background: var(--c-fail-soft); }
.badge.na { color: var(--c-muted); background: var(--c-surface-2); border-color: var(--c-border); }
.badge.note { color: var(--c-warn); background: var(--c-warn-soft); }
details { margin: 0; }
details > summary { cursor: pointer; color: var(--c-primary); font-size: var(--text-sm); }
details.channels table { margin-top: var(--space-2); font-size: var(--text-xs); }
.meta { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: var(--space-3); }
.meta dl { margin: 0; display: grid; grid-template-columns: max-content 1fr; gap: var(--space-1) var(--space-3); font-size: var(--text-sm); }
.meta dt { color: var(--c-muted); }
.meta dd { margin: 0; overflow-wrap: anywhere; }
.cells { display: grid; grid-template-columns: 1fr; gap: var(--space-3); }
.cells > .card { min-width: 0; }
.cell-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: var(--space-2) var(--space-3); margin-bottom: var(--space-2); }
.cell-head h3 { margin: 0; }
.svg-wrap { overflow-x: auto; max-width: 100%; }
svg.trajectory { width: 100%; height: auto; max-width: 720px; min-width: 560px; display: block; font-family: var(--font-sans); }
svg.trajectory .panel { fill: var(--c-surface-2); stroke: var(--c-border); }
svg.trajectory .win { fill: var(--c-primary); opacity: 0.06; }
svg.trajectory .win-scored { opacity: 0.16; }
svg.trajectory .win-release { opacity: 0.08; }
svg.trajectory .win-late { opacity: 0.14; }
svg.trajectory .null-band { fill: var(--c-muted); opacity: 0.18; }
svg.trajectory .zero { stroke: var(--c-muted); stroke-width: 1; stroke-dasharray: 2 3; }
svg.trajectory .expected { stroke: var(--c-warn); stroke-width: 2; stroke-dasharray: 5 4; }
svg.trajectory .ci-band { fill: var(--c-primary); opacity: 0.25; }
svg.trajectory .effect { stroke: var(--c-primary); stroke-width: 3; stroke-linecap: round; }
svg.trajectory .effect.late { stroke: var(--c-pass); }
svg.trajectory .traj-band { fill: var(--c-fail); opacity: 0.18; }
svg.trajectory .traj { fill: none; stroke: var(--c-fail); stroke-width: 1.8; }
svg.trajectory .release-band { fill: var(--c-pass); opacity: 0.2; }
svg.trajectory .release { fill: none; stroke: var(--c-pass); stroke-width: 1.4; stroke-dasharray: 3 2; }
svg.trajectory .label { font-size: 12px; font-weight: 600; fill: var(--c-text); }
svg.trajectory .label.verdict-fail { fill: var(--c-fail); }
svg.trajectory .label.verdict-na { fill: var(--c-muted); }
svg.trajectory .sub, svg.trajectory .axis text { font-size: 10px; fill: var(--c-muted); }
svg.trajectory .win-label { font-size: 10px; fill: var(--c-muted); }
.legend { display: flex; flex-wrap: wrap; gap: var(--space-2) var(--space-4); font-size: var(--text-xs); color: var(--c-muted); margin: var(--space-2) 0 var(--space-4); }
.legend span::before { content: ""; display: inline-block; width: 14px; height: 10px; margin-right: var(--space-1); vertical-align: -1px; border-radius: 2px; }
.legend .l-effect::before { background: var(--c-primary); }
.legend .l-ci::before { background: var(--c-primary); opacity: 0.3; }
.legend .l-null::before { background: var(--c-muted); opacity: 0.3; }
.legend .l-expected::before { background: var(--c-warn); }
.legend .l-late::before { background: var(--c-pass); }
.legend .l-traj::before { background: var(--c-fail); opacity: 0.5; }
.legend .l-release::before { background: var(--c-pass); opacity: 0.4; }
.sheet { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: var(--space-3); }
.shot { margin: 0; background: var(--c-surface); border: 1px solid var(--c-border); border-radius: var(--radius); overflow: hidden; }
.shot img { display: block; width: 100%; height: auto; background: var(--c-surface-2); }
.shot figcaption { padding: var(--space-2) var(--space-3); font-size: var(--text-xs); color: var(--c-muted); }
.pulse { margin: var(--space-4) 0; }
.pulse h3 { margin-bottom: var(--space-2); }
ul.checklist { padding-left: var(--space-5); margin: 0; }
ul.checklist li { margin-bottom: var(--space-2); }
ul.plain { list-style: none; padding: 0; margin: 0; }
ul.plain li { padding: var(--space-1) 0; border-bottom: 1px solid var(--c-border); font-size: var(--text-sm); overflow-wrap: anywhere; }
ul.plain li:last-child { border-bottom: 0; }
.toc { display: flex; flex-wrap: wrap; gap: var(--space-2) var(--space-4); font-size: var(--text-sm); margin-bottom: var(--space-4); }
@media (max-width: 640px) {
  body { padding: var(--space-4) var(--space-3) var(--space-6); }
  h1 { font-size: var(--text-xl); }
  h2 { font-size: var(--text-lg); margin-top: var(--space-6); }
  h3 { font-size: var(--text-base); }
  .sheet { grid-template-columns: repeat(2, 1fr); gap: var(--space-2); }
  .card { padding: var(--space-3); }
  th, td { padding: var(--space-1) var(--space-2); }
}
`
