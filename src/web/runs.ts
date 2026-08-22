/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry, uuid4 } from "workglow";
import { registerModelIds } from "../config/registerModels";
import { resetSpacProcessState } from "../task/spac/resetSpacProcessState";
import { IdentifySpacsTask } from "../task/spac/IdentifySpacsTask";
import { ProcessAccessionDocFormTask } from "../task/forms/ProcessAccessionDocFormTask";
import { parseSpacProcessForce } from "../task/spac/parseSpacProcessForce";
import { planSpacTimeline, planSpacTimelineRepair } from "../task/spac/planSpacTimeline";
import type { Filing } from "../storage/filing/FilingSchema";
import { EXTRACTION_DEAD_LETTER_REPOSITORY_TOKEN } from "../storage/dead-letter/ExtractionDeadLetterSchema";
import { ExtractorRunRepo } from "../storage/versioning/ExtractorRunRepo";
import { EXTRACTOR_RUN_REPOSITORY_TOKEN } from "../storage/versioning/ExtractorRunSchema";
import { formToExtractorId } from "../storage/versioning/extractorIds";
import { resolvePrimaryDocName } from "../util/accessionDocPath";
import { describeOverrides, withModelOverrides, type ModelOverrides } from "./data/models";

export type RunStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

/** One line of a run's transcript. `step` lines carry the filing they describe. */
export interface RunEvent {
  readonly seq: number;
  readonly at: string;
  readonly level: "info" | "warn" | "error" | "step";
  readonly message: string;
  /** Set on `step` lines so the process page can update the matching row in place. */
  readonly accessionNumber?: string;
  readonly state?: "running" | "done" | "failed";
}

/** A unit of work the web server started, and everything it has said so far. */
export interface RunRecord {
  readonly id: string;
  readonly kind: "candidates" | "timeline" | "filing";
  readonly label: string;
  /** The issuer this run belongs to, so the process page can show only its own runs. */
  readonly cik: number | undefined;
  readonly status: RunStatus;
  readonly queuedAt: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly error: string;
  readonly overrides: readonly string[];
  readonly events: readonly RunEvent[];
}

type Listener = (run: RunRecord, event: RunEvent | undefined) => void;

/**
 * Transcript lines kept per run. A de-SPAC'd operating company runs to
 * thousands of filings and each writes at least two lines, so an unbounded
 * transcript is unbounded memory in a process that is expected to stay up.
 */
const MAX_EVENTS_PER_RUN = 2_000;

/** Finished runs kept for inspection before the oldest is dropped. */
const MAX_RETAINED_RUNS = 50;

interface MutableRun {
  readonly id: string;
  readonly kind: RunRecord["kind"];
  label: string;
  readonly cik: number | undefined;
  status: RunStatus;
  readonly queuedAt: string;
  startedAt: string;
  finishedAt: string;
  error: string;
  readonly overrides: readonly string[];
  readonly events: RunEvent[];
  seq: number;
  /** Set while running, so a cancel request can reach the task in flight. */
  abort: (() => void) | undefined;
  cancelRequested: boolean;
}

/**
 * The server's single work queue.
 *
 * Runs execute strictly one at a time, and that is a correctness requirement
 * rather than a load-management choice: a model selection is applied by setting
 * the environment variable the extractor reads at call time
 * ({@link withModelOverrides}), which is process-global, so two concurrent runs
 * with different models would each observe the other's. Serializing also keeps
 * the SEC fetch budget and the per-CIK write ordering behaving exactly as they
 * do under the CLI, where one `spac process` owns the process.
 */
export class RunRegistry {
  private readonly runs = new Map<string, MutableRun>();
  private readonly order: string[] = [];
  private readonly listeners = new Set<Listener>();
  private queue: Promise<void> = Promise.resolve();

  /** Subscribe to every run's events. Returns the unsubscribe function. */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  list(): readonly RunRecord[] {
    return this.order.map((id) => snapshot(this.runs.get(id)!)).reverse();
  }

  get(id: string): RunRecord | undefined {
    const run = this.runs.get(id);
    return run === undefined ? undefined : snapshot(run);
  }

  /**
   * Ask a run to stop. A queued run is cancelled outright; a running one is
   * aborted cooperatively, which lands as `cancelled` once the task unwinds.
   */
  cancel(id: string): boolean {
    const run = this.runs.get(id);
    if (run === undefined) return false;
    if (run.status === "queued") {
      run.cancelRequested = true;
      run.status = "cancelled";
      run.finishedAt = new Date().toISOString();
      this.emit(run, this.push(run, "warn", "cancelled before it started"));
      return true;
    }
    if (run.status !== "running") return false;
    run.cancelRequested = true;
    this.emit(run, this.push(run, "warn", "cancellation requested"));
    run.abort?.();
    return true;
  }

  /**
   * Enqueue a run. Returns as soon as it is queued — the caller gets an id to
   * follow, and the browser watches the event stream rather than holding a
   * request open for a replay that can take an hour.
   */
  enqueue(args: {
    readonly kind: RunRecord["kind"];
    readonly label: string;
    readonly cik?: number | undefined;
    readonly overrides?: ModelOverrides | undefined;
    readonly body: (ctx: RunContext) => Promise<void>;
  }): RunRecord {
    const overrides = args.overrides ?? {};
    const run: MutableRun = {
      id: uuid4(),
      kind: args.kind,
      label: args.label,
      cik: args.cik,
      status: "queued",
      queuedAt: new Date().toISOString(),
      startedAt: "",
      finishedAt: "",
      error: "",
      overrides: describeOverrides(overrides),
      events: [],
      seq: 0,
      abort: undefined,
      cancelRequested: false,
    };
    this.runs.set(run.id, run);
    this.order.push(run.id);
    this.evict();
    this.emit(run, undefined);

    this.queue = this.queue.then(async () => {
      if (run.cancelRequested) return;
      run.status = "running";
      run.startedAt = new Date().toISOString();
      this.emit(run, this.push(run, "info", `started: ${run.label}`));
      for (const line of run.overrides) {
        this.emit(run, this.push(run, "info", `model override ${line}`));
      }
      try {
        await withModelOverrides(overrides, () => args.body(this.contextFor(run)));
        run.status = run.cancelRequested ? "cancelled" : "succeeded";
      } catch (e) {
        run.error = e instanceof Error ? e.message : String(e);
        run.status = run.cancelRequested ? "cancelled" : "failed";
        this.emit(run, this.push(run, "error", run.error));
      } finally {
        run.abort = undefined;
        run.finishedAt = new Date().toISOString();
        this.emit(run, this.push(run, "info", `finished: ${run.status}`));
      }
    });

    return snapshot(run);
  }

  private contextFor(run: MutableRun): RunContext {
    return {
      log: (level, message) => {
        this.emit(run, this.push(run, level, message));
      },
      step: (accessionNumber, state, message) => {
        this.emit(run, this.push(run, "step", message, accessionNumber, state));
      },
      setLabel: (label) => {
        run.label = label;
        this.emit(run, undefined);
      },
      onAbort: (fn) => {
        run.abort = fn;
      },
      get cancelled() {
        return run.cancelRequested;
      },
    };
  }

  private push(
    run: MutableRun,
    level: RunEvent["level"],
    message: string,
    accessionNumber?: string,
    state?: RunEvent["state"]
  ): RunEvent {
    const event: RunEvent = {
      seq: ++run.seq,
      at: new Date().toISOString(),
      level,
      message,
      ...(accessionNumber !== undefined ? { accessionNumber } : {}),
      ...(state !== undefined ? { state } : {}),
    };
    run.events.push(event);
    // Drop from the FRONT: the tail is what an operator watching a long replay
    // is reading, and the head is the part already scrolled past.
    if (run.events.length > MAX_EVENTS_PER_RUN)
      run.events.splice(0, run.events.length - MAX_EVENTS_PER_RUN);
    return event;
  }

  private emit(run: MutableRun, event: RunEvent | undefined): void {
    const record = snapshot(run);
    for (const listener of this.listeners) {
      try {
        listener(record, event);
      } catch {
        // A disconnected browser must not fail the run that was writing to it.
      }
    }
  }

  private evict(): void {
    while (this.order.length > MAX_RETAINED_RUNS) {
      const oldest = this.order[0]!;
      const run = this.runs.get(oldest);
      // Never evict a run that has not settled — the queue still holds it.
      if (run !== undefined && (run.status === "queued" || run.status === "running")) return;
      this.order.shift();
      this.runs.delete(oldest);
    }
  }
}

/** What a run body may do: write to its transcript and register a cancel hook. */
export interface RunContext {
  readonly log: (level: "info" | "warn" | "error", message: string) => void;
  readonly step: (
    accessionNumber: string,
    state: "running" | "done" | "failed",
    message: string
  ) => void;
  readonly setLabel: (label: string) => void;
  readonly onAbort: (fn: () => void) => void;
  readonly cancelled: boolean;
}

function snapshot(run: MutableRun): RunRecord {
  return {
    id: run.id,
    kind: run.kind,
    label: run.label,
    cik: run.cik,
    status: run.status,
    queuedAt: run.queuedAt,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    error: run.error,
    overrides: run.overrides,
    events: [...run.events],
  };
}

/** Rebuild `spac_candidate` from submissions metadata (`sec sync spacs --step identify`). */
export function enqueueCandidateRebuild(
  registry: RunRegistry,
  args: { readonly full: boolean }
): RunRecord {
  return registry.enqueue({
    kind: "candidates",
    label: args.full ? "Rebuild SPAC candidates (full rescan)" : "Refresh SPAC candidates",
    body: async (ctx) => {
      const task = new IdentifySpacsTask({ defaults: { full: args.full } });
      ctx.onAbort(() => task.abort());
      const out = await task.run({});
      ctx.log(
        "info",
        `scanned ${out.scanned}; identified ${out.identified} ` +
          `(high ${out.high}, medium ${out.medium}, low ${out.low}); pruned ${out.pruned}`
      );
    },
  });
}

/**
 * Replay one issuer's filings, serially and in filing-date order.
 *
 * The selection and the ordering come from {@link planSpacTimeline} — the same
 * function `ProcessSpacTimelineTask` replays — and the second, capped repair
 * pass from {@link planSpacTimelineRepair}, so a run started here recovers the
 * gated 8-Ks a CLI run would. What this driver adds is per-step reporting: it
 * runs the form task itself rather than delegating, so each filing's start and
 * outcome reach the browser as it happens.
 */
export function enqueueTimelineRun(
  registry: RunRegistry,
  args: {
    readonly cik: number;
    readonly force?: string | undefined;
    readonly accessions?: readonly string[] | undefined;
    readonly overrides?: ModelOverrides | undefined;
    readonly models?: readonly string[] | undefined;
  }
): RunRecord {
  const force = parseSpacProcessForce(args.force);
  const only = args.accessions === undefined ? undefined : new Set(args.accessions);
  const label =
    only !== undefined && only.size === 1
      ? `CIK ${args.cik}: re-run ${[...only][0]}`
      : force.kind === "all"
        ? `CIK ${args.cik}: rebuild every filing`
        : `CIK ${args.cik}: process outstanding filings`;

  return registry.enqueue({
    kind: only !== undefined && only.size === 1 ? "filing" : "timeline",
    label,
    cik: args.cik,
    overrides: args.overrides,
    body: async (ctx) => {
      // Register whatever models the run named before anything reads them, so a
      // freshly chosen id resolves instead of dead-lettering MODEL_RESOLUTION_ERROR.
      if (args.models !== undefined && args.models.length > 0) {
        await registerModelIds(args.models);
      }

      const plan = await planSpacTimeline({ cik: args.cik, force });
      if (plan.timeline.length === 0) {
        ctx.log("warn", "no processable filings for this issuer");
        return;
      }
      if (!plan.hasSpacRow) {
        ctx.log(
          "warn",
          "no `spac` row yet — 8-K / proxy / 25-15 filings stay gated until the " +
            "registration statement mints one, then the repair pass picks them up"
        );
      }

      // An explicit accession list is a request to run exactly those filings,
      // so it bypasses the already-succeeded skip: the whole point of clicking
      // one step is to re-run it, usually under a different model.
      const selected =
        only === undefined
          ? plan.toProcess
          : plan.timeline.filter((f) => only.has(f.accession_number));
      if (selected.length === 0) {
        ctx.log("info", "nothing outstanding — every filing already ran at the active version");
        return;
      }
      ctx.log(
        "info",
        `${selected.length} of ${plan.timeline.length} filing(s) to process ` +
          `(${plan.firstDate} → ${plan.lastDate})`
      );

      if (force.kind === "all" && only === undefined) {
        await resetSpacProcessState(args.cik, plan.activeVersions);
        ctx.log("info", "cleared prior runs, dead letters and derived SPAC state");
      }

      const processed = new Set<string>();
      await replay(ctx, args.cik, selected, processed);

      const repair = await planSpacTimelineRepair({
        cik: args.cik,
        timeline: plan.timeline,
        processedAccessions: processed,
      });
      if (repair.length > 0 && !ctx.cancelled) {
        ctx.log("info", `repair pass: ${repair.length} gated filing(s) now runnable`);
        await replay(ctx, args.cik, repair, processed);
      }

      // A partial filing is the documented NORMAL outcome of one AI section
      // dead-lettering, so it must not read as a failed run — but it does leave
      // work on the triage list, and the run transcript is where an operator is
      // looking when it happens.
      let triage = 0;
      for (const accession of processed) triage += await pendingTriage(accession);
      if (triage > 0) {
        ctx.log(
          "warn",
          `${triage} section(s) pending triage across the filings just run — ` +
            `open a filing's Extraction results tab, or \`sec extractor dead-letters <id>\``
        );
      }
    },
  });
}

/** One serial pass over `filings`, reporting each to the run transcript. */
async function replay(
  ctx: RunContext,
  cik: number,
  filings: readonly Filing[],
  processed: Set<string>
): Promise<void> {
  for (const filing of filings) {
    if (ctx.cancelled) {
      ctx.log("warn", "stopped before the remaining filings");
      return;
    }
    const form = filing.form ?? "";
    const accession = filing.accession_number;
    ctx.step(accession, "running", `${form} ${accession} (${filing.filing_date ?? "undated"})`);
    const task = new ProcessAccessionDocFormTask({ title: `${form} ${accession}` });
    ctx.onAbort(() => task.abort());
    const startedAt = Date.now();
    try {
      const out = await task.run({
        cik,
        form,
        accessionNumber: accession,
        fileName: resolvePrimaryDocName(filing.primary_doc),
      });
      const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
      // `success: false` is a CONTAINED failure — the task records the dead
      // letter and returns rather than throwing — so it must be reported as a
      // failed step, not swallowed because no exception reached here.
      const outcome = out.success ? await recordedOutcome(cik, accession, form) : "failure";
      ctx.step(
        accession,
        outcome === "failure" ? "failed" : "done",
        `${form} ${accession} ${outcome} in ${seconds}s`
      );
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      ctx.step(accession, "failed", `${form} ${accession} threw: ${message}`);
      // One bad filing never abandons the rest of the timeline — same contract
      // as `spac process`, whose per-issuer errors are reported and continued.
    } finally {
      processed.add(accession);
    }
  }
}

/**
 * The outcome the pipeline actually RECORDED for a filing, not the boolean the
 * form task returned.
 *
 * `ProcessAccessionDocFormTask` returns `{ success: true }` whenever store did
 * not throw — including when a section dead-lettered and the run was written
 * `partial`. Reporting that boolean is what printed "52/52 filings" for a CIK
 * whose DRS underwriters section came back MODEL_EMPTY, and it is the same
 * mistake on a page whose entire job is telling an operator which sections did
 * not extract.
 *
 * Falls back to `success` when no run row can be read: the task returned
 * without throwing, so claiming a failure on the strength of a missing
 * bookkeeping row would be a worse guess than trusting the return.
 */
export async function recordedOutcome(
  cik: number,
  accession: string,
  form: string
): Promise<"success" | "partial" | "failure"> {
  const extractorId = form === "" ? undefined : formToExtractorId(form);
  if (extractorId === undefined) return "success";
  try {
    const runRepo = new ExtractorRunRepo(globalServiceRegistry.get(EXTRACTOR_RUN_REPOSITORY_TOKEN));
    const latest = await runRepo.findLatestRun(cik, accession, extractorId);
    return latest?.outcome ?? "success";
  } catch {
    return "success";
  }
}

/** Pending dead-letter entries on a filing, for the run's closing summary. */
async function pendingTriage(accession: string): Promise<number> {
  try {
    const repo = globalServiceRegistry.get(EXTRACTION_DEAD_LETTER_REPOSITORY_TOKEN);
    return ((await repo.query({ accession_number: accession, status: "pending" })) ?? []).length;
  } catch {
    return 0;
  }
}
