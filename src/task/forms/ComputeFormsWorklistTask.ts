/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Type } from "typebox";
import { globalServiceRegistry, IExecuteContext, Task } from "workglow";
import { TypeSecCik } from "../../sec/submissions/EnititySubmissionSchema";
import { TypeAccessionNumber } from "../../sec/edgar/accessionNumber";
import { allRegisteredForms, extractorsForForm } from "../../sec/forms/formExtractors";
import { noExtractorReason } from "../../sec/forms/parserOnlyForms";
import { isDryRun } from "../../cli/isDryRun";
import {
  FILING_REPOSITORY_TOKEN,
  type Filing,
  type FilingRepositoryStorage,
} from "../../storage/filing/FilingSchema";
import { COMPONENT_VERSION_REPOSITORY_TOKEN } from "../../storage/versioning/ComponentVersionSchema";
import { ExtractorRunRepo, filingRunKey } from "../../storage/versioning/ExtractorRunRepo";
import { EXTRACTOR_RUN_REPOSITORY_TOKEN } from "../../storage/versioning/ExtractorRunSchema";
import { sortFormsForSweep } from "../../storage/versioning/formsSweepOrder";
import { getActiveSlot } from "../../storage/versioning/getActiveSlot";
import { VersionRegistry } from "../../storage/versioning/VersionRegistry";
import { SecFetchMaxPerSec } from "../../config/Constants";
import { registerSecFormExtractors } from "../../config/registerFormExtractors";
import { resolvePrimaryDocName } from "../../util/accessionDocPath";

/**
 * The worklist's "all forms" default reads the form-extractor registry
 * directly, so it needs the registry populated wherever this task can run —
 * a sweep, a test, a directly constructed instance — none of which are
 * guaranteed to have imported `ProcessAccessionDocFormTask` (whose own module
 * scope does the same registration). Without this, an omitted `form` input
 * silently resolves to an empty list rather than an error.
 *
 * `registerSecFormExtractors` registers once per registry generation, so this
 * neither duplicates the bootstrap's call nor overrides a downstream
 * package's registration under a shared key.
 */
registerSecFormExtractors();

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
   * When set, filings whose `filing_date` is strictly before this YYYY-MM-DD
   * are consumed but not emitted. Used by `sync spacs --only updates` so a
   * daily run is new filings, not the historical leftover on already-touched
   * SPACs. An empty filing_date is kept.
   */
  readonly filedOnOrAfter?: string;
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
 * per-iteration progress.
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
      filedOnOrAfter: Type.Optional(Type.String()),
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

  async execute(
    input: ComputeFormsWorklistTaskInput,
    _context: IExecuteContext
  ): Promise<ComputeFormsWorklistTaskOutput> {
    const filingRepo = globalServiceRegistry.get(FILING_REPOSITORY_TOKEN);
    const runRepo = new ExtractorRunRepo(globalServiceRegistry.get(EXTRACTOR_RUN_REPOSITORY_TOKEN));
    const versionRegistry = new VersionRegistry(
      globalServiceRegistry.get(COMPONENT_VERSION_REPOSITORY_TOKEN)
    );

    // Absent (or empty) `form` means every form with a registered extractor —
    // the deliberate default of a full sweep. The two cannot be told apart
    // here: an omitted optional array port arrives as `[]`, so "nobody asked"
    // and "asked for nothing" are the same value by the time this runs. A
    // request that RESOLVED to nothing is a third thing and never reaches
    // here — `runFormsSweep` refuses it, upstream, where the request itself
    // is still visible.
    const requestedForms =
      input.form !== undefined && input.form.length > 0 ? input.form : allRegisteredForms();
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
    const filedOnOrAfter = input.filedOnOrAfter;
    const cheapTestOpts = { sharding, shardIndex, shardCount, cikAllowList, filedOnOrAfter };
    const dryRun = isDryRun();

    // Four scalars per filing, never an intermediate Filing[]. Paging keeps the
    // query itself bounded ({@link FILING_PAGE_SIZE}); the arrays are the
    // worklist the fan-out maps over, so their length is the known N.
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

    // Every form in the DEFAULT set carries an extractor by construction —
    // `allRegisteredForms()` reads the registry — so a form with none here is
    // one the caller NAMED. That is refused rather than skipped: silently
    // narrowing a request to the part of it this deployment can do is how a
    // sweep reports success over work it never attempted, and the operator who
    // asked for that form is the one person who can act on the answer. A form
    // a sweep merely ENCOUNTERS, reached by accession rather than named, is
    // skipped with a warning instead — see `ProcessAccessionDocFormTask`.
    const unreadable = [...formSet].filter((form) => extractorsForForm(form).length === 0);
    if (unreadable.length > 0) {
      throw new Error(
        `update-forms: ${unreadable.map(noExtractorReason).join("; ")}. ` +
          `Name only forms this deployment can read, or run under the package that ` +
          `supplies the extractor.`
      );
    }

    // The order is the SWEEP order, not the caller's: registration statements
    // mint the `spac` row that the 8-K / proxy / 25-15 handlers are gated on,
    // and each of those records a successful run when the row is missing, so
    // reaching them first drops their events with nothing to re-select them.
    // Applied to an explicit `--form` list too, so a multi-form request is
    // ordered correctly without the operator knowing to do it.
    const forms = sortFormsForSweep([...formSet]);

    let total = 0;
    for (const form of forms) {
      // Paged ONCE per form, not once per extractor. The worklist is a flat
      // parallel-array list of filings carrying no extractor id, and
      // `ProcessAccessionDocFormTask` runs every extractor registered for the
      // form on each entry — so a second pass over the same form would enter
      // each filing twice and pay for the whole dispatch (model calls included)
      // twice. A filing is selected when ANY of the form's extractors has no
      // successful run at its own active version, which is the same union the
      // dispatch then acts on.
      //
      // An extractor with no version slot fails ITS form, not the sweep. The
      // registry is open, so a form can be registered after the `db setup`
      // that seeded slots; losing every other form's work to that is a far
      // worse outcome than losing the one form that cannot be versioned.
      let gates: readonly { readonly extractorId: string; readonly extractorVersion: string }[];
      try {
        gates = await Promise.all(
          extractorsForForm(form).map(async (extractor) => ({
            extractorId: extractor.id,
            extractorVersion: await resolveVersion(extractor.id),
          }))
        );
      } catch (e) {
        console.error(`update-forms: skipping form '${form}': ${(e as Error).message}`);
        continue;
      }
      let from: number | undefined;
      let seen: string | undefined;
      for (;;) {
        const { rows, full } = await this.readPage(filingRepo, form, from, seen, allowCiks);
        if (rows.length === 0) break;

        // One chunked `extractor_runs` lookup per PAGE and extractor, over the
        // rows that pass the cheap in-memory tests. The corpus-wide Set this
        // replaced was built once per form and held for its whole scan; at Form
        // D's size that is hundreds of MB resident before the first filing is
        // fetched, and every `--shard` process paid it in full. See
        // {@link ExtractorRunRepo.successfulRunKeysForFilings}.
        const eligible = rows.filter((f) => this.passesCheapTests(f, cheapTestOpts));
        const successfulKeySets = await Promise.all(
          gates.map((gate) =>
            runRepo.successfulRunKeysForFilings(
              eligible,
              gate.extractorId,
              gate.extractorVersion,
              form
            )
          )
        );
        for (const f of eligible) {
          const key = filingRunKey(f);
          if (successfulKeySets.every((keys) => keys.has(key))) continue;
          total++;
          if (dryRun) continue;
          accessionNumber.push(f.accession_number);
          cik.push(f.cik);
          formOut.push(f.form!);
          // "" when the filing names no primary document: the port is a parallel
          // array, so the row has to keep its slot. `ProcessAccessionDocFormTask`
          // reads it as absent and dead-letters that one filing.
          fileName.push(resolvePrimaryDocName(f.primary_doc) ?? "");
        }
        if (!full) break;
        const last = rows[rows.length - 1]!;
        from = last.cik;
        seen = last.accession_number;
      }
    }

    const shardNote = sharding ? ` · shard ${shardIndex + 1}/${shardCount}` : "";
    const sinceNote = filedOnOrAfter !== undefined ? ` (filed on or after ${filedOnOrAfter})` : "";
    if (dryRun) {
      console.log(
        `Would process ${total} unprocessed filings for forms: ${[...formSet].join(", ")}${shardNote}${sinceNote}`
      );
      return { accessionNumber: [], cik: [], form: [], fileName: [], count: 0 };
    }

    // One line per process so each shard's terminal shows what it is doing:
    // the forms, its shard, the known worklist size, and the shared fetch
    // ceiling (the fetch budget is cluster-wide across all shards).
    console.log(
      `▶ forms sweep · form(s): ${[...formSet].join(",")}${shardNote} · ` +
        `${total} filing${total === 1 ? "" : "s"} · ` +
        `fetch ≤${SecFetchMaxPerSec} req/s (shared across shards)`
    );

    return { accessionNumber, cik, form: formOut, fileName, count: accessionNumber.length };
  }

  /**
   * The tests that need no database round trip — shard, CIK allow-list, filing
   * date. Applied before the `extractor_runs` lookup so the chunked query is
   * asked only about rows this process could actually emit: under `--shard 1/6`
   * that is a sixth of the page.
   *
   * Shard first: a pure hash over a field already in hand, discarding
   * (shardCount-1)/shardCount of candidates before any other test.
   */
  private passesCheapTests(
    f: Filing,
    opts: {
      readonly sharding: boolean;
      readonly shardIndex: number;
      readonly shardCount: number;
      readonly cikAllowList: Set<number> | undefined;
      readonly filedOnOrAfter: string | undefined;
    }
  ): boolean {
    if (opts.sharding && accessionShard(f.accession_number, opts.shardCount) !== opts.shardIndex) {
      return false;
    }
    if (opts.cikAllowList !== undefined && !opts.cikAllowList.has(f.cik)) return false;
    if (skipFiledBefore(f.filing_date, opts.filedOnOrAfter)) return false;
    return true;
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
