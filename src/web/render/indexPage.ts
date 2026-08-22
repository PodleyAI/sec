/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { CandidatePage } from "../data/candidates";
import type { ModelSlot } from "../data/models";
import type { RunRecord } from "../runs";
import { html, page, raw } from "./layout";
import { runStatusTag } from "./runsPage";

/** The overview: where the data stands, and the three things you can do about it. */
export function renderIndexPage(args: {
  readonly candidates: CandidatePage;
  readonly slots: readonly ModelSlot[];
  readonly slotModels: ReadonlyMap<string, readonly string[]>;
  readonly runs: readonly RunRecord[];
  readonly dbLabel: string;
}): string {
  const c = args.candidates;
  const body = html`
    <h1>SPAC pipeline inspector</h1>
    <p class="sub">
      A local view of the same data and the same steps the <code>sec</code> /
      <code>embarc-data</code>
      CLI works with — so a candidate, a replay, a converted document and an extractor's output can
      be checked against each other without a shell round-trip.
    </p>

    <div class="panel">
      <h2 style="margin-top:0">Candidates</h2>
      <p>
        <strong>${c.total}</strong> screened
        <span class="muted">
          (high ${c.byConfidence.high}, medium ${c.byConfidence.medium}, low ${c.byConfidence.low})
        </span>
        — <strong>${c.processed}</strong> already have a <code>spac</code> row.
      </p>
      <p><a href="/candidates">Browse candidates →</a></p>
    </div>

    <div class="panel">
      <h2 style="margin-top:0">Models in effect</h2>
      <p class="small muted">
        What each extractor slot resolves to right now. A run may override any of them for its own
        duration from the process page.
      </p>
      <dl class="kv">
        ${args.slots.map(
          (slot) =>
            html`<dt><code>${slot.envVar}</code></dt>
              <dd>${(args.slotModels.get(slot.id) ?? []).join(", ") || "unset"}</dd>`
        )}
      </dl>
    </div>

    <div class="panel">
      <h2 style="margin-top:0">Database</h2>
      <p class="mono small">${args.dbLabel}</p>
    </div>

    <h2>Recent runs</h2>
    ${
      args.runs.length === 0
        ? html`<p class="muted">Nothing has been run from this interface yet.</p>`
        : args.runs.slice(0, 10).map(
            (run) =>
              html`<div class="panel row">
                <span class="tag ${raw(runStatusTag(run.status))}">${run.status}</span>
                <a href="/runs/${run.id}">${run.label}</a>
                <span class="muted small">${run.queuedAt.slice(0, 19)}</span>
              </div>`
          )
    }
  `;
  return page({ title: "Overview", body });
}
