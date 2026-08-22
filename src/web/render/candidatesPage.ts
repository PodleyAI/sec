/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { CandidatePage } from "../data/candidates";
import { edgarFilingsUrl } from "../data/documents";
import type { RunRecord } from "../runs";
import { esc, html, page, raw, type Html } from "./layout";

function confidenceTag(confidence: string): Html {
  const cls = confidence === "high" ? "high" : confidence === "medium" ? "medium" : "";
  return html`<span class="tag ${raw(cls)}">${confidence}</span>`;
}

function pager(data: CandidatePage): Html {
  const link = (offset: number, label: string): Html => {
    const params = new URLSearchParams();
    if (data.confidence !== undefined) params.set("confidence", data.confidence);
    if (data.search !== "") params.set("q", data.search);
    params.set("offset", String(offset));
    params.set("limit", String(data.limit));
    return html`<a href="/candidates?${raw(esc(params.toString()))}">${label}</a>`;
  };
  const from = data.matched === 0 ? 0 : data.offset + 1;
  const to = Math.min(data.offset + data.limit, data.matched);
  return html`<div class="row small muted">
    <span>Showing ${from}–${to} of ${data.matched}</span>
    ${data.offset > 0 ? link(Math.max(0, data.offset - data.limit), "← previous") : null}
    ${to < data.matched ? link(data.offset + data.limit, "next →") : null}
  </div>`;
}

/**
 * The candidate screen.
 *
 * Each row links three ways because verifying a candidate means asking three
 * different questions: is this really a blank check (EDGAR's own filing list),
 * what has the pipeline made of it (the SPAC page), and what would processing
 * it do (the process page). A screen that only listed rows would leave every
 * one of those to a shell command.
 */
export function renderCandidatesPage(args: {
  readonly data: CandidatePage;
  readonly activeRun: RunRecord | undefined;
}): string {
  const { data } = args;
  const rows = data.rows.map((row) => {
    const processed = data.processedOnPage.has(row.cik);
    return html`<tr>
      <td class="mono">${row.cik}</td>
      <td>${row.name ?? "—"}</td>
      <td>${confidenceTag(row.confidence)}</td>
      <td class="num">${row.current_sic ?? "—"}</td>
      <td>${row.first_reg_form ?? "—"}</td>
      <td>${row.first_reg_date ?? "—"}</td>
      <td class="small muted">
        ${row.signal_sic_6770 ? html`<span class="tag">sic 6770</span> ` : null}
        ${row.signal_filed_sic_6770 === true ? html`<span class="tag">filed 6770</span> ` : null}
        ${row.signal_name_match ? html`<span class="tag">name</span> ` : null}
        ${
          row.signal_renamed_from !== null
            ? html`<span class="tag" title="${row.signal_renamed_from}">was renamed</span>`
            : null
        }
      </td>
      <td>
        ${
          processed
            ? html`<span class="tag ok">processed</span>`
            : html`<span class="tag muted">not processed</span>`
        }
      </td>
      <td class="small">
        <a href="/spac/${row.cik}">SPAC</a>
        &middot; <a href="/spac/${row.cik}/process">Process</a> &middot;
        <a href="${raw(esc(edgarFilingsUrl(row.cik)))}" target="_blank" rel="noreferrer">EDGAR</a>
      </td>
    </tr>`;
  });

  const body = html`
    <h1>SPAC candidates</h1>
    <p class="sub">
      The cheap screen over submissions metadata — entity SIC, name history, and the first
      registration form. It is a worklist, not a verdict: the authoritative classification is the
      S-1 extractor's, which reads the as-filed SGML header and falls back to an AI content
      classifier.
    </p>

    <div class="panel row">
      <div>
        <strong>${data.total}</strong> candidates
        <span class="muted small">
          (high ${data.byConfidence.high}, medium ${data.byConfidence.medium}, low
          ${data.byConfidence.low}; ${data.processed} already have a <code>spac</code> row)
        </span>
        ${
          data.identifiedAt === ""
            ? null
            : html`<div class="small muted">last screened ${data.identifiedAt}</div>`
        }
      </div>
      <form
        class="inline row"
        method="post"
        action="/api/candidates/rebuild"
        style="margin-left:auto"
      >
        <label class="small muted"
          ><input type="checkbox" name="full" value="1" /> full rescan</label
        >
        <button
          class="primary"
          type="submit"
          ${args.activeRun === undefined ? raw("") : raw("disabled")}
        >
          Rebuild candidates
        </button>
      </form>
    </div>

    ${
      args.activeRun === undefined
        ? null
        : html`<p class="notice">
            A run is already in flight —
            <a href="/runs/${args.activeRun.id}">${args.activeRun.label}</a>. Runs are serialized,
            so starting another would only queue behind it.
          </p>`
    }

    <form class="panel row" method="get" action="/candidates">
      <label class="small muted"
        >Confidence
        <select name="confidence">
          <option value="">any</option>
          ${(["high", "medium", "low"] as const).map(
            (c) =>
              html`<option value="${c}" ${raw(data.confidence === c ? "selected" : "")}>
                ${c}
              </option>`
          )}
        </select>
      </label>
      <input type="search" name="q" placeholder="name, former name or CIK" value="${data.search}" />
      <input type="hidden" name="limit" value="${data.limit}" />
      <button type="submit">Filter</button>
    </form>

    ${
      rows.length === 0
        ? html`<p class="muted">
            No candidates match. If the table is empty entirely, run the screen with
            <em>Rebuild candidates</em> — it needs ingested submissions (<code
              >sec sync submissions</code
            >) to read.
          </p>`
        : raw(
            `<div class="scroll"><table><thead><tr>
            <th>CIK</th><th>Name</th><th>Confidence</th><th class="num">SIC</th>
            <th>Reg form</th><th>Reg date</th><th>Signals</th><th>Pipeline</th><th></th>
          </tr></thead><tbody>${rows.map((r) => r.__html).join("")}</tbody></table></div>`
          )
    }
    ${pager(data)}
  `;

  return page({ title: "SPAC candidates", body });
}
