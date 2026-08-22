/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { RunRecord } from "../runs";
import { esc, html, page, raw, type Html } from "./layout";

export function runStatusTag(status: string): string {
  if (status === "succeeded") return "ok";
  if (status === "failed") return "bad";
  if (status === "running" || status === "queued") return "warn";
  return "";
}

/** A run's transcript, newest last — the order it was written in. */
export function runTranscript(run: RunRecord): Html {
  if (run.events.length === 0) return html`<p class="muted small">No output yet.</p>`;
  return raw(
    `<div class="log mono">` +
      run.events
        .map(
          (e) =>
            `<div class="${esc(e.level)}"><span class="muted">${esc(e.at.slice(11, 19))}</span> ${esc(e.message)}</div>`
        )
        .join("") +
      `</div>`
  );
}

/** The run list — every run this server has started, newest first. */
export function renderRunsPage(runs: readonly RunRecord[]): string {
  const body = html`
    <h1>Runs</h1>
    <p class="sub">
      Work started from this interface. Runs execute strictly one at a time: a model selection is
      applied by setting the environment variable the extractor reads, which is process-global.
    </p>
    ${
      runs.length === 0
        ? html`<p class="muted">Nothing has been run yet.</p>`
        : runs.map(
            (run) =>
              html`<div class="panel">
                <div class="row">
                  <span class="tag ${raw(runStatusTag(run.status))}">${run.status}</span>
                  <a href="/runs/${run.id}">${run.label}</a>
                  <span class="muted small">queued ${run.queuedAt.slice(0, 19)}</span>
                  ${
                    run.cik === undefined
                      ? null
                      : html`<a class="small" href="/spac/${run.cik}/process">CIK ${run.cik}</a>`
                  }
                </div>
                ${run.error === "" ? null : html`<div class="small" style="color:var(--bad)">${run.error}</div>`}
              </div>`
          )
    }
  `;
  return page({ title: "Runs", body });
}

/** One run, with a live transcript. */
export function renderRunPage(run: RunRecord): string {
  const body = html`
    <h1>${run.label}</h1>
    <p class="sub">
      <span class="tag ${raw(runStatusTag(run.status))}" data-run-status>${run.status}</span>
      <span class="muted small">
        queued
        ${run.queuedAt.slice(0, 19)}${run.startedAt === "" ? "" : ` · started ${run.startedAt.slice(11, 19)}`}${run.finishedAt === "" ? "" : ` · finished ${run.finishedAt.slice(11, 19)}`}
      </span>
    </p>
    ${
      run.cik === undefined
        ? null
        : html`<p><a href="/spac/${run.cik}/process">← back to CIK ${run.cik}</a></p>`
    }
    ${
      run.overrides.length === 0
        ? null
        : html`<div class="panel small">
            models: ${run.overrides.map((o) => html`<code>${o}</code> `)}
          </div>`
    }
    ${run.error === "" ? null : html`<div class="panel" style="color:var(--bad)">${run.error}</div>`}
    <div class="panel" id="log">${runTranscript(run)}</div>
    ${
      run.status === "running" || run.status === "queued"
        ? html`<form class="inline" method="post" action="/api/runs/${run.id}/cancel">
            <button type="submit">Cancel</button>
          </form>`
        : null
    }
  `;

  const script = `
const es = new EventSource("/events?run=${run.id}");
const log = document.querySelector("#log .log") || (() => {
  const d = document.createElement("div"); d.className = "log mono";
  document.getElementById("log").replaceChildren(d); return d;
})();
es.onmessage = (m) => {
  let e; try { e = JSON.parse(m.data); } catch { return; }
  for (const el of document.querySelectorAll("[data-run-status]")) {
    el.textContent = e.run.status;
  }
  if (e.event) {
    const line = document.createElement("div");
    line.className = e.event.level;
    line.innerHTML = '<span class="muted"></span> ';
    line.firstChild.textContent = e.event.at.slice(11, 19);
    line.appendChild(document.createTextNode(e.event.message));
    log.appendChild(line);
    log.scrollTop = log.scrollHeight;
  }
  if (e.run.status !== "running" && e.run.status !== "queued") es.close();
};
`;

  return page({ title: run.label, body, script });
}
