/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { SpacDetail } from "../data/spacDetail";
import { edgarFilingUrl, edgarFilingsUrl } from "../data/documents";
import { cell, esc, html, page, raw, table, type Html } from "./layout";

/** The per-CIK tab strip every issuer page shares. */
export function issuerTabs(cik: number, current: "spac" | "process"): Html {
  return html`<div class="tabs">
    <a href="/spac/${cik}" ${raw(current === "spac" ? 'aria-current="page"' : "")}
      >Report &amp; history</a
    >
    <a href="/spac/${cik}/process" ${raw(current === "process" ? 'aria-current="page"' : "")}
      >Process</a
    >
    <a href="${raw(esc(edgarFilingsUrl(cik)))}" target="_blank" rel="noreferrer">EDGAR filings ↗</a>
  </div>`;
}

/** Render an object as a definition list, skipping nothing — this is the detail view. */
function fields(row: Record<string, unknown>, skip: ReadonlySet<string> = new Set()): Html {
  const entries = Object.entries(row).filter(([k]) => !skip.has(k));
  return raw(
    `<dl class="kv">` +
      entries.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(cell(v))}</dd>`).join("") +
      `</dl>`
  );
}

/**
 * The consolidated SPAC page: the derived row, the deals and events it is
 * derived FROM, and the full history with a per-snapshot diff.
 *
 * The order matters — the `spac` row is a rollup of `spac_deal` and
 * `spac_event`, so a reader checking a suspicious status wants the event stream
 * immediately below it rather than on another page. The history diff answers
 * the question the raw snapshots do not: which filing changed what.
 */
export function renderSpacPage(detail: SpacDetail): string {
  const title = detail.spac?.spac_name ?? detail.entityName ?? `CIK ${detail.cik}`;

  const eventRows = detail.events.map((e) => ({
    date: e.event_date,
    type: e.event_type,
    form: e.form,
    accession: e.accession_number,
    amount: e.amount,
    detail: e.detail,
  }));

  const dealRows = detail.deals.map((d) => ({
    "#": d.deal_index,
    outcome: d.outcome,
    target: d.target_name,
    loi: d.loi_date,
    announced: d.announced_date,
    agreement: d.definitive_agreement_date,
    proxy: d.proxy_date,
    vote: d.vote_date,
    resolved: d.outcome_date,
    pipe: d.pipe_amount,
    redemption: d.redemption_amount,
  }));

  const history = detail.history.map(
    (snap) => html`
      <details>
        <summary>
          <span class="mono">${snap.row.valid_from}</span>
          ${snap.row.valid_to === null ? html`<span class="tag ok">current</span>` : null}
          <span class="tag">${snap.row.status ?? "—"}</span>
          <span class="muted small"
            >via ${snap.row.change_source} · ${snap.changes.length} field(s) changed</span
          >
        </summary>
        ${
          snap.changes.length === 0
            ? html`<p class="muted small">No tracked field changed in this snapshot.</p>`
            : table({
                columns: [
                  { key: "field", label: "Field" },
                  { key: "from", label: "From" },
                  { key: "to", label: "To" },
                ],
                rows: snap.changes.map((c) => ({ field: c.field, from: c.from, to: c.to })),
              })
        }
        <h3>Full snapshot</h3>
        ${fields(snap.row as unknown as Record<string, unknown>)}
      </details>
    `
  );

  const body = html`
    <h1>${title}</h1>
    <p class="sub mono">CIK ${detail.cik}</p>
    ${issuerTabs(detail.cik, "spac")}
    ${
      detail.spac === undefined
        ? html`<p class="notice">
            No <code>spac</code> row for this CIK. That row is minted by the registration statement
            (S-1 / F-1 / DRS) — and it is what gates the entire 8-K / merger-proxy / Form 25-15
            tier, so nothing downstream will record anything until it exists. Start on the
            <a href="/spac/${detail.cik}/process">process page</a>.
          </p>`
        : html`
            <div class="panel">
              <div class="row">
                <span class="tag ok">${detail.spac.status}</span>
                <span class="muted small">
                  ${detail.deals.length} deal(s) · ${detail.events.length} event(s) ·
                  ${detail.sponsorCount} sponsor link(s) · ${detail.underwriterCount} underwriter
                  link(s)
                </span>
              </div>
              ${fields(detail.spac as unknown as Record<string, unknown>)}
            </div>
          `
    }
    ${
      detail.candidate === undefined
        ? null
        : html`<h2>Candidate screen</h2>
            <div class="panel">
              ${fields(detail.candidate as unknown as Record<string, unknown>)}
            </div>`
    }

    <h2>Deals</h2>
    <p class="sub small">
      One row per business-combination attempt, recomputed from the event stream on every write.
    </p>
    ${table({
      columns: [
        { key: "#", label: "#", numeric: true },
        { key: "outcome", label: "Outcome" },
        { key: "target", label: "Target" },
        { key: "loi", label: "LOI" },
        { key: "announced", label: "Announced" },
        { key: "agreement", label: "Agreement" },
        { key: "proxy", label: "Proxy" },
        { key: "vote", label: "Vote" },
        { key: "resolved", label: "Resolved" },
        { key: "pipe", label: "PIPE", numeric: true },
        { key: "redemption", label: "Redeemed", numeric: true },
      ],
      rows: dealRows,
      empty: "No deals derived — the event stream carries no combination milestones.",
    })}

    <h2>Events</h2>
    <p class="sub small">
      The append-only dated timeline every derived figure above is built from.
    </p>
    ${
      detail.events.length === 0
        ? html`<p class="muted">No events recorded.</p>`
        : raw(
            `<div class="scroll"><table><thead><tr>
            <th>Date</th><th>Type</th><th>Form</th><th>Accession</th>
            <th class="num">Amount</th><th>Detail</th>
          </tr></thead><tbody>` +
              eventRows
                .map(
                  (e) =>
                    `<tr><td class="mono">${esc(e.date)}</td><td>${esc(e.type)}</td>` +
                    `<td>${esc(cell(e.form))}</td>` +
                    `<td class="mono small"><a href="/spac/${detail.cik}/filing/${esc(e.accession)}">${esc(e.accession)}</a> ` +
                    `<a href="${esc(edgarFilingUrl(detail.cik, e.accession))}" target="_blank" rel="noreferrer">↗</a></td>` +
                    `<td class="num">${esc(cell(e.amount))}</td>` +
                    `<td class="small">${esc(cell(e.detail))}</td></tr>`
                )
                .join("") +
              `</tbody></table></div>`
          )
    }

    <h2>History</h2>
    <p class="sub small">
      Every recorded state of the <code>spac</code> row, with the fields each snapshot changed.
    </p>
    ${history.length === 0 ? html`<p class="muted">No history recorded.</p>` : history}
  `;

  return page({ title, body });
}
