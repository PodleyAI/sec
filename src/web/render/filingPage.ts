/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { CompareResult } from "../data/compare";
import type { AccessionExtractions } from "../data/extractions";
import type { FilingDocument } from "../data/documents";
import type { ModelOption } from "../data/models";
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
        : doc.sections.map(
            (s) =>
              html`<details class="panel">
                <summary>
                  ${s.name} <span class="muted small">${s.chars.toLocaleString()} chars</span>
                </summary>
                <pre>${s.text}</pre>
              </details>`
          )
    }

    <h3>Converted markdown</h3>
    <p class="sub small">
      The converter's output for the whole document — the intermediate between the filing's HTML and
      the section prose above.
    </p>
    <details class="panel" open>
      <summary>Markdown (${doc.markdown.length.toLocaleString()} chars)</summary>
      <pre>
${doc.markdown.slice(0, RAW_PREVIEW_CHARS)}${doc.markdown.length > RAW_PREVIEW_CHARS ? "\n… truncated for display" : ""}</pre>
    </details>

    <h3>Source</h3>
    <details class="panel">
      <summary>Raw document as cached (${doc.raw.length.toLocaleString()} chars)</summary>
      <pre>
${doc.raw.slice(0, RAW_PREVIEW_CHARS)}${doc.raw.length > RAW_PREVIEW_CHARS ? "\n… truncated for display" : ""}</pre>
    </details>
  `;
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

  if (args.result === undefined) return form;
  const r = args.result;
  if (r.error !== "") {
    return html`${form}
      <p class="notice">${r.error}</p>`;
  }

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
    <details class="panel" open>
      <summary>
        Prompt sent to every model
        <span class="muted small">
          ${r.prompt.length.toLocaleString()} chars — preamble, instructions, and the section fenced
          as untrusted filer text
        </span>
      </summary>
      <pre>${truncate(r.prompt)}</pre>
    </details>
    <details class="panel">
      <summary>
        Instructions only
        <span class="muted small">
          ${r.instructions.length.toLocaleString()} chars — the part you would edit
        </span>
      </summary>
      <pre>${r.instructions}</pre>
    </details>
    <details class="panel">
      <summary>
        Output schema
        <span class="muted small">as the model sees it under the current nonce setting</span>
      </summary>
      <pre>${r.schema}</pre>
    </details>
    <details class="panel">
      <summary class="muted small">
        Section prose on its own (${r.sectionText.length.toLocaleString()} chars, already fenced
        inside the prompt above)
      </summary>
      <pre>${truncate(r.sectionText)}</pre>
    </details>
  `;

  // A preview asked for the prompt, not for an answer.
  if (r.runs.length === 0) return html`${form}${promptPanels}`;

  const rows = r.runs.map(
    (run) =>
      html`<details class="panel" open>
        <summary>
          <span class="tag ${raw(run.ok ? "ok" : "bad")}">${run.ok ? "ok" : "failed"}</span>
          <code>${run.model}</code>
          <span class="muted small">
            ${(run.latencyMs / 1000).toFixed(1)}s · ${run.rows.length} row(s) ·
            ${run.usd === null ? "cost unknown" : `~$${run.usd.toFixed(4)}`}
            ${
              run.agreement === undefined
                ? " · reference"
                : ` · agreement ${(run.agreement.score * 100).toFixed(0)}% ·` +
                  ` recall ${(run.agreement.entityRecall * 100).toFixed(0)}% ·` +
                  ` precision ${(run.agreement.precision * 100).toFixed(0)}%`
            }
          </span>
        </summary>
        ${run.error === "" ? null : html`<p class="notice">${run.error}</p>`}
        <pre>${JSON.stringify(run.rows, null, 2)}</pre>
      </details>`
  );

  return html`${form}${promptPanels}${rows}`;
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
            })
    }
  `;

  return page({ title: `${args.doc.form} ${args.accessionNumber}`, body });
}
