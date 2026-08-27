/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFile } from "node:fs/promises";
import { Static, Type } from "typebox";
import {
  globalServiceRegistry,
  IExecuteContext,
  Task,
  TaskAbortedError,
  TaskError,
} from "workglow";
import { SecCliConfigurationError } from "../../config/EnvToDI";
import { registerSecFormExtractors } from "../../config/registerFormExtractors";
import { SEC_RAW_DATA_FOLDER } from "../../config/tokens";
import {
  hasBlockingSectionFailure,
  reapStaleObservations,
} from "../../resolver/reapStaleObservations";
import { TypeAccessionNumber } from "../../sec/edgar/accessionNumber";
import { ALL_FORMS_MAP } from "../../sec/forms/all-forms";
import {
  extractorsForForm,
  formNeedsDocument,
  formNeedsFullSubmission,
  type FormExtractor,
} from "../../sec/forms/formExtractors";
import { TypeSecCik } from "../../sec/submissions/EnititySubmissionSchema";
import { ExtractionDeadLetterRepo } from "../../storage/dead-letter/ExtractionDeadLetterRepo";
import type { DeadLetterReasonCode } from "../../storage/dead-letter/ExtractionDeadLetterSchema";
import { FILING_REPOSITORY_TOKEN } from "../../storage/filing/FilingSchema";
import { COMPONENT_VERSION_REPOSITORY_TOKEN } from "../../storage/versioning/ComponentVersionSchema";
import { formToExtractorId } from "../../storage/versioning/extractorIds";
import { ExtractorRunRepo } from "../../storage/versioning/ExtractorRunRepo";
import { EXTRACTOR_RUN_REPOSITORY_TOKEN } from "../../storage/versioning/ExtractorRunSchema";
import { getActiveSlot, type ActiveSlot } from "../../storage/versioning/getActiveSlot";
import { VersionRegistry } from "../../storage/versioning/VersionRegistry";
import { cachedAccessionDocPath, stripXslPrefix } from "../../util/accessionDocPath";
import { SecFetchAccessionDocTask } from "./SecFetchAccessionDocTask";

/**
 * Storing a filing runs whatever the form-extractor registry holds for its
 * form, so the registry has to be populated wherever this task can run — a
 * backfill, a test, or a directly constructed instance never passes through the
 * CLI bootstrap. Doing it here, at import, is what makes that true without every
 * caller having to know.
 *
 * `registerSecFormExtractors` registers once per registry generation, so this
 * neither duplicates the bootstrap's call nor lets a later one rebuild over an
 * extractor a downstream package registered under one of these keys.
 */
registerSecFormExtractors();

/**
 * Registration prospectus forms whose body is fetched as the full submission
 * .txt — Form.parse() needs the <SEC-HEADER> and sibling <DOCUMENT> blocks
 * (XBRL instance, EX-FILING FEES exhibit), not just the primary document.
 *
 * Read by the bulk downloader and the SPAC candidate downloader, which decide
 * which file to put in the fetch cache. This task asks the form's registered
 * extractors instead, so that one filing can escalate on more than a form name.
 */
export const REGISTRATION_PROSPECTUS_FORMS = new Set([
  "S-1",
  "S-1/A",
  "S-1MEF",
  "DRS",
  "DRS/A",
  "F-1",
  "F-1/A",
  "F-1MEF",
  "424A",
  "424B1",
  "424B2",
  "424B3",
  "424B4",
  "424B5",
  "424B7",
]);

/**
 * Reg A annual reports, whose body is fetched as the full submission .txt.
 *
 * The financial statements are not in the document the pipeline would otherwise
 * fetch. A 1-K's primary document is `primary_doc.xml` — an XSD cover page with
 * no financial elements at all, which is why 1-K produced 0 financial rows
 * across all 2,997 filings — and the annual report sits beside it as
 * `<TYPE>PART II`. Reading the full submission gets BOTH out of one request.
 *
 * The 1-SA is deliberately NOT here. Its primary document IS its report — every
 * one of the 2,792 filings records a `.htm` primary doc where every one of the
 * 3,001 1-K filings records a `.xml` — so escalating it would fetch the whole
 * submission to arrive at the document already being fetched, and would
 * invalidate a cache that is already holding exactly the right file. Uniformity
 * between the two forms is not worth re-downloading a corpus for.
 *
 * Read by the bulk downloader, for the same reason as
 * {@link REGISTRATION_PROSPECTUS_FORMS}.
 */
export const REGA_FULL_SUBMISSION_FORMS = new Set(["1-K", "1-K/A"]);

/** Full-submission text filename, e.g. 0001193125-21-066104 -> 0001193125-21-066104.txt */
function fullSubmissionFileName(accessionNumber: string): string {
  return `${accessionNumber}.txt`;
}

const ProcessAccessionDocFormTaskInputSchema = () =>
  Type.Object({
    accessionNumber: TypeAccessionNumber({
      title: "Accession Doc",
      description: "The accession doc to process",
    }),
    cik: Type.Optional(TypeSecCik()),
    fileName: Type.Optional(
      Type.String({
        title: "File Name",
        description: "The name of the document to fetch if not the default",
      })
    ),
    form: Type.Optional(
      Type.String({
        title: "Form",
        description: "The form to process",
      })
    ),
  });

export type ProcessAccessionDocFormTaskInput = Static<
  ReturnType<typeof ProcessAccessionDocFormTaskInputSchema>
>;

const ProcessAccessionDocFormTaskOutputSchema = () =>
  Type.Object({
    success: Type.Boolean({ title: "Successful" }),
  });

type ProcessAccessionDocFormTaskOutput = Static<
  ReturnType<typeof ProcessAccessionDocFormTaskOutputSchema>
>;

/**
 * A form reached the storage dispatch with no extractor registered for it. That
 * is a wiring error — a form added to `FORM_TO_EXTRACTOR_ID` without a matching
 * registration — not a property of the filing, so it escapes the store
 * containment instead of becoming a `STORE_ERROR`. No retry or version bump can
 * fix it, and dead-lettering it would mark every filing of that form as an
 * ordinary extraction failure rather than failing loudly on the first one.
 */
class MissingStorageHandlerError extends TaskError {}

export class ProcessAccessionDocFormTask extends Task<
  ProcessAccessionDocFormTaskInput,
  ProcessAccessionDocFormTaskOutput
> {
  static readonly type = "ProcessAccessionDocFormTask";
  static readonly category = "SEC";
  static readonly title = "Process filing document";
  static readonly cacheable = true;

  public static inputSchema() {
    return ProcessAccessionDocFormTaskInputSchema();
  }

  static outputSchema() {
    return ProcessAccessionDocFormTaskOutputSchema();
  }

  /**
   * Fetches the primary document body. Isolated as a protected seam so the
   * fetch-failure path is unit-testable without the network (tests override it).
   */
  protected async runFetch(
    cik: number,
    accessionNumber: string,
    rawFileName: string,
    context: IExecuteContext
  ): Promise<string> {
    // Normalize ONCE, here, so the cache read below and the network fetch that
    // populates it compose the same path. Ownership forms 3/4/5 arrive as
    // `xslF345X03/wf-form4.xml` on the accession-only path (the caller supplied
    // no filename, so this is the verbatim submissions-API `primary_doc`);
    // callers that do supply a filename already hand over the bare name, so
    // this is a no-op for them. Stripping only one half of the round trip means
    // the write lands where the read never looks — a permanent cache miss —
    // and the viewer URL serves rendered HTML where the parser wants raw XML.
    const fileName = stripXslPrefix(rawFileName);

    // Fast path: serve an already-cached primary document straight from disk,
    // bypassing the rate-limited SEC fetch queue. A cache hit touches no
    // network, so throttling it against EDGAR's 10 req/sec budget is pure
    // waste — and with a sharded fleet sharing ONE cluster limiter, routing
    // every cached filing through it serializes all shards down to ~10/sec
    // total (the whole point of sharding is lost). Only genuine cache MISSES
    // (below) hit the network and must count against the shared budget.
    const cached = await this.readCachedDoc(cik, accessionNumber, fileName);
    if (cached !== undefined && cached.length > 0) {
      return cached;
    }

    const fetchTask = context.own(
      new SecFetchAccessionDocTask(
        { cik, accessionNumber, fileName },
        { title: `Fetch ${accessionNumber} ${fileName}` }
      )
    );
    let text: string | undefined;
    try {
      text = (await fetchTask.run()).text;
    } finally {
      context.disown(fetchTask);
    }
    if (!text) {
      throw new TaskError(`Fetch returned no text for ${cik}/${accessionNumber}/${fileName}`);
    }
    return text;
  }

  /**
   * Reads the primary document from the on-disk fetch cache without touching
   * the rate-limited queue. The path mirrors
   * {@link SecFetchAccessionDocTask.inputToFileName} /
   * {@link SecFetchFileOutputCache} exactly:
   * `<SEC_RAW_DATA_FOLDER>/accessiondocs/<0-padded cik>/<accession w/o dashes>-<fileName>`.
   * Accession primary documents are immutable once filed, so a cached copy is
   * always valid (no freshness check needed). Returns undefined on a miss
   * (ENOENT) so the caller falls back to the network fetch; other read errors
   * propagate.
   */
  private async readCachedDoc(
    cik: number,
    accessionNumber: string,
    fileName: string
  ): Promise<string | undefined> {
    if (!globalServiceRegistry.has(SEC_RAW_DATA_FOLDER)) return undefined;
    const root = globalServiceRegistry.get(SEC_RAW_DATA_FOLDER);
    const fullPath = cachedAccessionDocPath(root, cik, accessionNumber, fileName);
    if (fullPath === undefined) return undefined;
    try {
      return await readFile(fullPath, "utf-8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return undefined;
      throw err;
    }
  }

  async execute(
    input: ProcessAccessionDocFormTaskInput,
    context: IExecuteContext
  ): Promise<ProcessAccessionDocFormTaskOutput> {
    const { accessionNumber } = input;
    if (!accessionNumber) throw new TaskError("Invalid input");
    let cik = input.cik;
    let form = input.form;
    let fileName = input.fileName;
    let filing_date: string | null | undefined;
    let file_number: string | null | undefined;
    let items: string | null | undefined;
    let report_date: string | null | undefined;

    if (!cik || !form || !fileName) {
      const filingRepo = globalServiceRegistry.get(FILING_REPOSITORY_TOKEN);
      const filings = await filingRepo.query({ accession_number: accessionNumber });
      // 25-NSE / Form 25 live under the exchange CIK as well as the issuer;
      // prefer the row matching a caller-supplied CIK so a backfill of the
      // issuer does not no-op on the exchange copy.
      const filing =
        (cik != null ? filings?.find((f) => f.cik === cik) : undefined) ?? filings?.[0];
      if (!filing) throw new TaskError("Filing not found");
      cik = cik ?? filing.cik;
      form = form ?? filing.form ?? undefined;
      filing_date = filing.filing_date;
      file_number = filing.file_number;
      items = filing.items;
      report_date = filing.report_date;
      // `primary_doc` is nullable; a filing that names none leaves `fileName`
      // absent so the PRIMARY_DOC_UNRESOLVED check below records it.
      fileName = fileName ?? filing.primary_doc ?? undefined;
    } else {
      // Callers like FetchAndStoreFormsTask pass cik/form/fileName but not the
      // filing-level metadata; without this lookup every storage row gets
      // filing_date "" and file_number "" (which collapses offerings keyed by
      // (cik, file_number) into one row). Best-effort: a missing filing row is
      // tolerated here since the identifiers themselves were supplied.
      const filingRepo = globalServiceRegistry.get(FILING_REPOSITORY_TOKEN);
      const filings = await filingRepo.query({ accession_number: accessionNumber });
      const filing =
        (cik != null ? filings?.find((f) => f.cik === cik) : undefined) ?? filings?.[0];
      filing_date = filing?.filing_date;
      file_number = filing?.file_number;
      items = filing?.items;
      report_date = filing?.report_date;
    }

    if (!form) {
      throw new TaskError(`Filing ${accessionNumber} has no form type`);
    }

    // Per-iteration identity. `spac process` and the forms sweep reuse ONE
    // instance across filings; `setTitle` is what the CLI re-reads for the row
    // label (updateProgress is the stage, and a nested "Generating" phase
    // overwrites it). Matches the download sweep's `${form} ${accession}`.
    const label = `${form} ${accessionNumber}`;
    this.setTitle(label);

    // Whether the body is the whole submission .txt rather than the primary
    // document is the union of what the form's extractors need, and it decides
    // WHICH FILE the fetch below asks for — so it is settled here, ahead of it.
    // Registration prospectuses (S-1 / DRS family) and Reg A annual reports
    // answer on the form symbol alone: Form.parse() needs the <SEC-HEADER> and
    // the sibling <DOCUMENT> blocks. A known-SPAC 8-K carrying a redemption- or
    // LOI-trigger item answers per filing, because its narrative passes read
    // the EX-99 exhibits (vote results, LOI press releases) and not just the
    // primary document. Every other form keeps its primary-doc fetch.
    //
    // The 8-K trigger check runs on the submissions-API `items` metadata alone.
    // That is complete for 8-Ks: real 8-K bodies are HTML/text, never
    // `edgarSubmission` XML (see Form_8_K.parse), so an item code can never
    // appear only in a parsed `formData.items` and be missing from `items`
    // here. The metadata item list is authoritative.
    const isFullSubmission = await formNeedsFullSubmission({ form, cik, items });
    if (isFullSubmission) {
      fileName = fullSubmissionFileName(accessionNumber);
    }

    // The id the run ledger and the filing-level dead letters are keyed by.
    // `FORM_TO_EXTRACTOR_ID` is the historical answer and still the one that
    // wins for every form sec ships, but it is a closed literal map: a form a
    // downstream package registers through `registerFormExtractor` is selected
    // by the (registry-driven) worklist and would otherwise reach here with no
    // key at all — a throw that escapes the store containment and takes the
    // rest of the sweep with it. Falling back to the registry's own first
    // extractor keys the ledger by something real instead.
    const extractorId = formToExtractorId(form) ?? extractorsForForm(form)[0]?.id;
    if (!extractorId) {
      throw new TaskError(`No extractor registered for form '${form}'`);
    }

    const versionRegistry = new VersionRegistry(
      globalServiceRegistry.get(COMPONENT_VERSION_REPOSITORY_TOKEN)
    );
    // One `component_versions` lookup per extractor id per filing. The
    // filing-level id below and the dispatch's per-extractor resolution ask for
    // the same slot on every single-extractor form — which is every form sec
    // ships — so without this each filing paid the round trip twice.
    const slotCache = new Map<string, ActiveSlot>();
    const activeSlotFor = async (id: string): Promise<ActiveSlot> => {
      let slot = slotCache.get(id);
      if (slot === undefined) {
        slot = await getActiveSlot(versionRegistry, "extractor", id);
        if (!slot) {
          throw new TaskError(
            `No active slot for extractor '${id}'. Run 'sec db setup' to bootstrap.`
          );
        }
        slotCache.set(id, slot);
      }
      return slot;
    };
    const activeSlot = await activeSlotFor(extractorId);
    const extractorVersion = activeSlot.semver;
    const slotAtRun = activeSlot.slot;

    const runRepo = new ExtractorRunRepo(globalServiceRegistry.get(EXTRACTOR_RUN_REPOSITORY_TOKEN));

    // FetchAndStoreFormsTask's `sec fetch form` CLI intentionally bypasses the
    // version gate to allow targeted re-processing of a single filing at the
    // SAME extractor version. Capture whether THIS run is actually at a
    // different version than the filing's most recent prior run so the reap
    // gate below can tell "true version bump" (safe to reap superseded rows)
    // from "same-version re-run" (LLM sampling variance alone must not delete
    // observations that are still legitimately present).
    const priorRun = await runRepo.findLatestRun(cik!, accessionNumber, extractorId);
    const versionChanged =
      priorRun !== undefined && priorRun.extractor_version !== extractorVersion;

    const deadLetters = new ExtractionDeadLetterRepo();

    const recordRunFailed = async (message: string): Promise<void> => {
      try {
        await runRepo.recordRun({
          cik: cik!,
          accession_number: accessionNumber,
          form: form!,
          extractor_id: extractorId,
          extractor_version: extractorVersion,
          slot_at_run: slotAtRun,
          success: false,
          outcome: "failure",
          error: message.slice(0, 4096),
        });
      } catch (recordErr) {
        console.error(
          `Failed to record extractor_runs row for ${cik}/${accessionNumber}@${extractorId}:${extractorVersion}:`,
          recordErr
        );
      }
    };

    const recordDeadLetterSafe = async (
      reason_code: DeadLetterReasonCode,
      detail: string
    ): Promise<void> => {
      try {
        await deadLetters.record({
          extractor_id: extractorId,
          accession_number: accessionNumber,
          section_name: "",
          reason_code,
          detail,
          failed_extractor_version: extractorVersion,
          source_run_id: null,
        });
      } catch (dlErr) {
        console.error(
          `Failed to record dead-letter ${reason_code} for ${accessionNumber}@${extractorId}:`,
          dlErr
        );
      }
    };

    /**
     * What each extractor that completed its store ran as, so the run ledger
     * can be keyed by the extractor that actually did the work and not only by
     * the filing-level id. See {@link recordSecondaryRuns}.
     */
    const storedExtractors = new Map<
      string,
      { readonly extractor_version: string; readonly slot_at_run: ActiveSlot["slot"] }
    >();

    /**
     * The single dispatch point for the filing: every extractor registered for
     * the form, in the order the registry hands them back. Each resolves its
     * OWN version slot — two extractors over one form have independent gates —
     * where the filing-level `extractorId` above is what the run ledger and the
     * filing-level dead letters stay keyed by.
     *
     * `parsed` is undefined and `body` empty for the extractors that work from
     * the submissions metadata alone: nothing was fetched for them to read, and
     * declaring `needsDocument: false` is how they say they will not.
     */
    const storeThroughExtractors = async (parsed: unknown, body: string): Promise<void> => {
      const extractors: readonly FormExtractor[] = extractorsForForm(form!);
      if (extractors.length === 0) {
        throw new MissingStorageHandlerError(`Form '${form}' has no storage handler`);
      }
      for (const extractor of extractors) {
        const slot = await activeSlotFor(extractor.id);
        // An extractor that declared it needs no document is handed none, even
        // when a SIBLING extractor on the same form caused one to be fetched.
        // `FormExtractorMetadataOnly.store` is typed without `parsed` precisely
        // so it cannot read one; handing it the shared parse would make the
        // runtime contract quietly wider than the declared one.
        const wantsDocument = extractor.needsDocument !== false;
        // Most forms register one extractor, so the shared `parsed` computed
        // above (via `ALL_FORMS_MAP`) is already this extractor's answer.
        // An extractor that supplies its own `parse` gets it invoked here on
        // the same fetched `body` instead of reusing the shared value — once
        // a form carries two extractors, each reads the document
        // independently rather than being stuck sharing one parser's output.
        const extractorParsed = !wantsDocument
          ? undefined
          : extractor.parse
            ? await extractor.parse(form!, body)
            : parsed;
        await extractor.store({
          cik: cik!,
          file_number: file_number ?? "",
          accession_number: accessionNumber,
          filing_date: filing_date ?? "",
          primary_doc: fileName ?? "",
          form: form!,
          items,
          report_date,
          extractor_id: extractor.id,
          extractor_version: slot.semver,
          text: wantsDocument ? body : "",
          isFullSubmission,
          // Threaded to the AI form processors so a local model's download
          // renders its progress in this task's CLI UI (via `prefetchModel`).
          // Non-AI processors ignore it.
          context,
          parsed: extractorParsed,
        });
        // Recorded only once the store returned, so a throw leaves the
        // extractor unrecorded and the worklist re-selects the filing for it.
        storedExtractors.set(extractor.id, {
          extractor_version: slot.semver,
          slot_at_run: slot.slot,
        });
      }
    };

    /**
     * Records a SUCCESSFUL `extractor_runs` row for every extractor that ran
     * beyond the filing-level one.
     *
     * `ComputeFormsWorklistTask` selects a filing when ANY extractor registered
     * for its form has no successful run at that extractor's OWN active
     * version. The filing-level `extractorId` row alone therefore never
     * satisfies a form carrying more than one extractor: the second id has no
     * row, the anti-join keeps matching, and every sweep re-dispatches the
     * filing — re-paying the whole dispatch, model calls included, forever.
     * Empty for every form sec ships today, where the only extractor IS the
     * filing-level one.
     *
     * Carries the SAME outcome as the filing-level row: a `partial` run leaves
     * a section dead-lettered somewhere in this filing, and claiming success
     * for a sibling extractor would let the worklist skip work the primary row
     * says is unfinished.
     */
    const recordSecondaryRuns = async (outcome: "success" | "partial"): Promise<void> => {
      for (const [id, run] of storedExtractors) {
        if (id === extractorId) continue;
        try {
          await runRepo.recordRun({
            cik: cik!,
            accession_number: accessionNumber,
            form: form!,
            extractor_id: id,
            extractor_version: run.extractor_version,
            slot_at_run: run.slot_at_run,
            success: outcome === "success",
            outcome,
            error: null,
          });
        } catch (recordErr) {
          console.error(
            `Failed to record extractor_runs row for ${cik}/${accessionNumber}@${id}:${run.extractor_version}:`,
            recordErr
          );
        }
      }
    };

    // A form whose every extractor declares it needs no document is recorded
    // from the submissions metadata alone — there is nothing to fetch or parse,
    // and the body never enters the picture.
    //
    // Two of the reasons are correctness, not economy. A 25-NSE names no
    // `primary_doc` at all, so the missing-primary-doc guard below would fail
    // it — this skip has to come FIRST for it to record. And a 25-NSE is filed
    // under the exchange's CIK as well as the issuer's, so the issuer-CIK fetch
    // this task would build 404s.
    //
    // The rest is cost. A 253G / 1-A-W / 1-U body is 1-2 MB of narrative HTML
    // apiece — some 8 GB across the 5,874 filings — and carries extractable
    // terms in 13-30% of cases, while the `024-` file number linking the event
    // to its offering, the item codes and the event date all arrive in the
    // submissions payload already.
    if (!formNeedsDocument(form)) {
      await context.updateProgress(80, `${label} · storing`);
      try {
        await storeThroughExtractors(undefined, "");
      } catch (err) {
        if (err instanceof TaskAbortedError || context.signal?.aborted) {
          throw err;
        }
        const message = err instanceof Error ? err.message : String(err);
        const detail = `Store failed for form '${form}': ${message}`;
        console.error(`STORE_ERROR ${accessionNumber}@${extractorId}:`, err);
        await recordDeadLetterSafe("STORE_ERROR", detail.slice(0, 1024));
        await recordRunFailed(`STORE_ERROR: ${detail}`);
        return { success: false };
      }
      try {
        await deadLetters.markResolved(extractorId, accessionNumber, "");
      } catch (dlErr) {
        console.error(
          `Failed to resolve filing-level dead-letter for ${accessionNumber}@${extractorId}:`,
          dlErr
        );
      }
      try {
        await runRepo.recordRun({
          cik: cik!,
          accession_number: accessionNumber,
          form: form!,
          extractor_id: extractorId,
          extractor_version: extractorVersion,
          slot_at_run: slotAtRun,
          success: true,
          outcome: "success",
          error: null,
        });
      } catch (recordErr) {
        console.error(
          `Failed to record extractor_runs row for ${cik}/${accessionNumber}@${extractorId}:${extractorVersion}:`,
          recordErr
        );
      }
      await recordSecondaryRuns("success");
      return { success: true };
    }

    // --- Domain 1: primary-document resolution (filing-level) ---
    if (!fileName) {
      const detail = `No primary document for filing ${accessionNumber}`;
      await recordDeadLetterSafe("PRIMARY_DOC_UNRESOLVED", detail);
      await recordRunFailed(`PRIMARY_DOC_UNRESOLVED: ${detail}`);
      return { success: false };
    }

    // --- Domain 2: body fetch (filing-level) ---
    await context.updateProgress(20, `${label} · fetching`);
    let text: string;
    try {
      text = await this.runFetch(cik!, accessionNumber, fileName, context);
    } catch (fetchErr) {
      const message = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
      await recordDeadLetterSafe("FETCH_ERROR", message.slice(0, 1024));
      await recordRunFailed(`FETCH_ERROR: ${message}`);
      return { success: false };
    }

    // --- Domain 3: parse (contained) then store (contained) ---
    // Captured before any observe so the post-run reap can tell rows this run
    // refreshed (created_at >= runStart) from stale orphans of a prior run.
    const runStart = new Date().toISOString();

    const formCls = ALL_FORMS_MAP.get(form!);
    if (!formCls) throw new TaskError(`Form '${form}' not found in ALL_FORMS_MAP`);

    // Parse is its own containment domain, distinct from store: what parse
    // sees is the filing's own bytes, so a throw ("Maximum nested tags
    // exceeded" on a deeply nested legacy HTML table) or an empty result (a
    // structured-XML form whose primary document has no XML root — e.g.
    // ownership forms 3/4/5 filed as narrative HTML/text before the
    // 2003-06-30 XML mandate) is a property of the input, not an extractor
    // bug. Contain both as a filing-level PARSE_ERROR dead-letter
    // (version-gated retry) instead of crashing the whole sweep. Parsers that
    // legitimately handle non-XML bodies return an object (Form_8_K returns
    // `{}`; Form_S_1 parses the text) and never hit either guard.
    await context.updateProgress(60, `${label} · parsing`);
    let parsed: unknown;
    try {
      parsed = await formCls.parse(form!, text);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const detail = `Parse failed for primary doc '${fileName}': ${message}`;
      await recordDeadLetterSafe("PARSE_ERROR", detail.slice(0, 1024));
      await recordRunFailed(`PARSE_ERROR: ${detail}`);
      return { success: false };
    }
    if (parsed == null) {
      const detail = `Parsed document is empty — primary doc '${fileName}' is not the expected XML format for form '${form}'`;
      await recordDeadLetterSafe("PARSE_ERROR", detail);
      await recordRunFailed(`PARSE_ERROR: ${detail}`);
      return { success: false };
    }

    // The extractors registered for the form are the single dispatch boundary,
    // so containment lives here rather than in each `.storage.ts`. A throw is a
    // filing-level STORE_ERROR dead-letter plus a failed run, and the filing is
    // abandoned — never rethrown, because the `forEach` fan-out in
    // `formsSweepLoop` has no per-iteration guard: a rethrow would propagate out
    // of the outer workflow and leave every filing after it unprocessed. The
    // failure is visible to `sec extractor dead-letters` and recoverable by
    // `retry-dead-letters` once the storage code is fixed and the version
    // bumped, which is exactly the treatment fetch and parse already get.
    await context.updateProgress(80, `${label} · storing`);
    let storeError: unknown = undefined;
    try {
      await storeThroughExtractors(parsed, text);
    } catch (err) {
      storeError = err;
    }

    if (storeError === undefined) {
      // A filing that previously failed at the fetch layer (a filing-level
      // dead-letter, section_name "") and now succeeds end to end should have
      // that pending entry cleared, so the version-gated retry sweep doesn't
      // reprocess it after a bump. No-op when no such entry exists; best-effort
      // like recordRun so a storage hiccup can't mask the successful outcome.
      try {
        await deadLetters.markResolved(extractorId, accessionNumber, "");
      } catch (dlErr) {
        console.error(
          `Failed to resolve filing-level dead-letter for ${accessionNumber}@${extractorId}:`,
          dlErr
        );
      }
      // One pending-dead-letter scan drives two independent decisions:
      //
      // 1. Reap superseded observation rows (a smaller or reclassified entity
      //    set leaves stale orphans joined to canonical entities). Best-effort,
      //    like recordRun. BUT a narrative section that yields zero rows this
      //    run — a transient throw (network blip, rate limit, MODEL_INVALID_OUTPUT),
      //    an empty/truncated response (MODEL_EMPTY), all rows below the
      //    confidence floor (LOW_CONFIDENCE_ALL), or all rows unverifiable
      //    (UNVERIFIED_SOURCE_SPAN) — is swallowed into a dead-letter WITHOUT
      //    aborting the filing (see sectionRunner). That section writes no
      //    observations this run, so its prior-run rows look stale
      //    (created_at < runStart) and the reap would delete the last good
      //    extraction for a section that merely failed transiently — silent data
      //    loss. Skip the reap whenever any such blocking section failure was
      //    recorded THIS run; the worst case is a retained superset that the next
      //    clean re-extraction reaps safely. (A genuinely-absent section records
      //    SECTION_NOT_FOUND and a partial success records a `-partial` marker —
      //    neither blocks; see hasBlockingSectionFailure.)
      //
      //    The reap ALSO requires `versionChanged`: a filing re-processed at
      //    the SAME extractor version (the `sec fetch form` CLI path) that
      //    happens to yield fewer entities this time — pure LLM sampling
      //    variance, not a real re-extraction — must not hard-delete the
      //    "unrefreshed" observations, identity links, and address/phone
      //    junctions from the prior run. A genuine version bump (or the
      //    filing's first-ever run, where no orphans can exist) is the only
      //    signal that stale rows are actually superseded.
      //
      // 2. Classify the run outcome: a blocking section failure THIS run means
      //    parse+store succeeded but a section dead-lettered, so
      //    coverage-as-success would be a lie — record `partial` instead. This
      //    is the SAME question as the reap gate, so it reuses
      //    `hasBlockingSectionFailure` rather than a raw "any pending section
      //    entry" scan: a stale entry from a prior version, a genuinely-absent
      //    SECTION_NOT_FOUND section, or an informational `-partial` marker must
      //    NOT mark a clean run partial (which, via the version-gated
      //    `listFilingsWithoutSuccessfulRun` sweep, would reprocess the filing
      //    forever).
      let transientSectionFailure = false;
      let outcome: "success" | "partial" = "success";
      try {
        const pending = await deadLetters.listPending(extractorId);
        transientSectionFailure = hasBlockingSectionFailure(pending, accessionNumber, runStart);
        outcome = transientSectionFailure ? "partial" : "success";
      } catch (dlErr) {
        // If we cannot tell, default to NOT reaping — preserving stale rows is
        // recoverable; deleting still-valid ones is not. Leave outcome as
        // "success": a transient listPending failure must not mark a clean run
        // partial and force endless reprocessing.
        console.error(
          `Failed to check section dead-letters for ${accessionNumber}@${extractorId}:`,
          dlErr
        );
        transientSectionFailure = true;
      }
      if (!transientSectionFailure && versionChanged) {
        try {
          await reapStaleObservations({
            accession_number: accessionNumber,
            extractor_id: extractorId,
            before: runStart,
          });
        } catch (reapErr) {
          console.error(
            `Failed to reap stale observations for ${accessionNumber}@${extractorId}:`,
            reapErr
          );
        }
      }
      try {
        await runRepo.recordRun({
          cik: cik!,
          accession_number: accessionNumber,
          form: form!,
          extractor_id: extractorId,
          extractor_version: extractorVersion,
          slot_at_run: slotAtRun,
          success: outcome === "success",
          outcome,
          error: null,
        });
      } catch (recordErr) {
        console.error(
          `Failed to record extractor_runs row for ${cik}/${accessionNumber}@${extractorId}:${extractorVersion}:`,
          recordErr
        );
      }
      await recordSecondaryRuns(outcome);
      return { success: true };
    }

    // Cooperative cancellation is not a filing failure. Ctrl-C aborts every
    // in-flight filing at once, and swallowing that would both keep the sweep
    // grinding and stamp a version-gated STORE_ERROR on filings that were
    // merely interrupted.
    if (storeError instanceof TaskAbortedError || context.signal?.aborted) {
      throw storeError;
    }

    // A form with no registered extractor is a code defect, not bad input:
    // containing it would dead-letter every filing of that form on every sweep,
    // forever, wearing the same reason code as a genuine storage failure.
    if (storeError instanceof MissingStorageHandlerError) {
      throw storeError;
    }

    // A misconfigured environment is not this filing's fault either. The
    // per-section handler already re-throws these rather than dead-lettering;
    // without the matching escape here that re-throw would merely convert a
    // per-section MODEL_INVALID_OUTPUT storm into a filing-level STORE_ERROR
    // storm, equally version-gated and equally wrong.
    if (storeError instanceof SecCliConfigurationError) {
      throw storeError;
    }

    const message = storeError instanceof Error ? storeError.message : String(storeError);
    const detail = `Store failed for form '${form}': ${message}`;
    console.error(`STORE_ERROR ${accessionNumber}@${extractorId}:`, storeError);
    await recordDeadLetterSafe("STORE_ERROR", detail.slice(0, 1024));
    await recordRunFailed(`STORE_ERROR: ${detail}`);
    return { success: false };
  }
}
