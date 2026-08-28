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
  type TaskTypeName,
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
  extractorReadsFullSubmission,
  extractorsForForm,
  formNeedsDocument,
  formNeedsFullSubmission,
  type FormExtractor,
} from "../../sec/forms/formExtractors";
import { warnFormHasNoExtractor } from "../../sec/forms/parserOnlyForms";
import { TypeSecCik } from "../../sec/submissions/EnititySubmissionSchema";
import { ExtractionDeadLetterRepo } from "../../storage/dead-letter/ExtractionDeadLetterRepo";
import type { DeadLetterReasonCode } from "../../storage/dead-letter/ExtractionDeadLetterSchema";
import { FILING_REPOSITORY_TOKEN } from "../../storage/filing/FilingSchema";
import { COMPONENT_VERSION_REPOSITORY_TOKEN } from "../../storage/versioning/ComponentVersionSchema";
import { ExtractorRunRepo } from "../../storage/versioning/ExtractorRunRepo";
import { EXTRACTOR_RUN_REPOSITORY_TOKEN } from "../../storage/versioning/ExtractorRunSchema";
import { getActiveSlot, type ActiveSlot } from "../../storage/versioning/getActiveSlot";
import { VersionRegistry } from "../../storage/versioning/VersionRegistry";
import { cachedAccessionDocPath, stripXslPrefix } from "../../util/accessionDocPath";
import { SecFetchAccessionDocTask } from "./SecFetchAccessionDocTask";
import { fullSubmissionFileName, submissionFetchKind } from "./submissionFetchPolicy";

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
 * Re-exported from {@link submissionFetchKind}'s module, which owns them now.
 *
 * They moved because the fetch policy has to be one definition and this module
 * cannot host it: `spacCandidateDownload` imports these sets from here, so the
 * policy importing back would be a cycle. Re-exporting keeps every existing
 * importer working.
 */
export { REGA_FULL_SUBMISSION_FORMS, REGISTRATION_PROSPECTUS_FORMS } from "./submissionFetchPolicy";

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
 * The form's extractors disappeared between the pre-dispatch check and the
 * store — the registry is process-global and can be rebuilt in between.
 *
 * A form that had none to begin with never gets here: it is skipped whole,
 * with a warning, before anything is fetched, because a package that parses a
 * form and leaves the reading of it to a consumer is a legitimate deployment
 * and not a defect. This is the narrow residue — the filing was already
 * committed to when its handlers went away — and it stays a throw so the
 * dedicated type can carry it out through the store containment untouched.
 */
class MissingStorageHandlerError extends TaskError {}

/**
 * One extractor of a filing's form, with the version slot its run is recorded
 * under. The unit everything this filing writes down is keyed by: a filing has
 * as many of these as its form has extractors, and never one canonical id.
 */
interface LedgerTarget {
  readonly id: string;
  readonly extractor_version: string;
  readonly slot_at_run: ActiveSlot["slot"];
}

export class ProcessAccessionDocFormTask extends Task<
  ProcessAccessionDocFormTaskInput,
  ProcessAccessionDocFormTaskOutput
> {
  // Annotated rather than inferred as its own literal: the sweep tests subclass
  // this to expose a protected step, and a literal type on the base's static
  // makes every subclass's own `type` a static-side mismatch.
  static readonly type: TaskTypeName = "ProcessAccessionDocFormTask";
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

    // WHICH FILE to fetch. A form-level policy shared with `sec spac download`
    // and the bootstrap paths, so what is cached for a filing stops depending
    // on which path fetched it — unioned with what the form's registered
    // extractors declare, so an extractor can require the whole submission for
    // a form the policy does not already escalate. Settled here because it
    // decides which file the fetch below asks for.
    const isFullSubmission =
      submissionFetchKind(form) === "full-submission" ||
      (await formNeedsFullSubmission({ form, cik, items }));
    if (isFullSubmission) {
      fileName = fullSubmissionFileName(accessionNumber);
    }

    // WHAT THE EXTRACTOR SEES is a separate question, answered per extractor by
    // its own `readsFullSubmission` declaration where `store` is called below.
    // Fetching an 8-K whole is unconditional; handing its EX-99 exhibits to the
    // narrative passes stays gated on a known SPAC with a redemption- or
    // LOI-trigger item, because widening a model's input is an evaluable
    // behavior change with its own golden truth and does not belong in a change
    // about which bytes land on disk.
    //
    // The two used to be one flag, which is what made "fetch more" and "feed
    // the model more" impossible to do separately.

    // WHICH EXTRACTORS run, and the ids everything this filing writes down is
    // keyed by. There is no single one: a form carries a SET of extractors, and
    // an id that gets WRITTEN DOWN — an `extractor_runs` row, a dead letter, an
    // observation reap — has to be the id of the extractor that did or failed
    // the work. Re-deriving one from the form symbol answers a different
    // question, and answers it arbitrarily the moment a form carries two.
    const registeredExtractors = extractorsForForm(form);
    if (registeredExtractors.length === 0) {
      // Nothing in this deployment reads this form, which is a legitimate state
      // — a parser here whose reading a consumer package supplies — and not a
      // defect. So the filing is skipped whole: nothing is fetched, parsed,
      // dispatched, recorded or dead-lettered, and the sweep around it carries
      // on. The warning is what keeps the skip honest, and it prints once per
      // form per run rather than once per filing.
      //
      // Reached only by a caller that arrived with a filing rather than with a
      // form — `spac process`, a dead-letter retry, `sec fetch doc`. A form
      // NAMED on a sweep is refused up front instead, in
      // `ComputeFormsWorklistTask`, where the request is still visible.
      warnFormHasNoExtractor(form);
      return { success: true };
    }
    // Deduped: an extractor split into sections holds several registry keys
    // under ONE id, and the run ledger and the version slots key on the id.
    const extractorIds = [...new Set(registeredExtractors.map((e) => e.id))];

    const versionRegistry = new VersionRegistry(
      globalServiceRegistry.get(COMPONENT_VERSION_REPOSITORY_TOKEN)
    );
    // One `component_versions` lookup per extractor id per filing. The ledger
    // resolution below and the dispatch's own per-extractor resolution ask for
    // the same slots, so without this each filing paid every round trip twice.
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
    // Resolved for EVERY extractor up front. An unseeded version slot is a
    // wiring error, not a property of this filing, so it fails loudly here
    // rather than inside the store containment, where it would wear the same
    // reason code as a genuine extraction failure on every filing of the form.
    const ledgerTargets: LedgerTarget[] = [];
    for (const id of extractorIds) {
      const slot = await activeSlotFor(id);
      ledgerTargets.push({ id, extractor_version: slot.semver, slot_at_run: slot.slot });
    }

    const runRepo = new ExtractorRunRepo(globalServiceRegistry.get(EXTRACTOR_RUN_REPOSITORY_TOKEN));

    // FetchAndStoreFormsTask's `sec fetch form` CLI intentionally bypasses the
    // version gate to allow targeted re-processing of a single filing at the
    // SAME extractor version. Capture whether THIS run is actually at a
    // different version than the filing's most recent prior run so the reap
    // gate below can tell "true version bump" (safe to reap superseded rows)
    // from "same-version re-run" (LLM sampling variance alone must not delete
    // observations that are still legitimately present). Per extractor: two
    // extractors over one form hold independent version slots, so one of them
    // being bumped says nothing about the other's rows.
    const versionChanged = new Map<string, boolean>();
    for (const target of ledgerTargets) {
      const priorRun = await runRepo.findLatestRun(cik!, accessionNumber, target.id);
      versionChanged.set(
        target.id,
        priorRun !== undefined && priorRun.extractor_version !== target.extractor_version
      );
    }

    const deadLetters = new ExtractionDeadLetterRepo();

    /**
     * How many registry entries each extractor id holds for this form. An
     * extractor split into sections registers several entries under ONE id, and
     * the run ledger keys on the id — so that id has run this filing only once
     * every one of its entries has stored, not after the first.
     */
    const entriesPerId = new Map<string, number>();
    for (const ext of registeredExtractors) {
      entriesPerId.set(ext.id, (entriesPerId.get(ext.id) ?? 0) + 1);
    }

    /**
     * How many of each id's entries have completed their store, so the run
     * ledger is keyed by the extractor that actually did the work. Declared
     * before the failure recorders because it is what tells them which
     * extractors a filing-level failure is actually the failure OF.
     */
    const storedEntries = new Map<string, number>();

    /** Whether every registry entry under this id has stored. */
    const idFinished = (id: string): boolean =>
      (storedEntries.get(id) ?? 0) >= (entriesPerId.get(id) ?? 0);

    /**
     * The extractors a filing-level failure is recorded against: every one that
     * has not finished storing.
     *
     * Before the dispatch — an unresolved primary document, a fetch error, a
     * parse error — that is all of them, and each genuinely failed. Mid-dispatch
     * it is the extractor that threw plus those still queued behind it: the
     * siblings that already returned did not fail, and stamping them with a
     * version-gated failure would dead-letter work that succeeded.
     */
    const unfinishedTargets = (): readonly LedgerTarget[] =>
      ledgerTargets.filter((t) => !idFinished(t.id));

    const recordRunFailed = async (message: string): Promise<void> => {
      for (const target of unfinishedTargets()) {
        try {
          await runRepo.recordRun({
            cik: cik!,
            accession_number: accessionNumber,
            form: form!,
            extractor_id: target.id,
            extractor_version: target.extractor_version,
            slot_at_run: target.slot_at_run,
            success: false,
            outcome: "failure",
            error: message.slice(0, 4096),
          });
        } catch (recordErr) {
          console.error(
            `Failed to record extractor_runs row for ${cik}/${accessionNumber}@${target.id}:${target.extractor_version}:`,
            recordErr
          );
        }
      }
    };

    const recordDeadLetterSafe = async (
      reason_code: DeadLetterReasonCode,
      detail: string
    ): Promise<void> => {
      for (const target of unfinishedTargets()) {
        try {
          await deadLetters.record({
            extractor_id: target.id,
            accession_number: accessionNumber,
            section_name: "",
            reason_code,
            detail,
            failed_extractor_version: target.extractor_version,
            source_run_id: null,
          });
        } catch (dlErr) {
          console.error(
            `Failed to record dead-letter ${reason_code} for ${accessionNumber}@${target.id}:`,
            dlErr
          );
        }
      }
    };

    /** The ids a filing-level failure message names, for the console trace. */
    const unfinishedLabel = (): string =>
      unfinishedTargets()
        .map((t) => t.id)
        .join(",");

    /**
     * Clears the filing-level dead-letter entry (section_name "") for every
     * extractor of the form. A filing that previously failed at the fetch layer
     * left one per extractor, and each is keyed by its own id.
     */
    const markFilingLevelResolved = async (): Promise<void> => {
      for (const id of extractorIds) {
        try {
          await deadLetters.markResolved(id, accessionNumber, "");
        } catch (dlErr) {
          console.error(
            `Failed to resolve filing-level dead-letter for ${accessionNumber}@${id}:`,
            dlErr
          );
        }
      }
    };

    /**
     * Records a run row for every extractor that completed its store, each
     * under its OWN id and version slot.
     *
     * `ComputeFormsWorklistTask` selects a filing when ANY extractor registered
     * for its form has no successful run at that extractor's OWN active
     * version, so an extractor with no row of its own keeps the anti-join
     * matching and every sweep re-dispatches the filing — re-paying the whole
     * dispatch, model calls included, forever.
     *
     * Every row carries the SAME outcome, because the outcome is read from a
     * scan of the filing's pending dead letters as a whole: a `partial` run
     * leaves a section dead-lettered somewhere in this filing, and claiming
     * success for a sibling extractor would let the worklist skip work that
     * scan says is unfinished.
     */
    const recordRunsStored = async (outcome: "success" | "partial"): Promise<void> => {
      for (const target of ledgerTargets) {
        if (!idFinished(target.id)) continue;
        try {
          await runRepo.recordRun({
            cik: cik!,
            accession_number: accessionNumber,
            form: form!,
            extractor_id: target.id,
            extractor_version: target.extractor_version,
            slot_at_run: target.slot_at_run,
            success: outcome === "success",
            outcome,
            error: null,
          });
        } catch (recordErr) {
          console.error(
            `Failed to record extractor_runs row for ${cik}/${accessionNumber}@${target.id}:${target.extractor_version}:`,
            recordErr
          );
        }
      }
    };

    /**
     * The single dispatch point for the filing: every extractor registered for
     * the form, in the order the registry hands them back. Each resolves its
     * OWN version slot — two extractors over one form have independent gates —
     * and each is recorded in {@link storedEntries} under its own id, which
     * is what the run ledger and the dead letters are then keyed by.
     *
     * `parsed` is undefined and `body` empty for the extractors that work from
     * the submissions metadata alone: nothing was fetched for them to read, and
     * declaring `needsDocument: false` is how they say they will not. It is
     * undefined too when every extractor of the form brings its own `parse`:
     * nothing here would read the shared one, so the caller never ran it.
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
        // Which file was fetched is one decision for the filing; what THIS
        // extractor is handed to read is its own, and is asked per extractor.
        // A sibling escalating the fetch buys this one a wider cached file,
        // never a wider input — an extractor sees the whole submission only
        // where it declared that it reads one, and only where that whole
        // submission is what was actually fetched.
        const readsFullSubmission =
          wantsDocument &&
          isFullSubmission &&
          (await extractorReadsFullSubmission(extractor, { form: form!, cik, items }));
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
          fullSubmissionText: readsFullSubmission ? body : undefined,
          // Threaded to the AI form processors so a local model's download
          // renders its progress in this task's CLI UI (via `prefetchModel`).
          // Non-AI processors ignore it.
          context,
          parsed: extractorParsed,
        });
        // Counted only once the store returned, so a throw leaves the extractor
        // unrecorded and the worklist re-selects the filing for it.
        storedEntries.set(extractor.id, (storedEntries.get(extractor.id) ?? 0) + 1);
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
        console.error(`STORE_ERROR ${accessionNumber}@${unfinishedLabel()}:`, err);
        await recordDeadLetterSafe("STORE_ERROR", detail.slice(0, 1024));
        await recordRunFailed(`STORE_ERROR: ${detail}`);
        return { success: false };
      }
      await markFilingLevelResolved();
      await recordRunsStored("success");
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

    // Whether the form's SHARED parse — the registered `ALL_FORMS_MAP` class —
    // is read by anything. `storeThroughExtractors` hands it to an extractor
    // only where that extractor both wants the document and brings no `parse`
    // of its own, so this asks that dispatch's question extractor by extractor
    // and the two have to keep agreeing.
    //
    // A form whose every extractor parses the fetched body itself therefore
    // needs no parser class here: running one would be work nothing reads, and
    // its failure would dead-letter a filing that every actual reader of the
    // document parsed fine.
    const sharedParseIsRead = extractorsForForm(form!).some(
      (extractor) => extractor.needsDocument !== false && !extractor.parse
    );

    let parsed: unknown;
    if (sharedParseIsRead) {
      const formCls = ALL_FORMS_MAP.get(form!);
      // A form with no parser class is contained exactly like a parse that
      // throws, and for the same reason: the `forEach` fan-out in
      // `formsSweepLoop` has no per-iteration guard, so throwing out of here
      // abandons every filing queued behind this one — the failure the rest of
      // this domain is contained to prevent. Failing THIS filing as a
      // version-gated PARSE_ERROR keeps the sweep going and stays recoverable
      // once a parser class, or an extractor carrying its own `parse`, is
      // registered for the form.
      if (!formCls) {
        const detail = `No parser class registered for form '${form}', and an extractor of this form reads the shared parse`;
        await recordDeadLetterSafe("PARSE_ERROR", detail.slice(0, 1024));
        await recordRunFailed(`PARSE_ERROR: ${detail}`);
        return { success: false };
      }

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
      await markFilingLevelResolved();
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
        // Scanned across every extractor of the form: a section dead letter is
        // keyed by the extractor that recorded it, so asking one id's list
        // would miss a sibling's failure on this same filing.
        const pending = (
          await Promise.all(extractorIds.map((id) => deadLetters.listPending(id)))
        ).flat();
        transientSectionFailure = hasBlockingSectionFailure(pending, accessionNumber, runStart);
        outcome = transientSectionFailure ? "partial" : "success";
      } catch (dlErr) {
        // If we cannot tell, default to NOT reaping — preserving stale rows is
        // recoverable; deleting still-valid ones is not. Leave outcome as
        // "success": a transient listPending failure must not mark a clean run
        // partial and force endless reprocessing.
        console.error(
          `Failed to check section dead-letters for ${accessionNumber}@${extractorIds.join(",")}:`,
          dlErr
        );
        transientSectionFailure = true;
      }
      if (!transientSectionFailure) {
        // Per extractor, and only where THAT extractor's version moved. The
        // reap deletes by `extractor_id`, so one extractor's bump is no licence
        // to hard-delete a sibling's rows at an unchanged version.
        for (const id of extractorIds) {
          if (versionChanged.get(id) !== true) continue;
          try {
            await reapStaleObservations({
              accession_number: accessionNumber,
              extractor_id: id,
              before: runStart,
            });
          } catch (reapErr) {
            console.error(
              `Failed to reap stale observations for ${accessionNumber}@${id}:`,
              reapErr
            );
          }
        }
      }
      await recordRunsStored(outcome);
      return { success: true };
    }

    // Cooperative cancellation is not a filing failure. Ctrl-C aborts every
    // in-flight filing at once, and swallowing that would both keep the sweep
    // grinding and stamp a version-gated STORE_ERROR on filings that were
    // merely interrupted.
    if (storeError instanceof TaskAbortedError || context.signal?.aborted) {
      throw storeError;
    }

    // The form's extractors went away mid-filing. Not bad input, and nothing a
    // retry or a version bump acts on, so it is neither contained nor
    // dead-lettered: an entry for it would wear the same reason code as a
    // genuine storage failure and be re-stamped on every filing of that form,
    // on every sweep, forever. A form that had no extractor to begin with never
    // reaches here — it was skipped, with a warning, before the fetch.
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
    console.error(`STORE_ERROR ${accessionNumber}@${unfinishedLabel()}:`, storeError);
    await recordDeadLetterSafe("STORE_ERROR", detail.slice(0, 1024));
    await recordRunFailed(`STORE_ERROR: ${detail}`);
    return { success: false };
  }
}
