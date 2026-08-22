/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry } from "workglow";
import { EXTRACTION_DEAD_LETTER_REPOSITORY_TOKEN } from "../../storage/dead-letter/ExtractionDeadLetterSchema";
import type { ExtractionDeadLetter } from "../../storage/dead-letter/ExtractionDeadLetterSchema";
import { ExtractorRunRepo } from "../../storage/versioning/ExtractorRunRepo";
import { EXTRACTOR_RUN_REPOSITORY_TOKEN } from "../../storage/versioning/ExtractorRunSchema";
import type { ExtractorRun } from "../../storage/versioning/ExtractorRunSchema";
import { formToExtractorId } from "../../storage/versioning/extractorIds";
import { planSpacTimeline } from "../../task/spac/planSpacTimeline";
import type { SpacProcessForce } from "../../task/spac/parseSpacProcessForce";
import { loadFilingDocument, type FilingDocument } from "./documents";

/**
 * What a step's last recorded run says about it. `pending` is the state a step
 * has never been run in; `stale` is one whose newest run is at a version other
 * than the active one, which reads as work to do rather than as a failure.
 */
export type StepState = "pending" | "success" | "partial" | "failure" | "stale";

/** One filing on the issuer's timeline — the unit `spac process` replays. */
export interface TimelineStep {
  readonly index: number;
  readonly cik: number;
  readonly accessionNumber: string;
  readonly form: string;
  readonly filingDate: string | null;
  readonly items: string | null;
  readonly extractorId: string | undefined;
  readonly activeVersion: string | undefined;
  readonly latestRun: ExtractorRun | undefined;
  readonly state: StepState;
  /** True when a plain (unforced) replay would send this filing to the processor. */
  readonly selected: boolean;
  readonly pendingDeadLetters: readonly ExtractionDeadLetter[];
  /** Cache status only — the body is not converted here (see {@link loadFilingDocument}). */
  readonly document: FilingDocument;
}

/** The whole checklist for one issuer. */
export interface TimelineSteps {
  readonly cik: number;
  readonly steps: readonly TimelineStep[];
  readonly hasSpacRow: boolean;
  readonly firstDate: string;
  readonly lastDate: string;
  /** Steps a plain replay would run — what the "Run outstanding" button covers. */
  readonly outstanding: number;
}

const NO_FORCE: SpacProcessForce = { kind: "none" };

function stateOf(run: ExtractorRun | undefined, activeVersion: string | undefined): StepState {
  if (run === undefined) return "pending";
  if (activeVersion !== undefined && run.extractor_version !== activeVersion) return "stale";
  return run.outcome;
}

/**
 * Build the per-filing checklist the process page renders.
 *
 * Selection comes from {@link planSpacTimeline}, the same function
 * `ProcessSpacTimelineTask` replays, so "what this page says is outstanding" and
 * "what pressing Run would actually process" cannot disagree.
 */
export async function loadTimelineSteps(cik: number): Promise<TimelineSteps> {
  const plan = await planSpacTimeline({ cik, force: NO_FORCE });
  const selected = new Set(plan.toProcess.map((f) => f.accession_number));
  const runRepo = new ExtractorRunRepo(globalServiceRegistry.get(EXTRACTOR_RUN_REPOSITORY_TOKEN));

  // One query for the whole issuer rather than one per filing.
  // `extraction_dead_letter` is keyed `(extractor_id, accession_number,
  // section_name)`, so a lookup by accession alone cannot use that index and
  // scans the table — once per step is N scans for a timeline that runs to
  // hundreds of filings on a de-SPAC'd operating company.
  const pendingByAccession = await loadPendingDeadLetters(
    plan.timeline.map((f) => f.accession_number)
  );

  const steps: TimelineStep[] = [];
  for (const [index, filing] of plan.timeline.entries()) {
    const form = filing.form ?? "";
    const extractorId = form === "" ? undefined : formToExtractorId(form);
    const activeVersion =
      extractorId === undefined ? undefined : plan.activeVersions.get(extractorId);
    // Keyed `(cik, accession_number, extractor_id, …)`, so this one DOES use
    // its index — the CIK prefix narrows it to the issuer's own runs.
    const latestRun =
      extractorId === undefined
        ? undefined
        : await runRepo.findLatestRun(cik, filing.accession_number, extractorId);
    const pending = pendingByAccession.get(filing.accession_number) ?? [];
    steps.push({
      index,
      cik,
      accessionNumber: filing.accession_number,
      form,
      filingDate: filing.filing_date ?? null,
      items: filing.items ?? null,
      extractorId,
      activeVersion,
      latestRun,
      state: stateOf(latestRun, activeVersion),
      selected: selected.has(filing.accession_number),
      pendingDeadLetters: pending,
      document: await loadFilingDocument({
        cik,
        accessionNumber: filing.accession_number,
        filing,
      }),
    });
  }

  return {
    cik,
    steps,
    hasSpacRow: plan.hasSpacRow,
    firstDate: plan.firstDate,
    lastDate: plan.lastDate,
    outstanding: plan.toProcess.length,
  };
}

/**
 * Pending dead letters for a set of accessions, grouped by accession.
 *
 * Issued as one `in`-list query per chunk rather than one query per accession:
 * the table has no index leading on `accession_number`, so each lookup is a
 * scan and the per-filing form turns a page render into N of them. Chunked
 * because SQLite binds one parameter per value and stays subject to
 * `SQLITE_MAX_VARIABLE_NUMBER`; Postgres binds the whole list as one array.
 */
async function loadPendingDeadLetters(
  accessions: readonly string[]
): Promise<ReadonlyMap<string, ExtractionDeadLetter[]>> {
  const byAccession = new Map<string, ExtractionDeadLetter[]>();
  if (accessions.length === 0) return byAccession;
  const repo = globalServiceRegistry.get(EXTRACTION_DEAD_LETTER_REPOSITORY_TOKEN);
  for (let i = 0; i < accessions.length; i += DEAD_LETTER_QUERY_CHUNK) {
    const chunk = accessions.slice(i, i + DEAD_LETTER_QUERY_CHUNK);
    const rows = ((await repo.query({
      accession_number: { value: [...chunk], operator: "in" },
      status: "pending",
    } as never)) ?? []) as ExtractionDeadLetter[];
    for (const row of rows) {
      const list = byAccession.get(row.accession_number);
      if (list === undefined) byAccession.set(row.accession_number, [row]);
      else list.push(row);
    }
  }
  return byAccession;
}

/** Values per `in`-list query, well under SQLite's default parameter ceiling. */
const DEAD_LETTER_QUERY_CHUNK = 400;
