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
import { FORM_TO_EXTRACTOR_ID, formToExtractorId } from "../../storage/versioning/extractorIds";
import { ExtractorRunRepo, filingRunKey } from "../../storage/versioning/ExtractorRunRepo";
import { EXTRACTOR_RUN_REPOSITORY_TOKEN } from "../../storage/versioning/ExtractorRunSchema";
import { getActiveSlot } from "../../storage/versioning/getActiveSlot";
import { VersionRegistry } from "../../storage/versioning/VersionRegistry";
import { SecFetchMaxPerSec } from "../../config/Constants";
import { stripXslPrefix } from "../../util/accessionDocPath";

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
 * process, since each one scans the whole set.
 *
 * Must also stay above the largest single (form, cik) group, currently 4,628,
 * so the last-key resume in {@link ComputeFormsWorklistTask.readPage} can
 * always advance past a group. 10k gives ~2x headroom on that and holds ~5 MB
 * in flight.
 */
const FILING_PAGE_SIZE = 10_000;

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
    if (this.forms === undefined) {
      this.forms = [...formSet].filter((form) => {
        if (formToExtractorId(form)) return true;
        console.warn(`update-forms: form '${form}' has no registered extractor; skipping`);
        return false;
      });
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
          const { rows, full } = await this.readPage(filingRepo, form, from, seen);
          for (const f of rows) {
            if (sharding && accessionShard(f.accession_number, shardCount) !== shardIndex) continue;
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
      console.log(
        `Would process ${total} unprocessed filings for forms: ${[...formSet].join(", ")}${shardNote}`
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
        this.lastAccession
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
        if (this.successfulKeys.has(filingRunKey(f))) continue;
        accessionNumber.push(f.accession_number);
        cik.push(f.cik);
        formOut.push(f.form!);
        fileName.push(stripXslPrefix(f.primary_doc));
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
   * not expressible. Resuming at `cik >= lastCik` and dropping the already-
   * emitted head of that cik in memory is equivalent, and the re-read is
   * bounded by the largest single (form, cik) group — 4,628 rows at the
   * extreme, ~19 typical.
   */
  private async readPage(
    filingRepo: FilingRepositoryStorage,
    form: string,
    fromCik: number | undefined,
    afterAccession: string | undefined
  ): Promise<{ rows: Filing[]; full: boolean }> {
    const criteria =
      fromCik === undefined ? { form } : { form, cik: { value: fromCik, operator: ">=" as const } };
    const page = ((await filingRepo.query(criteria as never, {
      orderBy: [
        { column: "cik", direction: "ASC" },
        { column: "accession_number", direction: "ASC" },
      ],
      limit: FILING_PAGE_SIZE,
    })) ?? []) as Filing[];

    // `full` reports whether the DATABASE returned a full page, which is what
    // says more rows may exist. It must not be derived from the returned row
    // count: the resume head is trimmed below, so a full page routinely yields
    // fewer rows and would otherwise read as "form drained" — silently ending
    // the scan after a couple of pages.
    const full = page.length === FILING_PAGE_SIZE;

    if (fromCik === undefined || afterAccession === undefined) return { rows: page, full };

    const fresh = page.filter((f) => f.cik !== fromCik || f.accession_number > afterAccession);
    // A full page consumed entirely by the resume head would leave the scan
    // unable to advance. FILING_PAGE_SIZE is chosen to exceed the largest
    // (form, cik) group precisely so this cannot happen; fail loudly rather
    // than spin if that assumption ever stops holding.
    if (fresh.length === 0 && full) {
      throw new Error(
        `Forms worklist cannot advance: form '${form}' has more than ${FILING_PAGE_SIZE} filings ` +
          `for cik ${fromCik}. Raise FILING_PAGE_SIZE above that group's size.`
      );
    }
    return { rows: fresh, full };
  }
}
