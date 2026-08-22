/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Escape text for interpolation into HTML.
 *
 * Every value this server renders comes from EDGAR filings, filer-authored
 * document names, or model output — none of it trustworthy markup — so the page
 * builders below take text and escape it here rather than accepting HTML from
 * callers. The one exception is {@link raw}, which marks a fragment the caller
 * built with these same helpers.
 */
export function esc(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** A pre-escaped HTML fragment, so nesting builders do not double-escape. */
export interface Html {
  readonly __html: string;
}

export function raw(html: string): Html {
  return { __html: html };
}

export function html(strings: TemplateStringsArray, ...values: unknown[]): Html {
  let out = strings[0] ?? "";
  for (let i = 0; i < values.length; i++) {
    out += renderValue(values[i]) + (strings[i + 1] ?? "");
  }
  return raw(out);
}

function renderValue(value: unknown): string {
  if (value === null || value === undefined || value === false) return "";
  if (Array.isArray(value)) return value.map(renderValue).join("");
  if (typeof value === "object" && "__html" in (value as Record<string, unknown>)) {
    return (value as Html).__html;
  }
  return esc(value);
}

/** Value formatting shared by every table: null reads as an em dash, not "null". */
export function cell(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

const STYLES = `
:root {
  color-scheme: light dark;
  --bg: #fbfbfa; --fg: #1a1a19; --muted: #6b6b66; --line: #e0e0dc;
  --panel: #ffffff; --accent: #2f5d9e; --ok: #1a7f4b; --warn: #9a6b00; --bad: #a32b2b;
  --code-bg: #f4f4f1;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #16161a; --fg: #e8e8e4; --muted: #9a9a94; --line: #2e2e34;
    --panel: #1e1e23; --accent: #7ba7e0; --ok: #4bbd80; --warn: #d9a441; --bad: #e0736b;
    --code-bg: #24242a;
  }
}
* { box-sizing: border-box; }
body {
  margin: 0; background: var(--bg); color: var(--fg);
  font: 14px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
}
a { color: var(--accent); }
header.top {
  display: flex; gap: 1rem; align-items: baseline; flex-wrap: wrap;
  padding: .75rem 1.25rem; border-bottom: 1px solid var(--line); background: var(--panel);
  position: sticky; top: 0; z-index: 5;
}
header.top .brand { font-weight: 650; letter-spacing: -.01em; }
header.top nav { display: flex; gap: .9rem; }
main { padding: 1.25rem; max-width: 1500px; }
h1 { font-size: 1.35rem; margin: 0 0 .25rem; }
h2 { font-size: 1.05rem; margin: 1.75rem 0 .6rem; }
h3 { font-size: .95rem; margin: 1.25rem 0 .4rem; }
.sub { color: var(--muted); margin: 0 0 1rem; }
.panel {
  background: var(--panel); border: 1px solid var(--line); border-radius: 8px;
  padding: .9rem 1rem; margin-bottom: 1rem;
}
table { border-collapse: collapse; width: 100%; font-size: 13px; }
.scroll { overflow-x: auto; }
th, td { text-align: left; padding: .35rem .6rem; border-bottom: 1px solid var(--line); vertical-align: top; }
th { color: var(--muted); font-weight: 600; white-space: nowrap; }
td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
tr:hover td { background: color-mix(in srgb, var(--accent) 6%, transparent); }
code, pre, .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
pre {
  background: var(--code-bg); border: 1px solid var(--line); border-radius: 6px;
  padding: .75rem; overflow: auto; max-height: 32rem; font-size: 12px; white-space: pre-wrap;
  word-break: break-word;
}
.tag {
  display: inline-block; padding: .05rem .4rem; border-radius: 999px; font-size: 11px;
  border: 1px solid var(--line); color: var(--muted); white-space: nowrap;
}
.tag.ok { color: var(--ok); border-color: color-mix(in srgb, var(--ok) 45%, transparent); }
.tag.warn { color: var(--warn); border-color: color-mix(in srgb, var(--warn) 45%, transparent); }
.tag.bad { color: var(--bad); border-color: color-mix(in srgb, var(--bad) 45%, transparent); }
.tag.high { color: var(--ok); border-color: color-mix(in srgb, var(--ok) 45%, transparent); }
.tag.medium { color: var(--warn); border-color: color-mix(in srgb, var(--warn) 45%, transparent); }
form.inline { display: inline; }
button, select, input[type=text], input[type=search] {
  font: inherit; padding: .3rem .6rem; border-radius: 6px;
  border: 1px solid var(--line); background: var(--panel); color: var(--fg);
}
button { cursor: pointer; }
button.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
button:disabled { opacity: .5; cursor: default; }
.row { display: flex; gap: .6rem; flex-wrap: wrap; align-items: center; }
.grid { display: grid; gap: .6rem 1.5rem; grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr)); }
.kv { display: grid; grid-template-columns: max-content 1fr; gap: .2rem .8rem; font-size: 13px; }
.kv dt { color: var(--muted); }
.kv dd { margin: 0; }
.muted { color: var(--muted); }
.small { font-size: 12px; }
.log { max-height: 22rem; overflow: auto; font-size: 12px; }
.log div { padding: .1rem 0; border-bottom: 1px solid color-mix(in srgb, var(--line) 50%, transparent); }
.log .error { color: var(--bad); }
.log .warn { color: var(--warn); }
details > summary { cursor: pointer; padding: .2rem 0; }
.tabs { display: flex; gap: .4rem; border-bottom: 1px solid var(--line); margin-bottom: .75rem; }
.tabs a { padding: .35rem .7rem; border-radius: 6px 6px 0 0; text-decoration: none; }
.tabs a[aria-current=page] { background: var(--panel); border: 1px solid var(--line); border-bottom-color: var(--panel); }
.notice { border-left: 3px solid var(--warn); padding-left: .7rem; color: var(--muted); }
`;

/** Wrap page content in the shared shell. */
export function page(args: {
  readonly title: string;
  readonly body: Html;
  /** Extra `<script>` body appended after the content — page-specific behavior only. */
  readonly script?: string | undefined;
}): string {
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(args.title)} — sec web</title>
<style>${STYLES}</style>
</head><body>
<header class="top">
  <span class="brand">sec web</span>
  <nav>
    <a href="/">Overview</a>
    <a href="/candidates">SPAC candidates</a>
    <a href="/runs">Runs</a>
  </nav>
  <form class="inline" action="/goto" method="get" style="margin-left:auto">
    <input type="search" name="cik" placeholder="Go to CIK" size="12" required>
    <button type="submit">Open</button>
  </form>
</header>
<main>${args.body.__html}</main>
${args.script === undefined ? "" : `<script>${args.script}</script>`}
</body></html>`;
}

/** A `<table>` from plain rows, escaping every cell. */
export function table(args: {
  readonly columns: readonly {
    readonly key: string;
    readonly label: string;
    readonly numeric?: boolean;
  }[];
  readonly rows: readonly Record<string, unknown>[];
  readonly empty?: string;
}): Html {
  if (args.rows.length === 0) {
    return html`<p class="muted">${args.empty ?? "No rows."}</p>`;
  }
  const head = args.columns
    .map((c) => `<th${c.numeric === true ? ' class="num"' : ""}>${esc(c.label)}</th>`)
    .join("");
  const body = args.rows
    .map(
      (row) =>
        "<tr>" +
        args.columns
          .map(
            (c) => `<td${c.numeric === true ? ' class="num"' : ""}>${esc(cell(row[c.key]))}</td>`
          )
          .join("") +
        "</tr>"
    )
    .join("");
  return raw(
    `<div class="scroll"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`
  );
}
