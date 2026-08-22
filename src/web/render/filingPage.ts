/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { CompareResult, CompareTable } from "../data/compare";
import type { AccessionExtractions } from "../data/extractions";
import type { FilingDocument } from "../data/documents";
import type { ModelOption } from "../data/models";
import type { RunRecord } from "../runs";
import { runStatusTag, runTranscript } from "./runsPage";
import { esc, html, page, raw, table, type Html } from "./layout";

/** Bytes of raw source rendered inline. Enough to check a conversion, not a 3 MB dump. */
const RAW_PREVIEW_CHARS = 200_000;

/** Long text for a `<pre>`, capped, saying so when it was cut. */
function truncate(text: string): string {
  if (text.length <= RAW_PREVIEW_CHARS) return text;
  return `${text.slice(0, RAW_PREVIEW_CHARS)}\n… truncated for display`;
}

function documentPanel(doc: FilingDocument): Html {
  if (doc.error !== "" && doc.raw === "") {
    return html`<div class="panel">
      <p class="notice">${doc.error}</p>
      <dl class="kv">
        <dt>expected file</dt>
        <dd class="mono small">${doc.fileName ?? "—"}</dd>
        <dt>cache path</dt>
        <dd class="mono small">${doc.path ?? "—"}</dd>
      </dl>
    </div>`;
  }
  return html`
    <div class="panel">
      <dl class="kv">
        <dt>document</dt>
        <dd class="mono small">${doc.fileName ?? "—"}</dd>
        <dt>cache path</dt>
        <dd class="mono small">${doc.path ?? "—"}</dd>
        <dt>size</dt>
        <dd>${doc.bytes.toLocaleString()} bytes</dd>
        <dt>markdown</dt>
        <dd>${doc.markdown.length.toLocaleString()} chars</dd>
        <dt>sections</dt>
        <dd>${doc.sections.length}</dd>
      </dl>
      ${doc.error === "" ? null : html`<p class="notice">${doc.error}</p>`}
    </div>

    <h3>Segmented sections</h3>
    <p class="sub small">
      What the AI extractors are actually handed. A section missing here is a section the extractor
      never saw — which is a segmentation problem, not a model problem.
    </p>
    ${
      doc.sections.length === 0
        ? html`<p class="muted">The segmenter resolved no target sections in this document.</p>`
        : doc.sections.map((s) =>
            lazyPanel({
              href: documentPartHref({
                cik: doc.cik,
                accessionNumber: doc.accessionNumber,
                part: "section",
                name: s.name,
              }),
              summary: html`${s.name}
                <span class="muted small">${s.chars.toLocaleString()} chars</span>`,
            })
          )
    }

    <h3>Converted markdown</h3>
    <p class="sub small">
      The converter's output for the whole document — the intermediate between the filing's HTML and
      the section prose above.
    </p>
    ${lazyPanel({
      href: documentPartHref({
        cik: doc.cik,
        accessionNumber: doc.accessionNumber,
        part: "markdown",
      }),
      summary: html`Markdown
        <span class="muted small">${doc.markdown.length.toLocaleString()} chars</span>`,
    })}

    <h3>Source</h3>
    ${lazyPanel({
      href: documentPartHref({
        cik: doc.cik,
        accessionNumber: doc.accessionNumber,
        part: "raw",
      }),
      summary: html`Raw document as cached
        <span class="muted small">${doc.raw.length.toLocaleString()} chars</span>`,
    })}
  `;
}

/**
 * A `<details>` whose text is fetched the first time it is opened.
 *
 * Shipping every panel inline made the document page 745 KB of HTML for one
 * S-1 — the whole raw source, the whole markdown and every section — almost all
 * of it behind collapsed panels nobody had opened. The COUNTS stay in the page,
 * because "this section is 0 chars" or "this section is missing" is the answer
 * a reader is usually after and it must not cost a click to see.
 */
function lazyPanel(args: {
  readonly href: string;
  readonly summary: Html;
  readonly open?: boolean | undefined;
}): Html {
  return html`<details
    class="panel"
    data-lazy="${raw(esc(args.href))}"
    ${raw(args.open === true ? "open" : "")}
  >
    <summary>${args.summary}</summary>
    <pre data-lazy-body>Loading…</pre>
  </details>`;
}

/**
 * Every model's answer for one filing, side by side.
 *
 * A row per aligned entity and a column per model, so a model that DROPPED an
 * entity shows as a gap rather than as an absence the reader has to spot by
 * diffing four JSON dumps. Rows where the models disagree are marked, because
 * those are the only rows worth reading closely.
 */
function compareTableHtml(t: CompareTable | undefined, r: CompareResult): Html {
  if (t === undefined || t.models.length === 0) return html``;
  if (t.rows.length === 0) {
    return html`<h3>Side by side</h3>
      <p class="muted">Every model returned no rows for this section.</p>`;
  }
  const head =
    `<tr><th>${esc(t.keyField ?? "#")}</th>` +
    t.models.map((m) => `<th>${esc(m)}</th>`).join("") +
    `</tr>` +
    `<tr><th class="muted small"></th>` +
    t.models.map(() => `<th class="muted small">${esc(t.fields.join(" · "))}</th>`).join("") +
    `</tr>`;
  const body = t.rows
    .map((row) => {
      const cells = row.cells
        .map((c) =>
          c.present
            ? `<td>${c.values.map((v) => esc(v === "" ? "—" : v)).join("<br>")}</td>`
            : `<td class="muted" title="this model produced no row for it">missing</td>`
        )
        .join("");
      const mark = row.agree
        ? ""
        : ' style="background:color-mix(in srgb, var(--warn) 12%, transparent)"';
      return `<tr${mark}><td>${esc(row.key)}</td>${cells}</tr>`;
    })
    .join("");
  return html`<h3>Side by side</h3>
    <p class="sub small">
      Aligned ${t.keyField === undefined ? "positionally" : html`on <code>${t.keyField}</code>`} —
      the same rule <code>scoreExtraction</code> uses. ${t.rows.length} row(s), ${t.disagreements}
      where the models differ (highlighted).
      ${
        r.runs.some((run) => !run.ok)
          ? html`Failed models are omitted from the table; see the summary above.`
          : null
      }
    </p>
    ${raw(`<div class="scroll"><table><thead>${head}</thead><tbody>${body}</tbody></table></div>`)}`;
}

/** `/api/document` URL for one part of a filing's converted body. */
function documentPartHref(args: {
  readonly cik: number;
  readonly accessionNumber: string;
  readonly part: "markdown" | "raw" | "section";
  readonly name?: string | undefined;
}): string {
  const params = new URLSearchParams({
    cik: String(args.cik),
    accession: args.accessionNumber,
    part: args.part,
  });
  if (args.name !== undefined) params.set("name", args.name);
  return `/api/document?${params.toString()}`;
}

function extractionsPanel(ex: AccessionExtractions): Html {
  return html`
    <h3>Extractor runs</h3>
    ${table({
      columns: [
        { key: "extractor_id", label: "Extractor" },
        { key: "extractor_version", label: "Version" },
        { key: "slot_at_run", label: "Slot" },
        { key: "outcome", label: "Outcome" },
        { key: "ran_at", label: "Ran at" },
        { key: "error", label: "Error" },
      ],
      rows: ex.runs as unknown as Record<string, unknown>[],
      empty: "No run recorded for this filing.",
    })}

    <h3>Dead letters</h3>
    <p class="sub small">
      Version-fixable extraction failures, per filing and section. <code>(filing)</code> is the
      filing-level key — no primary document, a fetch or parse that threw, or a storage handler that
      did.
    </p>
    ${table({
      columns: [
        { key: "extractor_id", label: "Extractor" },
        { key: "section", label: "Section" },
        { key: "reason_code", label: "Reason" },
        { key: "status", label: "Status" },
        { key: "attempts", label: "Attempts", numeric: true },
        { key: "failed_extractor_version", label: "At version" },
        { key: "detail", label: "Detail" },
      ],
      rows: ex.deadLetters.map((dl) => ({
        ...dl,
        section: dl.section_name === "" ? "(filing)" : dl.section_name,
      })),
      empty: "No dead letters for this filing.",
    })}

    <h3>Extracted rows</h3>
    ${
      ex.tables.length === 0
        ? html`<p class="muted">
            No table holds a row for this accession. ${ex.emptyTables.length} accession-keyed
            table(s) were searched.
          </p>`
        : ex.tables.map(
            (t) =>
              html`<details class="panel" open>
                <summary>
                  <code>${t.table}</code>
                  <span class="muted small">${t.rows.length} row(s)</span>
                </summary>
                ${
                  t.error !== ""
                    ? html`<p class="notice">${t.error}</p>`
                    : table({
                        columns: t.columns.map((c) => ({ key: c, label: c })),
                        rows: t.rows,
                      })
                }
              </details>`
          )
    }
    <details class="panel">
      <summary class="muted small">
        ${ex.emptyTables.length} accession-keyed table(s) held nothing
      </summary>
      <p class="small mono muted">${ex.emptyTables.join(", ")}</p>
    </details>
  `;
}

function comparePanel(args: {
  readonly cik: number;
  readonly accessionNumber: string;
  readonly extractors: readonly string[];
  readonly options: readonly ModelOption[];
  readonly result: CompareResult | undefined;
  readonly run: RunRecord | undefined;
  readonly table: CompareTable | undefined;
}): Html {
  const form = html`<form class="panel" method="post" action="/api/compare">
    <input type="hidden" name="cik" value="${args.cik}" />
    <input type="hidden" name="accession" value="${args.accessionNumber}" />
    <div class="row">
      <label class="small"
        >Section extractor
        <select name="extractor" required>
          ${args.extractors.map(
            (e) =>
              html`<option value="${e}" ${raw(args.result?.extractor === e ? "selected" : "")}>
                ${e}
              </option>`
          )}
        </select>
      </label>
      <label class="small"
        >Models (ctrl/cmd-click for several)
        <select name="models" multiple size="6">
          ${args.options.map(
            (o) =>
              html`<option value="${o.id}">
                ${o.id}${o.available ? "" : ` — needs ${o.apiKeyEnvVar}`}
              </option>`
          )}
        </select>
      </label>
      <label class="small"
        >Extra ids (comma separated)
        <input type="text" name="extra_models" placeholder="deterministic, gguf:…" />
      </label>
      <button class="primary" type="submit" name="mode" value="compare">Compare</button>
      <button type="submit" name="mode" value="preview">Show prompt only</button>
    </div>
    <p class="small muted">
      Runs the section through each model and scores the rest against the FIRST one, which stands in
      as the reference. Nothing is written: this answers “would another model read this section
      better”, and adopting one is a separate act — pick it in the process page's model picker and
      re-run the filing. <strong>Show prompt only</strong> resolves the section and builds the
      prompt without calling any model.
    </p>
  </form>`;

  // A queued or running comparison has no result yet — show what it is doing.
  // The models run one at a time and a cloud call over a 40k-char section takes
  // tens of seconds, so this is what the reader looks at for most of the wait.
  const progress =
    args.run === undefined
      ? null
      : html`<div class="panel">
          <div class="row">
            <span class="tag ${raw(runStatusTag(args.run.status))}" data-run-status>
              ${args.run.status}
            </span>
            <strong>${args.run.label}</strong>
            <a class="small" href="/runs/${args.run.id}">open run</a>
            ${
              args.run.status === "running" || args.run.status === "queued"
                ? html`<form class="inline" method="post" action="/api/runs/${args.run.id}/cancel">
                    <button type="submit">Cancel</button>
                  </form>`
                : null
            }
          </div>
          <div id="log" style="margin-top:.5rem">${runTranscript(args.run)}</div>
        </div>`;

  if (args.result === undefined) return html`${form}${progress}`;
  const r = args.result;
  if (r.error !== "") {
    return html`${form}
      <p class="notice">${r.error}</p>`;
  }

  const promptHref = (part: string): string =>
    `/api/prompt?${new URLSearchParams({
      cik: String(r.cik),
      accession: r.accessionNumber,
      extractor: r.extractor,
      part,
    }).toString()}`;

  // Same treatment as the document tab: the counts are inline, the text is a
  // request per panel. A prompt runs to 31k characters and the section it
  // fences can reach 57k, so inlining all four put a quarter of a megabyte in
  // a page whose reader usually wants one of them.
  const promptPanels = html`
    <div class="panel small">
      Section <strong>${r.sectionName}</strong> · ${r.sectionChars.toLocaleString()} chars ·
      extractor <code>${r.extractor}</code> · prompt ${r.prompt.length.toLocaleString()} chars
      ${
        r.nonceEnabled
          ? html`<div class="notice" style="margin-top:.4rem">
              <code>SEC_EXTRACTION_NONCE</code> is on, so a cloud provider's real prompt also
              carries a per-attempt verification token. It differs on every attempt, so no single
              rendering is "the" prompt — what is shown below is the no-nonce shape a local provider
              receives.
            </div>`
          : null
      }
    </div>
    ${lazyPanel({
      href: promptHref("prompt"),
      summary: html`Prompt sent to every model
        <span class="muted small">
          ${r.prompt.length.toLocaleString()} chars — preamble, instructions, and the section fenced
          as untrusted filer text
        </span>`,
    })}
    ${lazyPanel({
      href: promptHref("instructions"),
      summary: html`Instructions only
        <span class="muted small">
          ${r.instructions.length.toLocaleString()} chars — the part you would edit
        </span>`,
    })}
    ${lazyPanel({
      href: promptHref("schema"),
      summary: html`Output schema
        <span class="muted small">as the model sees it under the current nonce setting</span>`,
    })}
    ${lazyPanel({
      href: promptHref("section"),
      summary: html`Section prose on its own
        <span class="muted small">
          ${r.sectionText.length.toLocaleString()} chars, already fenced inside the prompt above
        </span>`,
    })}
  `;

  // A preview asked for the prompt, not for an answer.
  if (r.runs.length === 0) return html`${form}${progress}${promptPanels}`;

  const summaries = html`
    <h3>Models</h3>
    ${table({
      columns: [
        { key: "model", label: "Model" },
        { key: "ok", label: "Result" },
        { key: "rows", label: "Rows", numeric: true },
        { key: "latency", label: "Latency", numeric: true },
        { key: "cost", label: "Est. cost", numeric: true },
        { key: "agreement", label: "vs reference" },
        { key: "error", label: "Error" },
      ],
      rows: r.runs.map((run) => ({
        model: run.model,
        ok: run.ok ? "ok" : "failed",
        rows: run.ok ? run.rows.length : "",
        latency: `${(run.latencyMs / 1000).toFixed(1)}s`,
        cost: run.usd === null ? "—" : `$${run.usd.toFixed(4)}`,
        agreement:
          run.agreement === undefined
            ? "reference"
            : `${(run.agreement.score * 100).toFixed(0)}% · recall ` +
              `${(run.agreement.entityRecall * 100).toFixed(0)}% · prec ` +
              `${(run.agreement.precision * 100).toFixed(0)}%`,
        error: run.error,
      })),
    })}
  `;

  const comparison = compareTableHtml(args.table, r);

  const raw_panels = html`
    <h3>Raw rows</h3>
    ${r.runs.map((run) =>
      run.ok && args.run !== undefined
        ? lazyPanel({
            href: `/api/compare-rows?${new URLSearchParams({
              run: args.run.id,
              model: run.model,
            }).toString()}`,
            summary: html`<code>${run.model}</code>
              <span class="muted small">${run.rows.length} row(s) as JSON</span>`,
          })
        : html`<details class="panel">
            <summary>
              <code>${run.model}</code>
              <span class="muted small">${run.ok ? `${run.rows.length} row(s)` : "failed"}</span>
            </summary>
            <pre>${run.error !== "" ? run.error : JSON.stringify(run.rows, null, 2)}</pre>
          </details>`
    )}
  `;

  return html`${form}${progress}${summaries}${comparison}${promptPanels}${raw_panels}`;
}

/**
 * One filing, end to end: the document as cached, the conversion each stage
 * produced, everything the extractors recorded, and a head-to-head against
 * other models.
 *
 * The three live on one page deliberately. Verifying an extraction means moving
 * between them — a missing row is either a segmentation miss (no section), a
 * conversion problem (the section is there but unreadable) or a model miss (the
 * prose is fine and the model dropped it) — and only having all three in front
 * of you distinguishes those.
 */
export function renderFilingPage(args: {
  readonly cik: number;
  readonly accessionNumber: string;
  readonly name: string;
  readonly doc: FilingDocument;
  readonly extractions: AccessionExtractions;
  readonly extractors: readonly string[];
  readonly options: readonly ModelOption[];
  readonly compare: CompareResult | undefined;
  readonly compareRun: RunRecord | undefined;
  readonly compareTable: CompareTable | undefined;
  readonly tab: "document" | "extractions" | "compare";
}): string {
  const tab = (id: string, label: string): Html =>
    html`<a
      href="/spac/${args.cik}/filing/${raw(esc(args.accessionNumber))}?tab=${raw(id)}"
      ${raw(args.tab === id ? 'aria-current="page"' : "")}
      >${label}</a
    >`;

  const body = html`
    <h1>${args.doc.form || "Filing"} <span class="mono">${args.accessionNumber}</span></h1>
    <p class="sub">
      <a href="/spac/${args.cik}">${args.name}</a>
      <span class="muted">· CIK ${args.cik} · filed ${args.doc.filingDate ?? "—"}</span>
      · <a href="${raw(esc(args.doc.edgarUrl))}" target="_blank" rel="noreferrer">EDGAR ↗</a> ·
      <a href="/spac/${args.cik}/process">process page</a>
    </p>
    <div class="tabs">
      ${tab("document", "Document & conversion")} ${tab("extractions", "Extraction results")}
      ${tab("compare", "Compare models")}
    </div>
    ${
      args.tab === "document"
        ? documentPanel(args.doc)
        : args.tab === "extractions"
          ? extractionsPanel(args.extractions)
          : comparePanel({
              cik: args.cik,
              accessionNumber: args.accessionNumber,
              extractors: args.extractors,
              options: args.options,
              result: args.compare,
              run: args.compareRun,
              table: args.compareTable,
            })
    }
  `;

  // Panels fetch their own text the first time they are opened. `toggle` fires
  // per element rather than bubbling, so the listener is attached per panel; a
  // panel that has already loaded (or is loading) is left alone.
  // A running comparison streams its progress on the same channel the process
  // page uses, and reloads once when it settles so the results render.
  const compareScript =
    args.compareRun === undefined ||
    (args.compareRun.status !== "running" && args.compareRun.status !== "queued")
      ? ""
      : `
{
  const es = new EventSource("/events?run=${args.compareRun.id}");
  const log = document.querySelector("#log .log");
  es.onmessage = (m) => {
    let e; try { e = JSON.parse(m.data); } catch { return; }
    for (const el of document.querySelectorAll("[data-run-status]")) el.textContent = e.run.status;
    if (e.event && log) {
      const line = document.createElement("div");
      line.className = e.event.level;
      line.textContent = e.event.at.slice(11, 19) + " " + e.event.message;
      log.appendChild(line);
      log.scrollTop = log.scrollHeight;
    }
    if (e.run.status !== "running" && e.run.status !== "queued") {
      es.close();
      setTimeout(() => location.reload(), 400);
    }
  };
}
`;

  const script =
    compareScript +
    `
for (const panel of document.querySelectorAll("details[data-lazy]")) {
  panel.addEventListener("toggle", async () => {
    if (!panel.open || panel.dataset.lazyState) return;
    panel.dataset.lazyState = "loading";
    const body = panel.querySelector("[data-lazy-body]");
    try {
      const res = await fetch("/api/document?" + panel.dataset.lazy);
      const text = await res.text();
      body.textContent = res.ok ? text : "could not load: " + text;
      if (!res.ok) panel.dataset.lazyState = "";
    } catch (e) {
      body.textContent = "could not load: " + e;
      panel.dataset.lazyState = "";
    }
  });
}
`;

  return page({ title: `${args.doc.form} ${args.accessionNumber}`, body, script });
}
