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
import { FILING_REPOSITORY_TOKEN, type Filing } from "../../storage/filing/FilingSchema";
import { COMPONENT_VERSION_REPOSITORY_TOKEN } from "../../storage/versioning/ComponentVersionSchema";
import { FORM_TO_EXTRACTOR_ID, formToExtractorId } from "../../storage/versioning/extractorIds";
import { ExtractorRunRepo } from "../../storage/versioning/ExtractorRunRepo";
import { EXTRACTOR_RUN_REPOSITORY_TOKEN } from "../../storage/versioning/ExtractorRunSchema";
import { getActiveSlot } from "../../storage/versioning/getActiveSlot";
import { VersionRegistry } from "../../storage/versioning/VersionRegistry";
import { SecFetchMaxPerSec } from "../../config/Constants";

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
};

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
  static readonly cacheable = false;

  public static inputSchema() {
    return Type.Object({
      form: Type.Optional(Type.Array(Type.String())),
      shardIndex: Type.Optional(Type.Integer({ minimum: 0 })),
      shardCount: Type.Optional(Type.Integer({ minimum: 1 })),
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

    const formsToProcess: Filing[] = [];

    // Cache active-slot lookups per extractor_id. Active slot is "next if a
    // dev version exists, else current" — shared across every form that maps
    // to the same extractor id so we don't re-resolve it per form.
    const slotCache = new Map<string, Awaited<ReturnType<typeof getActiveSlot>>>();
    for (const form of formSet) {
      const extractorId = formToExtractorId(form);
      if (!extractorId) {
        console.warn(`update-forms: form '${form}' has no registered extractor; skipping`);
        continue;
      }
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
      const extractorVersion = active.semver;

      const _filings = (await filingRepo.query({ form })) ?? [];
      const unprocessed = await runRepo.listFilingsWithoutSuccessfulRun(
        _filings,
        extractorId,
        extractorVersion,
        form
      );
      for (const f of unprocessed) {
        if (sharding && accessionShard(f.accession_number, shardCount) !== shardIndex) {
          continue;
        }
        formsToProcess.push(f);
      }
    }

    if (isDryRun()) {
      const forms = [...formSet].join(", ");
      // Display 1-based to match the `--shard i/N` the operator typed.
      const shardNote = sharding ? ` (shard ${shardIndex + 1}/${shardCount})` : "";
      console.log(
        `Would process ${formsToProcess.length} unprocessed filings for forms: ${forms}${shardNote}`
      );
      return { accessionNumber: [], cik: [], form: [], fileName: [], count: 0 };
    }

    // Startup banner — one line per process so each shard's terminal shows
    // exactly what it's doing: the forms, its shard, the worklist size, and the
    // shared fetch ceiling (the fetch budget is cluster-wide across all shards,
    // not per-process).
    const shardNote = sharding ? ` · shard ${shardIndex + 1}/${shardCount}` : "";
    console.log(
      `▶ forms sweep · form(s): ${[...formSet].join(",")}${shardNote} · ` +
        `${formsToProcess.length} filing(s) to process · ` +
        `fetch ≤${SecFetchMaxPerSec} req/s (shared across shards)`
    );

    return {
      accessionNumber: formsToProcess.map((f) => f.accession_number),
      cik: formsToProcess.map((f) => f.cik),
      form: formsToProcess.map((f) => f.form!),
      // Strip the EDGAR inline-XBRL viewer prefix ("xslF345X02/…") so the fetch
      // resolves the raw primary document, mirroring the prior map input mapping.
      fileName: formsToProcess.map((f) => f.primary_doc.replaceAll(/^(xsl[^/]+\/)/g, "")),
      count: formsToProcess.length,
    };
  }
}
