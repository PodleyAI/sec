/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { MODEL_SLOTS, type ModelOption } from "../data/models";
import { edgarFilingUrl } from "../data/documents";
import type { TimelineStep, TimelineSteps } from "../data/steps";
import type { RunRecord } from "../runs";
import { esc, html, page, raw, type Html } from "./layout";
import { issuerTabs } from "./spacPage";
import { runTranscript } from "./runsPage";

const STATE_CLASS: Readonly<Record<string, string>> = {
  success: "ok",
  partial: "warn",
  failure: "bad",
  stale: "warn",
  pending: "",
};

/**
 * The model picker.
 *
 * Every slot is offered rather than just "the model", because the pipeline does
 * not have one model: a filing's cost is dominated by the chunked risk-factors
 * section, whose whole reason for having its own knob is that it can be pointed
 * somewhere cheaper independently. Leaving a slot on "unchanged" is the common
 * case and is what the empty option means.
 */
function modelPicker(args: {
  readonly options: readonly ModelOption[];
  readonly current: ReadonlyMap<string, readonly string[]>;
}): Html {
  return html`<details class="panel">
    <summary>
      Models <span class="muted small">— leave unchanged to use the configured ones</span>
    </summary>
    <div class="grid" style="margin-top:.6rem">
      ${MODEL_SLOTS.map(
        (slot) => html`
          <label class="small">
            <div><strong>${slot.label}</strong></div>
            <div class="muted" style="margin-bottom:.2rem">${slot.description}</div>
            <select name="model_${slot.id}">
              <option value="">
                unchanged (${(args.current.get(slot.id) ?? []).join(", ") || "unset"})
              </option>
              ${args.options.map(
                (o) =>
                  html`<option value="${o.id}">
                    ${o.id}${o.available ? "" : ` — needs ${o.apiKeyEnvVar}`}
                  </option>`
              )}
            </select>
            <div class="muted" style="margin-top:.2rem">
              <code class="small">${slot.envVar}</code>
            </div>
          </label>
        `
      )}
      <label class="small">
        <div><strong>Any other model id</strong></div>
        <div class="muted" style="margin-bottom:.2rem">
          Applied to every slot left unchanged above. Any id <code>secModelRecord</code> recognizes
          works — it is registered on demand.
        </div>
        <input type="text" name="model_free" placeholder="e.g. gguf:hf:org/repo:Q4_K_M" />
      </label>
    </div>
    <p class="small muted">
      A model is applied by setting the environment variable the extractor reads, for the duration
      of the run — which is process-global, so runs are executed strictly one at a time.
    </p>
  </details>`;
}

function stepRow(step: TimelineStep): Html {
  const cls = STATE_CLASS[step.state] ?? "";
  const run = step.latestRun;
  return html`<tr id="step-${raw(esc(step.accessionNumber))}">
    <td class="num muted small">${step.index + 1}</td>
    <td class="mono small">${step.filingDate ?? "undated"}</td>
    <td>
      ${step.form}
      ${step.items === null || step.items === "" ? null : html`<div class="muted small">items ${step.items}</div>`}
    </td>
    <td class="small">${step.extractorId ?? "—"}</td>
    <td>
      <span class="tag ${raw(cls)}" data-state>${step.state}</span>
      ${step.selected ? html` <span class="tag">outstanding</span>` : null}
      ${
        run === undefined
          ? null
          : html`<div class="muted small">
              v${run.extractor_version} · ${run.ran_at.slice(0, 19)}
            </div>`
      }
      ${run?.error ? html`<div class="small" style="color:var(--bad)">${run.error}</div>` : null}
    </td>
    <td class="small">
      ${
        step.document.cached
          ? html`<span class="tag ok">cached</span>
              <div class="muted small">${Math.round(step.document.bytes / 1024)} KB</div>`
          : html`<span class="tag bad">no document</span>
              <div class="muted small">${step.document.error}</div>`
      }
    </td>
    <td class="small">
      ${
        step.pendingDeadLetters.length === 0
          ? html`<span class="muted">—</span>`
          : step.pendingDeadLetters.map(
              (dl) =>
                html`<div>
                  <span class="tag bad">${dl.reason_code}</span>
                  <span class="muted"
                    >${dl.section_name === "" ? "(filing)" : dl.section_name}</span
                  >
                </div>`
            )
      }
    </td>
    <td class="small">
      <a href="/spac/${step.cik}/filing/${raw(esc(step.accessionNumber))}">Inspect</a>
      &middot;
      <a
        href="${raw(esc(edgarFilingUrl(step.cik, step.accessionNumber)))}"
        target="_blank"
        rel="noreferrer"
        >EDGAR</a
      >
      &middot;
      <button type="submit" name="accession" value="${step.accessionNumber}" form="run-form">
        Run
      </button>
    </td>
  </tr>`;
}

/**
 * The process page: the issuer's timeline as a checklist, plus the controls to
 * run it.
 *
 * Steps are the filings, in filing-date order, because that IS the pipeline's
 * unit of work and its ordering constraint — processing a SPAC by form type
 * drops de-SPAC milestones on the floor while every filing still reports
 * success. Rendering the order the replay uses is what makes the page a
 * verification surface rather than a launcher.
 */
export function renderProcessPage(args: {
  readonly steps: TimelineSteps;
  readonly name: string;
  readonly options: readonly ModelOption[];
  readonly currentModels: ReadonlyMap<string, readonly string[]>;
  readonly runs: readonly RunRecord[];
  readonly activeRun: RunRecord | undefined;
}): string {
  const { steps } = args;
  const counts = steps.steps.reduce<Record<string, number>>((acc, s) => {
    acc[s.state] = (acc[s.state] ?? 0) + 1;
    return acc;
  }, {});
  const uncached = steps.steps.filter((s) => !s.document.cached).length;

  const body = html`
    <h1>${args.name}</h1>
    <p class="sub mono">CIK ${steps.cik}</p>
    ${issuerTabs(steps.cik, "process")}

    <div class="panel">
      <div class="row">
        <span><strong>${steps.steps.length}</strong> filings on the timeline</span>
        <span class="muted small">${steps.firstDate || "—"} → ${steps.lastDate || "—"}</span>
        <span class="tag ok">${counts["success"] ?? 0} success</span>
        <span class="tag warn">${counts["partial"] ?? 0} partial</span>
        <span class="tag bad">${counts["failure"] ?? 0} failed</span>
        <span class="tag">${counts["pending"] ?? 0} never run</span>
        <span class="tag warn">${counts["stale"] ?? 0} stale version</span>
      </div>
      <div class="small muted" style="margin-top:.4rem">
        <strong>${steps.outstanding}</strong> filing(s) a plain replay would process.
        ${
          steps.hasSpacRow
            ? ""
            : raw(
                "No <code>spac</code> row yet — 8-K / proxy / 25-15 filings stay gated until the " +
                  "registration statement mints one; the run's repair pass picks them up in the same pass."
              )
        }
        ${
          uncached === 0
            ? ""
            : raw(
                ` ${uncached} filing(s) have no cached document; the run fetches them from EDGAR ` +
                  `under the rate limiter, or pre-fill with <code>sec spac download everything</code>.`
              )
        }
      </div>
    </div>

    ${
      args.activeRun === undefined
        ? null
        : html`<p class="notice">
            In flight: <a href="/runs/${args.activeRun.id}">${args.activeRun.label}</a> (<span
              data-run-status
              >${args.activeRun.status}</span
            >).
          </p>`
    }

    <form id="run-form" method="post" action="/api/process">
      <input type="hidden" name="cik" value="${steps.cik}" />
      ${modelPicker({ options: args.options, current: args.currentModels })}
      <div class="panel row">
        <button class="primary" type="submit" name="mode" value="outstanding">
          Run ${steps.outstanding} outstanding filing(s)
        </button>
        <button
          type="submit"
          name="mode"
          value="rebuild"
          onclick="return confirm('Rebuild clears every recorded run, dead letter and derived SPAC state for this CIK, then replays all ${steps.steps.length} filings. Continue?')"
        >
          Rebuild everything
        </button>
        <span class="muted small">
          Filings run serially in filing-date order — that ordering is what makes the timeline
          correct, so it is not configurable.
        </span>
      </div>

      <h2>Steps</h2>
      ${
        steps.steps.length === 0
          ? html`<p class="muted">
              No processable filings. Ingest them first with <code>sec sync submissions</code>.
            </p>`
          : raw(
              `<div class="scroll"><table><thead><tr>
              <th class="num">#</th><th>Filed</th><th>Form</th><th>Extractor</th>
              <th>Last run</th><th>Document</th><th>Pending triage</th><th></th>
            </tr></thead><tbody>${steps.steps.map((s) => stepRow(s).__html).join("")}</tbody></table></div>`
            )
      }
    </form>

    <h2>Recent runs</h2>
    ${
      args.runs.length === 0
        ? html`<p class="muted">
            Nothing has been run from the web interface for this issuer yet.
          </p>`
        : args.runs.map(
            (run) =>
              html`<details class="panel" ${raw(run.status === "running" ? "open" : "")}>
                <summary>
                  <span class="tag ${raw(runTag(run.status))}">${run.status}</span>
                  ${run.label}
                  <span class="muted small">${run.queuedAt.slice(0, 19)}</span>
                </summary>
                ${
                  run.overrides.length === 0
                    ? null
                    : html`<p class="small muted">models: ${run.overrides.join("  ")}</p>`
                }
                ${runTranscript(run)}
                ${
                  run.status === "running" || run.status === "queued"
                    ? html`<form class="inline" method="post" action="/api/runs/${run.id}/cancel">
                        <button type="submit">Cancel</button>
                      </form>`
                    : null
                }
              </details>`
          )
    }
  `;

  // Live updates: the browser follows the server's event stream and repaints
  // the step it names. A poll would either lag a 40-minute replay or hammer a
  // page whose tables are rebuilt from the database on every load.
  const script = `
const es = new EventSource("/events?cik=${steps.cik}");
es.onmessage = (m) => {
  let e; try { e = JSON.parse(m.data); } catch { return; }
  if (e.event && e.event.accessionNumber) {
    const row = document.getElementById("step-" + e.event.accessionNumber);
    if (row) {
      const tag = row.querySelector("[data-state]");
      if (tag) {
        const state = e.event.state;
        tag.textContent = state === "running" ? "running…" : state === "done" ? "just ran" : "failed";
        tag.className = "tag " + (state === "failed" ? "bad" : state === "done" ? "ok" : "warn");
      }
      if (e.event.state === "running") row.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }
  for (const el of document.querySelectorAll("[data-run-status]")) el.textContent = e.run.status;
  // A finished run changes counts, dead letters and stored rows all over the
  // page, so reload rather than trying to patch each of them in place.
  if (e.event && e.event.message && e.event.message.indexOf("finished:") === 0) {
    setTimeout(() => location.reload(), 750);
  }
};
`;

  return page({ title: `${args.name} — process`, body, script });
}

function runTag(status: string): string {
  if (status === "succeeded") return "ok";
  if (status === "failed") return "bad";
  if (status === "running" || status === "queued") return "warn";
  return "";
}
