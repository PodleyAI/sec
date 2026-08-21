/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Type } from "typebox";
import { globalServiceRegistry, IExecuteContext, Task } from "workglow";
import { TypeSecCik } from "../../sec/submissions/EnititySubmissionSchema";
import { TypeAccessionNumber } from "../../sec/edgar/accessionNumber";
import { isDryRun } from "../../cli/isDryRun";
import {
  FILING_REPOSITORY_TOKEN,
  type Filing,
  type FilingRepositoryStorage,
} from "../../storage/filing/FilingSchema";
import { COMPONENT_VERSION_REPOSITORY_TOKEN } from "../../storage/versioning/ComponentVersionSchema";
import {
  FORM_TO_EXTRACTOR_ID,
  formToExtractorId,
  sortFormsForSweep,
} from "../../storage/versioning/extractorIds";
import { ExtractorRunRepo, filingRunKey } from "../../storage/versioning/ExtractorRunRepo";
import { EXTRACTOR_RUN_REPOSITORY_TOKEN } from "../../storage/versioning/ExtractorRunSchema";
import { getActiveSlot } from "../../storage/versioning/getActiveSlot";
import { VersionRegistry } from "../../storage/versioning/VersionRegistry";
import { SecFetchMaxPerSec } from "../../config/Constants";
import { resolvePrimaryDocName } from "../../util/accessionDocPath";

export type ComputeFormsWorklistTaskInput = {
  /** Omit (or pass empty) to process every form with a registered extractor. */
  readonly form?: string[];
  /**
   * 0-based shard index for horizontal fan-out across processes. When
   * `shardCount > 1`, this producer keeps only the filings whose accession
   * number hashes into this shard, so N processes each with a distinct
   * `shardIndex` (0..N-1) and the same `shardCount` cover the worklist
   * disjointly with no coordination. Defaults to the single-shard identity
   * (index 0, count 1 → keep everything).
   */
  readonly shardIndex?: number;
  readonly shardCount?: number;
  /** When non-empty, only filings whose CIK is in this list are emitted. */
  readonly ciks?: number[];
  /**
   * When non-empty, `8-K` / `8-K/A` filings are emitted only if their
   * submissions `items` string contains one of these codes. Other forms are
   * unaffected. Used by the SPAC process sweep so earnings 2.02s of a
   * de-SPAC'd operating company are not fetched as if they were lifecycle
   * events.
   */
  readonly eightKItems?: string[];
  /**
   * When set, filings whose `filing_date` is strictly before this YYYY-MM-DD
   * are consumed but not emitted. Used by `sync spacs --only updates` so a
   * daily run is new filings, not the historical leftover on already-touched
   * SPACs. An empty filing_date is kept.
   */
  readonly filedOnOrAfter?: string;
  /**
   * Filings emitted per batch. Defaults to {@link WORKLIST_BATCH_SIZE}; exposed
   * mainly so tests can drive the batching/resume path with a handful of rows
   * instead of thousands.
   */
  readonly batchSize?: number;
};

/**
 * Rows read per query while scanning a form's filings.
 *
 * The candidate set is far too large to materialize: form 4 alone is ~4.6M
 * filings and the full 55-form worklist ~6.4M, at a measured ~460 bytes per
 * 15-column row — ~3 GB per process, multiplied again by every `--shard`
 * process, since each one scans the whole set. 10k holds ~5 MB in flight.
 *
 * Page size does not have to exceed a single (form, cik) group:
 * {@link ComputeFormsWorklistTask.readPage} resumes with a keyset, so a CIK
 * with tens of thousands of 424B2s (shelf takedowns) is several pages rather
 * than a stall. When `ciks` is set, those pages are also narrowed to that
 * allow-list (`cik IN (...)`), so a SPAC sweep never loads a non-SPAC
 * issuer's forms.
 */
const FILING_PAGE_SIZE = 10_000;

/**
 * CIKs per `in` list. SQLite binds one parameter per value and stays subject
 * to `SQLITE_MAX_VARIABLE_NUMBER` (999 on older builds); Postgres binds the
 * list as one array. 900 matches the other `in`-list callers (observation
 * titles, SPAC download). The other bind in these queries is `form`.
 */
const WORKLIST_CIK_CHUNK = 900;

/**
 * Filings emitted per batch — the ceiling on what the producer holds and hands
 * to one fan-out iteration.
 *
 * The sweep processes FORMS_SWEEP_CONCURRENCY_LIMIT (10) filings at a time, so
 * the worklist never needed to exist in full: it previously materialized every
 * matching filing before the first fetch, ~1M entries and 158 MB for one shard
 * of today's corpus, and growing without bound. Batching caps that at ~5k
 * entries (~0.8 MB) and, more importantly, starts real work immediately
 * instead of after a multi-minute scan.
 *
 * Large enough to amortize the batch barrier: at 10-way concurrency a batch is
 * ~500 waves, so the workers draining at each batch tail cost well under 1%.
 */
const WORKLIST_BATCH_SIZE = 5_000;

/**
 * Deterministic 32-bit FNV-1a hash of the accession number, used only to
 * assign a filing to a shard. Must be stable across processes and runs so the
 * same filing always lands in the same shard; it is not security-sensitive.
 */
function accessionShard(accession: string, shardCount: number): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < accession.length; i++) {
    h ^= accession.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // `>>> 0` coerces to unsigned before the modulo so the shard is non-negative.
  return (h >>> 0) % shardCount;
}

/** True when a comma/semicolon-separated EDGAR `items` string names any code. */
function filingHasAnyItem(items: string | null | undefined, codes: ReadonlySet<string>): boolean {
  if (!items) return false;
  for (const raw of items.split(/[,;]/)) {
    if (codes.has(raw.trim())) return true;
  }
  return false;
}

/**
 * When `eightKItems` is set, 8-Ks that do not carry one of those codes are
 * consumed (resume advances past them) but not emitted.
 */
function skipEightKWithoutItems(
  form: string | null | undefined,
  items: string | null | undefined,
  codes: ReadonlySet<string> | undefined
): boolean {
  if (codes === undefined) return false;
  if (form !== "8-K" && form !== "8-K/A") return false;
  return !filingHasAnyItem(items, codes);
}

/** True when `filedOnOrAfter` is set and this filing is dated strictly earlier. */
function skipFiledBefore(
  filingDate: string | null | undefined,
  onOrAfter: string | undefined
): boolean {
  if (onOrAfter === undefined) return false;
  if (!filingDate) return false;
  return filingDate < onOrAfter;
}

export type ComputeFormsWorklistTaskOutput = {
  /** Parallel arrays, aligned by index — one entry per filing to process. */
  accessionNumber: string[];
  cik: number[];
  form: string[];
  fileName: string[];
  /** Convenience count of the worklist length (arrays' shared length). */
  count: number;
};

/**
 * Computes the forms worklist — every filing of the requested form types that
 * does not yet have a successful `extractor_runs` row at the current extractor
 * version — and emits it as four index-aligned array output ports plus a
 * `count`. The downstream `.forEach()` / `.map()` loop node auto-connects those
 * arrays by port name (`accessionNumber` / `cik` / `form` / `fileName`) and
 * fans each filing out to a {@link ProcessAccessionDocFormTask} iteration, so
 * the loop is a first-class node in the outer workflow and the CLI renders live
 * per-iteration progress. (Previously the map ran inside a private nested
 * `Workflow` here, so its iterations were invisible to the run renderer.)
 *
 * Re-processing existing rows requires a version bump (`sec version
 * start-dev` / `promote`); there is no --force escape hatch.
 */
export class ComputeFormsWorklistTask extends Task<
  ComputeFormsWorklistTaskInput,
  ComputeFormsWorklistTaskOutput
> {
  static readonly type = "ComputeFormsWorklistTask";
  static readonly category = "SEC";
  static readonly title = "Compute forms worklist";
  static readonly cacheable = false;

  public static inputSchema() {
    return Type.Object({
      form: Type.Optional(Type.Array(Type.String())),
      shardIndex: Type.Optional(Type.Integer({ minimum: 0 })),
      shardCount: Type.Optional(Type.Integer({ minimum: 1 })),
      ciks: Type.Optional(Type.Array(TypeSecCik())),
      eightKItems: Type.Optional(Type.Array(Type.String())),
      filedOnOrAfter: Type.Optional(Type.String()),
      batchSize: Type.Optional(Type.Integer({ minimum: 1 })),
    });
  }

  public static outputSchema() {
    // Element types mirror ProcessAccessionDocFormTask's input ports exactly
    // (branded TypeAccessionNumber / TypeSecCik, not plain string/number) so the
    // downstream loop node's schema-based auto-connect matches every port by
    // name AND type. A plain-number `cik` fails the type match and silently
    // stays unconnected, forcing a per-iteration filing re-query fallback.
    return Type.Object({
      accessionNumber: Type.Array(TypeAccessionNumber()),
      cik: Type.Array(TypeSecCik()),
      form: Type.Array(Type.String()),
      fileName: Type.Array(Type.String()),
      count: Type.Integer(),
    });
  }

  /**
   * Resume state, held on the instance rather than chained through output
   * ports. The `while` loop's body ends in the `forEach` fan-out, so the
   * merged body output the loop chains forward is the fan-out's, not this
   * task's — a resume key routed through ports would silently arrive stale
   * and the loop would never advance. The loop condition instead closes over
   * {@link exhausted} directly (see `formsSweepLoop`), and the subgraph is
   * built once so this instance survives every iteration.
   */
  private forms: string[] | undefined;
  private formPos = 0;
  /** Last filing emitted for the current form; the resume point within it. */
  private lastCik: number | undefined;
  private lastAccession: string | undefined;
  /** Successful-run keys for the current form, rebuilt when the form advances. */
  private successfulKeys: Set<string> | undefined;
  private extractorVersion: string | undefined;

  /** True once every requested form has been drained. Read by the loop condition. */
  public exhausted = false;

  async execute(
    input: ComputeFormsWorklistTaskInput,
    _context: IExecuteContext
  ): Promise<ComputeFormsWorklistTaskOutput> {
    const filingRepo = globalServiceRegistry.get(FILING_REPOSITORY_TOKEN);
    const runRepo = new ExtractorRunRepo(globalServiceRegistry.get(EXTRACTOR_RUN_REPOSITORY_TOKEN));
    const versionRegistry = new VersionRegistry(
      globalServiceRegistry.get(COMPONENT_VERSION_REPOSITORY_TOKEN)
    );

    const requestedForms =
      input.form !== undefined && input.form.length > 0
        ? input.form
        : Object.keys(FORM_TO_EXTRACTOR_ID);
    const formSet = new Set(requestedForms);

    const shardCount = input.shardCount ?? 1;
    const shardIndex = input.shardIndex ?? 0;
    if (shardCount < 1 || shardIndex < 0 || shardIndex >= shardCount) {
      throw new Error(
        `Invalid shard ${shardIndex}/${shardCount}: need shardCount >= 1 and 0 <= shardIndex < shardCount.`
      );
    }
    const sharding = shardCount > 1;
    const cikAllowList =
      input.ciks !== undefined && input.ciks.length > 0 ? new Set(input.ciks) : undefined;
    const allowCiks =
      cikAllowList !== undefined ? [...cikAllowList].sort((a, b) => a - b) : undefined;
    const eightKItemSet =
      input.eightKItems !== undefined && input.eightKItems.length > 0
        ? new Set(input.eightKItems)
        : undefined;
    const filedOnOrAfter = input.filedOnOrAfter;
    const dryRun = isDryRun();
    const batchSize = input.batchSize ?? WORKLIST_BATCH_SIZE;

    // One batch's worth of worklist — four scalars per filing, never an
    // intermediate Filing[]. Bounded by WORKLIST_BATCH_SIZE regardless of how
    // large the corpus grows, which is the whole point of the batching.
    const accessionNumber: string[] = [];
    const cik: number[] = [];
    const formOut: string[] = [];
    const fileName: string[] = [];

    // Cache active-slot lookups per extractor_id. Active slot is "next if a
    // dev version exists, else current" — shared across every form that maps
    // to the same extractor id so we don't re-resolve it per form.
    const slotCache = new Map<string, Awaited<ReturnType<typeof getActiveSlot>>>();
    const resolveVersion = async (extractorId: string): Promise<string> => {
      let active = slotCache.get(extractorId);
      if (active === undefined) {
        const resolved = await getActiveSlot(versionRegistry, "extractor", extractorId);
        if (!resolved) {
          throw new Error(
            `No active slot for extractor '${extractorId}'. Run 'sec db setup' to bootstrap.`
          );
        }
        active = resolved;
        slotCache.set(extractorId, active);
      }
      return active.semver;
    };

    // Forms with a registered extractor, in a stable order so the resume
    // position (formPos) means the same thing on every iteration.
    //
    // The order is the SWEEP order, not the caller's: registration statements
    // mint the `spac` row that the 8-K / proxy / 25-15 handlers are gated on,
    // and each of those records a successful run when the row is missing, so
    // reaching them first drops their events with nothing to re-select them.
    // Applied to an explicit `--form` list too, so a multi-form request is
    // ordered correctly without the operator knowing to do it.
    if (this.forms === undefined) {
      this.forms = sortFormsForSweep(
        [...formSet].filter((form) => {
          if (formToExtractorId(form)) return true;
          console.warn(`update-forms: form '${form}' has no registered extractor; skipping`);
          return false;
        })
      );
    }

    // Dry run reports the full total, so it scans everything in one pass and
    // retains nothing — there is no fan-out to feed and no reason to batch.
    if (dryRun) {
      let total = 0;
      for (const form of this.forms) {
        const extractorId = formToExtractorId(form)!;
        const keys = await runRepo.successfulRunKeys(
          extractorId,
          await resolveVersion(extractorId),
          form
        );
        let from: number | undefined;
        let seen: string | undefined;
        for (;;) {
          const { rows, full } = await this.readPage(filingRepo, form, from, seen, allowCiks);
          for (const f of rows) {
            if (sharding && accessionShard(f.accession_number, shardCount) !== shardIndex) continue;
            if (cikAllowList !== undefined && !cikAllowList.has(f.cik)) continue;
            if (skipEightKWithoutItems(f.form, f.items, eightKItemSet)) continue;
            if (skipFiledBefore(f.filing_date, filedOnOrAfter)) continue;
            if (keys.has(filingRunKey(f))) continue;
            total++;
          }
          if (!full) break;
          const last = rows[rows.length - 1]!;
          from = last.cik;
          seen = last.accession_number;
        }
      }
      this.exhausted = true;
      const shardNote = sharding ? ` (shard ${shardIndex + 1}/${shardCount})` : "";
      const sinceNote =
        filedOnOrAfter !== undefined ? ` (filed on or after ${filedOnOrAfter})` : "";
      console.log(
        `Would process ${total} unprocessed filings for forms: ${[...formSet].join(", ")}${shardNote}${sinceNote}`
      );
      return { accessionNumber: [], cik: [], form: [], fileName: [], count: 0 };
    }

    if (this.formPos === 0 && this.lastCik === undefined) {
      // Startup banner — one line per process so each shard's terminal shows
      // what it is doing: the forms, its shard, and the shared fetch ceiling
      // (the fetch budget is cluster-wide across all shards, not per-process).
      // The worklist size is deliberately absent: it is no longer computed up
      // front, which is what removes the multi-minute stall before any work.
      const shardNote = sharding ? ` · shard ${shardIndex + 1}/${shardCount}` : "";
      console.log(
        `▶ forms sweep · form(s): ${[...formSet].join(",")}${shardNote} · ` +
          `batches of ≤${batchSize} · ` +
          `fetch ≤${SecFetchMaxPerSec} req/s (shared across shards)`
      );
    }

    // Fill one batch, advancing through forms as each drains. Filings that
    // fall outside this shard or already have a successful run are skipped
    // here, so a batch always arrives at the fan-out full of real work.
    while (accessionNumber.length < batchSize && this.formPos < this.forms.length) {
      const form = this.forms[this.formPos]!;
      const extractorId = formToExtractorId(form)!;

      if (this.successfulKeys === undefined) {
        this.extractorVersion = await resolveVersion(extractorId);
        this.successfulKeys = await runRepo.successfulRunKeys(
          extractorId,
          this.extractorVersion,
          form
        );
      }

      const { rows, full } = await this.readPage(
        filingRepo,
        form,
        this.lastCik,
        this.lastAccession,
        allowCiks
      );
      if (rows.length === 0 && !full) {
        // Form drained — advance and reset its per-form resume state.
        this.formPos++;
        this.lastCik = undefined;
        this.lastAccession = undefined;
        this.successfulKeys = undefined;
        continue;
      }

      // Resume must advance past every row EXAMINED, not every row emitted —
      // rows dropped by the shard or already-processed tests are consumed too
      // and must not be re-read. Rows left unexamined because the batch filled
      // are deliberately not covered, so the next batch re-reads them.
      let lastExamined: Filing | undefined;
      let examinedAll = true;
      for (const f of rows) {
        if (accessionNumber.length >= batchSize) {
          examinedAll = false;
          break;
        }
        lastExamined = f;
        // Shard first: a pure hash over a field already in hand, discarding
        // (shardCount-1)/shardCount of candidates before any other test.
        if (sharding && accessionShard(f.accession_number, shardCount) !== shardIndex) continue;
        if (cikAllowList !== undefined && !cikAllowList.has(f.cik)) continue;
        if (skipEightKWithoutItems(f.form, f.items, eightKItemSet)) continue;
        if (skipFiledBefore(f.filing_date, filedOnOrAfter)) continue;
        if (this.successfulKeys.has(filingRunKey(f))) continue;
        accessionNumber.push(f.accession_number);
        cik.push(f.cik);
        formOut.push(f.form!);
        // "" when the filing names no primary document: the port is a parallel
        // array, so the row has to keep its slot. `ProcessAccessionDocFormTask`
        // reads it as absent and dead-letters that one filing.
        fileName.push(resolvePrimaryDocName(f.primary_doc) ?? "");
      }

      if (lastExamined !== undefined) {
        this.lastCik = lastExamined.cik;
        this.lastAccession = lastExamined.accession_number;
      }
      // A short page means the form has no more rows — but only once this
      // batch actually reached the end of it.
      if (examinedAll && !full) {
        this.formPos++;
        this.lastCik = undefined;
        this.lastAccession = undefined;
        this.successfulKeys = undefined;
      }
    }

    // Setting this on the batch that drains the last form (rather than on a
    // subsequent empty one) lets the loop stop without a wasted iteration —
    // WhileTask evaluates the condition after running the body, so this final
    // partial batch is still fanned out.
    if (this.formPos >= this.forms.length) this.exhausted = true;

    return { accessionNumber, cik, form: formOut, fileName, count: accessionNumber.length };
  }

  /**
   * One page of a form's filings at or after the resume point, in primary-key
   * order.
   *
   * Resume is a plain last-key, not an opaque cursor: the key is two ordinary
   * scalars that can be logged, asserted on in tests, and (unlike a cursor)
   * would survive being persisted across a process restart.
   *
   * `SearchCriteria` allows one condition per column and has no OR, so the
   * exact keyset predicate `(cik, accession) > (lastCik, lastAccession)` is
   * two queries: remaining filings of this CIK after `afterAccession`, then
   * later CIKs, concatenated up to {@link FILING_PAGE_SIZE}. That is what
   * lets a single CIK hold more filings of one form than the page size
   * (424B2 shelf takedowns) without stalling the scan.
   *
   * When `allowCiks` is set, later CIKs are `cik IN (remaining allow-list)`
   * rather than `cik > lastCik`, so a SPAC process sweep never reads a
   * non-SPAC issuer. The JS allow-list check on the caller is then only a
   * belt; the database already scoped the page.
   */
  private async readPage(
    filingRepo: FilingRepositoryStorage,
    form: string,
    fromCik: number | undefined,
    afterAccession: string | undefined,
    allowCiks: readonly number[] | undefined
  ): Promise<{ rows: Filing[]; full: boolean }> {
    const orderBy = [
      { column: "cik" as const, direction: "ASC" as const },
      { column: "accession_number" as const, direction: "ASC" as const },
    ];

    if (allowCiks !== undefined) {
      return this.readAllowlistedPage(
        filingRepo,
        form,
        fromCik,
        afterAccession,
        allowCiks,
        orderBy
      );
    }

    if (fromCik === undefined || afterAccession === undefined) {
      const page = ((await filingRepo.query({ form } as never, {
        orderBy,
        limit: FILING_PAGE_SIZE,
      })) ?? []) as Filing[];
      return { rows: page, full: page.length === FILING_PAGE_SIZE };
    }

    const restOfCik = ((await filingRepo.query(
      {
        form,
        cik: fromCik,
        accession_number: { value: afterAccession, operator: ">" as const },
      } as never,
      {
        orderBy: [{ column: "accession_number", direction: "ASC" }],
        limit: FILING_PAGE_SIZE,
      }
    )) ?? []) as Filing[];

    if (restOfCik.length === FILING_PAGE_SIZE) {
      return { rows: restOfCik, full: true };
    }

    const laterLimit = FILING_PAGE_SIZE - restOfCik.length;
    const laterCiks = ((await filingRepo.query(
      {
        form,
        cik: { value: fromCik, operator: ">" as const },
      } as never,
      {
        orderBy,
        limit: laterLimit,
      }
    )) ?? []) as Filing[];

    return {
      rows: restOfCik.length === 0 ? laterCiks : [...restOfCik, ...laterCiks],
      full: laterCiks.length === laterLimit,
    };
  }

  /**
   * Allow-listed variant of {@link readPage}: every query names the CIK set,
   * chunked so an `in` list stays under SQLite's bind cap.
   */
  private async readAllowlistedPage(
    filingRepo: FilingRepositoryStorage,
    form: string,
    fromCik: number | undefined,
    afterAccession: string | undefined,
    allowCiks: readonly number[],
    orderBy: ReadonlyArray<{ column: "cik" | "accession_number"; direction: "ASC" }>
  ): Promise<{ rows: Filing[]; full: boolean }> {
    const rows: Filing[] = [];

    if (fromCik !== undefined && afterAccession !== undefined && allowCiks.includes(fromCik)) {
      const restOfCik = ((await filingRepo.query(
        {
          form,
          cik: fromCik,
          accession_number: { value: afterAccession, operator: ">" as const },
        } as never,
        {
          orderBy: [{ column: "accession_number", direction: "ASC" }],
          limit: FILING_PAGE_SIZE,
        }
      )) ?? []) as Filing[];
      rows.push(...restOfCik);
      if (rows.length === FILING_PAGE_SIZE) return { rows, full: true };
    }

    const remaining = fromCik === undefined ? allowCiks : allowCiks.filter((cik) => cik > fromCik);

    for (let i = 0; i < remaining.length;) {
      const need = FILING_PAGE_SIZE - rows.length;
      const chunk = remaining.slice(i, i + WORKLIST_CIK_CHUNK);
      const part = ((await filingRepo.query(
        {
          form,
          cik: { value: chunk, operator: "in" as const },
        } as never,
        { orderBy, limit: need }
      )) ?? []) as Filing[];
      rows.push(...part);
      if (part.length === need) return { rows, full: true };
      i += chunk.length;
    }

    return { rows, full: false };
  }
}
