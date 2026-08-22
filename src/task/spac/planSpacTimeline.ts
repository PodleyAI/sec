/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry } from "workglow";
import { type Filing, FILING_REPOSITORY_TOKEN } from "../../storage/filing/FilingSchema";
import { SpacRepo } from "../../storage/spac/SpacRepo";
import { COMPONENT_VERSION_REPOSITORY_TOKEN } from "../../storage/versioning/ComponentVersionSchema";
import { ExtractorRunRepo } from "../../storage/versioning/ExtractorRunRepo";
import { EXTRACTOR_RUN_REPOSITORY_TOKEN } from "../../storage/versioning/ExtractorRunSchema";
import { formToExtractorId, isSpacRowGatedExtractor } from "../../storage/versioning/extractorIds";
import { getActiveSlot } from "../../storage/versioning/getActiveSlot";
import { VersionRegistry } from "../../storage/versioning/VersionRegistry";
import { loadGatedNoOpAccessions } from "./gatedNoOpAccessions";
import type { SpacProcessForce } from "./parseSpacProcessForce";
import { shouldReplaySpacFiling } from "./shouldReplaySpacFiling";

/**
 * What a replay of one issuer would do, computed without running anything.
 *
 * The plan is shared rather than owned by {@link ProcessSpacTimelineTask}
 * because two drivers need the same answer and must not disagree about it: the
 * task replays the selection, and the web inspector renders it as a checklist
 * of steps an operator can run one at a time. A second implementation of
 * "which filings are on this timeline, and which of them still need work" is
 * how the two surfaces come to describe different pipelines.
 */
export interface SpacTimelinePlan {
  /** Every filing of the issuer an extractor handles, in filing-date order. */
  readonly timeline: readonly Filing[];
  /** The subset the current force/skip rules would send to the form processor. */
  readonly toProcess: readonly Filing[];
  /** Timeline filings not selected — already succeeded, gated, or below the date floor. */
  readonly skipped: number;
  /** Active extractor version per extractor id the timeline routes to. */
  readonly activeVersions: ReadonlyMap<string, string>;
  /** Whether the issuer already has a `spac` row (what gates the 8-K / proxy / 25-15 tier). */
  readonly hasSpacRow: boolean;
  /** Earliest `filing_date` on the timeline, or "" when the timeline is empty. */
  readonly firstDate: string;
  /** Latest `filing_date` on the timeline, or "" when the timeline is empty. */
  readonly lastDate: string;
}

/**
 * Orders one issuer's processable filings and decides which of them a replay
 * would send to the form processor.
 *
 * Sorting is by `filing_date`, then accession, so same-day filings have a
 * deterministic order — two 8-Ks filed the same day must not race. An UNDATED
 * filing sorts LAST rather than first, so it can never be replayed ahead of the
 * S-1 that creates the SPAC row and have its events silently dropped.
 */
export async function planSpacTimeline(args: {
  readonly cik: number;
  readonly force: SpacProcessForce;
  readonly filedOnOrAfter?: string | undefined;
}): Promise<SpacTimelinePlan> {
  const { cik, force } = args;
  const filingRepo = globalServiceRegistry.get(FILING_REPOSITORY_TOKEN);
  const all = (await filingRepo.query({ cik })) ?? [];

  // Only forms an extractor handles. Anything else has no storage handler and
  // would dead-letter as a wiring error rather than advance the timeline.
  const timeline = all
    .filter((f: Filing) => f.form !== null && formToExtractorId(f.form) !== undefined)
    .sort((a: Filing, b: Filing) => {
      const ad = sortDate(a.filing_date);
      const bd = sortDate(b.filing_date);
      return ad === bd
        ? a.accession_number.localeCompare(b.accession_number)
        : ad.localeCompare(bd);
    });

  if (timeline.length === 0) {
    return {
      timeline,
      toProcess: [],
      skipped: 0,
      activeVersions: new Map(),
      hasSpacRow: false,
      firstDate: "",
      lastDate: "",
    };
  }

  const activeVersions = await loadActiveExtractorVersions(timeline);
  const successfulKeys = await loadSuccessfulKeys(activeVersions);
  const gatedNoOpAccessions = await loadGatedNoOpAccessions(cik, timeline);
  // Gated extractors (8-K, merger-proxy, 25-15) no-op — and warn — when the
  // `spac` row is missing. `sync spacs` worklist *is* high/medium candidates,
  // so that warning fires on every milestone 8-K of a false-positive operating
  // company that will never mint a row. A real SPAC's S-1 is on this timeline;
  // skip the gated filings until it runs, then the caller's repair pass picks
  // them up. `loadGatedNoOpAccessions` is empty while the row is absent, so it
  // cannot be the skip.
  const hasSpacRow = (await new SpacRepo().getSpac(cik)) !== undefined;

  const toProcess = timeline.filter((f) => {
    if (f.form === null) return false;
    if (!filingMeetsDateFloor(f.filing_date, args.filedOnOrAfter)) return false;
    const extractorId = formToExtractorId(f.form);
    // `--force 8-K` / `--force redemption` is an explicit request to run the
    // gated handler anyway; `--force all` still waits so the S-1 can mint.
    if (
      !hasSpacRow &&
      force.kind !== "extractors" &&
      extractorId !== undefined &&
      isSpacRowGatedExtractor(extractorId)
    ) {
      return false;
    }
    return shouldReplaySpacFiling({
      form: f.form,
      items: f.items,
      cik,
      accession_number: f.accession_number,
      force,
      successfulKeys,
      gatedNoOpAccessions,
    });
  });

  return {
    timeline,
    toProcess,
    skipped: timeline.length - toProcess.length,
    activeVersions,
    hasSpacRow,
    firstDate: timeline[0]!.filing_date ?? "",
    lastDate: timeline[timeline.length - 1]!.filing_date ?? "",
  };
}

/**
 * A filing's sort key, with a dateless filing pushed to the END of the timeline.
 *
 * It must never sort first: replaying an 8-K ahead of the S-1 that mints the
 * `spac` row drops every de-SPAC milestone on the floor while each filing still
 * reports success. `filings.filing_date` is NOT NULL, so the shape that actually
 * reaches here is the EMPTY STRING rather than a null — and an empty string
 * compares BEFORE every real date, which is the exact opposite of what is
 * wanted. Both spellings are treated as undated, matching
 * {@link filingMeetsDateFloor}, which already reads `""` that way.
 */
function sortDate(filingDate: string | null | undefined): string {
  return filingDate === null || filingDate === undefined || filingDate === ""
    ? "9999-12-31"
    : filingDate;
}

/**
 * Inclusive `filing_date` floor. An undated filing sorts last on the timeline
 * and is kept: dropping it would hide work that has no date to compare.
 */
export function filingMeetsDateFloor(
  filingDate: string | null | undefined,
  filedOnOrAfter: string | undefined
): boolean {
  if (filedOnOrAfter === undefined) return true;
  if (filingDate === null || filingDate === undefined || filingDate === "") return true;
  return filingDate >= filedOnOrAfter;
}

/**
 * The active version of every extractor the issuer's timeline routes to. One
 * map, read once: it decides both which runs already count as successful and
 * which rows a `--force` reset may clear.
 */
export async function loadActiveExtractorVersions(
  timeline: readonly Filing[]
): Promise<ReadonlyMap<string, string>> {
  const versionRegistry = new VersionRegistry(
    globalServiceRegistry.get(COMPONENT_VERSION_REPOSITORY_TOKEN)
  );
  const extractorIds = new Set<string>();
  for (const f of timeline) {
    if (f.form === null) continue;
    const id = formToExtractorId(f.form);
    if (id !== undefined) extractorIds.add(id);
  }
  const versions = new Map<string, string>();
  for (const id of extractorIds) {
    const slot = await getActiveSlot(versionRegistry, "extractor", id);
    if (slot === undefined) continue;
    versions.set(id, slot.semver);
  }
  return versions;
}

async function loadSuccessfulKeys(
  activeVersionByExtractorId: ReadonlyMap<string, string>
): Promise<ReadonlyMap<string, ReadonlySet<string>>> {
  const runRepo = new ExtractorRunRepo(globalServiceRegistry.get(EXTRACTOR_RUN_REPOSITORY_TOKEN));
  const successfulKeys = new Map<string, ReadonlySet<string>>();
  for (const [id, semver] of activeVersionByExtractorId) {
    successfulKeys.set(id, await runRepo.successfulRunKeys(id, semver));
  }
  return successfulKeys;
}

/**
 * The gated filings a replay should pick up on a SECOND pass, now that the
 * `spac` row may exist.
 *
 * `loadGatedNoOpAccessions` returns the empty set for a CIK with no `spac` row,
 * and the canonical broken state a replay targets is "8-Ks swept before the
 * registration statement was processed" — where the row does not exist when the
 * first plan is computed and the S-1 that mints it runs a moment later, in the
 * same invocation. Every gated filing was therefore filtered out before the row
 * appeared: a CIK with 58 gated 8-Ks reported `skipped: 58` and an empty
 * timeline, and only a second, identical invocation repaired it, with nothing
 * anywhere saying so.
 *
 * Callers apply this ONCE after their replay, never as a fixpoint loop: every
 * gated predicate is monotone (processing a filing writes the event /
 * extraction row / dead-letter entry the predicate keys on), so one pass
 * suffices for the row-minted-mid-run case, while a cap cannot spin if a
 * non-convergent shape is ever reintroduced.
 *
 * Shared by the CLI replay and the web inspector's run driver so both recover
 * the same filings — a driver that skipped this pass would leave the issuer in
 * exactly the state the command exists to repair.
 */
export async function planSpacTimelineRepair(args: {
  readonly cik: number;
  readonly timeline: readonly Filing[];
  readonly processedAccessions: ReadonlySet<string>;
  readonly filedOnOrAfter?: string | undefined;
}): Promise<readonly Filing[]> {
  // `--force all` replayed every timeline filing, so the remainder is empty by
  // construction; the size guard states that rather than special-casing it.
  if (args.processedAccessions.size >= args.timeline.length) return [];
  const gatedAfterReplay = await loadGatedNoOpAccessions(args.cik, args.timeline);
  // Timeline order is preserved by the filter, and the pass stays serial: it
  // replays an early 8-K after a later S-1, which is exactly the ordering the
  // two-invocation workaround already produced.
  return args.timeline.filter(
    (f) =>
      !args.processedAccessions.has(f.accession_number) &&
      gatedAfterReplay.has(f.accession_number) &&
      filingMeetsDateFloor(f.filing_date, args.filedOnOrAfter)
  );
}
