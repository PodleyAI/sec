/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Static, Type } from "typebox";
import {
  FetchUrlTaskOutput,
  globalServiceRegistry,
  IExecuteContext,
  Task,
  TaskError,
  Workflow,
} from "workglow";
import { ALL_FORMS_MAP } from "../../sec/forms/all-forms";
import type { ParsedFormDocument } from "../../sec/forms/parsedFormDocument";
import { processForm1A } from "../../sec/forms/exempt-offerings/Form_1_A.storage";
import { processForm1K } from "../../sec/forms/exempt-offerings/Form_1_K.storage";
import { processForm1Z } from "../../sec/forms/exempt-offerings/Form_1_Z.storage";
import { processFormC } from "../../sec/forms/exempt-offerings/Form_C.storage";
import { processFormD } from "../../sec/forms/exempt-offerings/Form_D.storage";
import { processFormCFPORTAL } from "../../sec/forms/portal/Form_CFPORTAL.storage";
import { processOwnershipForm } from "../../sec/forms/insider-trading/OwnershipDocument.storage";
import { processForm144 } from "../../sec/forms/insider-trading/Form_144.storage";
import { processFormS1 } from "../../sec/forms/registration-statements/Form_S_1.storage";
import { processForm424 } from "../../sec/forms/registration-statements/Form_424.storage";
import { processForm8K } from "../../sec/forms/miscellaneous-filings/Form_8_K.storage";
import { TypeAccessionNumber } from "../../sec/edgar/accessionNumber";
import { processMergerProxy } from "../../sec/forms/proxies-information-statements/Form_DEFM14A.storage";
import { hasRedemptionTriggerItem } from "../../sec/forms/miscellaneous-filings/spac8kRedemptionTriggers";
import { hasLoiTriggerItem } from "../../sec/forms/miscellaneous-filings/spac8kLoiTriggers";
import { TypeSecCik } from "../../sec/submissions/EnititySubmissionSchema";
import { SpacRepo } from "../../storage/spac/SpacRepo";
import { ExtractionDeadLetterRepo } from "../../storage/dead-letter/ExtractionDeadLetterRepo";
import { FILING_REPOSITORY_TOKEN } from "../../storage/filing/FilingSchema";
import { COMPONENT_VERSION_REPOSITORY_TOKEN } from "../../storage/versioning/ComponentVersionSchema";
import { ExtractorRunRepo } from "../../storage/versioning/ExtractorRunRepo";
import { EXTRACTOR_RUN_REPOSITORY_TOKEN } from "../../storage/versioning/ExtractorRunSchema";
import { formToExtractorId } from "../../storage/versioning/extractorIds";
import { getActiveSlot } from "../../storage/versioning/getActiveSlot";
import { VersionRegistry } from "../../storage/versioning/VersionRegistry";
import {
  hasBlockingSectionFailure,
  reapStaleObservations,
} from "../../resolver/reapStaleObservations";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { SEC_RAW_DATA_FOLDER } from "../../config/tokens";
import { assertInsideDir, sanitizePrimaryDoc } from "../../util/accessionDocPath";
import { SecFetchAccessionDocTask } from "./SecFetchAccessionDocTask";

/**
 * Registration prospectus forms whose body is fetched as the full submission
 * .txt — Form.parse() needs the <SEC-HEADER> and sibling <DOCUMENT> blocks
 * (XBRL instance, EX-FILING FEES exhibit), not just the primary document.
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
    fileName: string,
    context: IExecuteContext
  ): Promise<string> {
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

    const wf = context.own(new Workflow(), { title: `Fetch ${accessionNumber} ${fileName}` });
    let text: string | undefined;
    wf.pipe(
      new SecFetchAccessionDocTask({ cik, accessionNumber, fileName }),
      async function capture(fetchOutput: FetchUrlTaskOutput) {
        text = fetchOutput.text ?? undefined;
        return { success: true };
      }
    );
    try {
      await wf.run();
    } finally {
      // The document body — a whole SEC submission, often multi-MB — lands in
      // four places: the `text` local above, the fetch task's output port, the
      // dataflow edge carrying it to `capture`, and (because the edge is an
      // all-ports edge whose value the runner copies onto the consumer) the
      // `capture` task's own input port. Only the local is still needed. The
      // rest are cleared solely by the next run of this graph, which never
      // comes: the workflow is built fresh per filing and run once, so without
      // this the body stays reachable for the whole sweep — once per filing,
      // unbounded.
      //
      // Deliberately not `resetGraph()`: that also flips every node's status
      // back to PENDING, which makes the CLI progress rows flicker.
      for (const dataflow of wf.graph.getDataflows()) {
        dataflow.reset();
      }
      for (const task of wf.graph.getTasks()) {
        task.resetInputData();
        task.runOutputData = {};
        task.error = undefined;
      }
      // `own` is add-only, and a task's subgraph is cleared only between runs
      // of that task — so a caller that processes many filings under one
      // running task accumulates one wrapper per filing. Releasing it detaches
      // this branch regardless of what the caller does, and this task is also
      // driven by callers that never disown (`FetchAndStoreFormsTask`,
      // `sec fetch form`). In the `finally` because a failed fetch — a 404, a
      // network error, an abort — is the common case in an unbounded sweep,
      // and it retains the wrapper just the same.
      context.disown(wf);
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
    // `fileName` originates from a filer-authored field on the EDGAR
    // submissions API; a value like `../../etc/passwd` would otherwise let the
    // cache lookup read anything the process can. Treat an unsafe name as a
    // silent cache miss so the caller falls back to the normal network fetch.
    let safeName: string;
    try {
      safeName = sanitizePrimaryDoc(fileName);
    } catch {
      return undefined;
    }
    const cikDir = path.join(root, "accessiondocs", String(cik).padStart(10, "0"));
    const rel = `accessiondocs/${String(cik).padStart(10, "0")}/${accessionNumber.replaceAll(
      "-",
      ""
    )}-${safeName}`;
    const fullPath = path.join(root, rel);
    assertInsideDir(fullPath, cikDir);
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
      const filing = filings?.[0];
      if (!filing) throw new TaskError("Filing not found");
      cik = filing.cik;
      form = filing.form ?? undefined;
      filing_date = filing.filing_date;
      file_number = filing.file_number;
      items = filing.items;
      report_date = filing.report_date;
      fileName = fileName ?? filing.primary_doc;
    } else {
      // Callers like FetchAndStoreFormsTask pass cik/form/fileName but not the
      // filing-level metadata; without this lookup every storage row gets
      // filing_date "" and file_number "" (which collapses offerings keyed by
      // (cik, file_number) into one row). Best-effort: a missing filing row is
      // tolerated here since the identifiers themselves were supplied.
      const filingRepo = globalServiceRegistry.get(FILING_REPOSITORY_TOKEN);
      const filings = await filingRepo.query({ accession_number: accessionNumber });
      const filing = filings?.[0];
      filing_date = filing?.filing_date;
      file_number = filing?.file_number;
      items = filing?.items;
      report_date = filing?.report_date;
    }

    if (!form) {
      throw new TaskError(`Filing ${accessionNumber} has no form type`);
    }

    // Per-iteration progress label. In the forms sweep each ProcessAccessionDoc
    // run is one iteration of the outer ForEach, so the updateProgress calls
    // below surface on that iteration's CLI row (the framework forwards a task's
    // progress → the iteration subgraph's graph_progress → the iterator's
    // iteration_progress event). Without them the row is just a bare spinner —
    // they identify which filing a worker is on and which stage it reached.
    // First emitted at the fetch stage (below), i.e. only once the filing is
    // actually committed to processing — after extractor/slot resolution.
    const label = `${form} ${accessionNumber}`;

    // Registration prospectus forms (S-1 / DRS family) are fetched as the full
    // submission .txt so Form.parse() can read the <SEC-HEADER> and select the
    // primary <DOCUMENT>. Other forms keep their primary-doc fetch.
    if (REGISTRATION_PROSPECTUS_FORMS.has(form)) {
      fileName = fullSubmissionFileName(accessionNumber);
    }

    // Known-SPAC 8-Ks carrying a redemption- or LOI-trigger item are fetched as
    // the full submission .txt so the narrative passes can read the EX-99
    // exhibits (vote results, LOI press releases), not just the primary
    // document. Other 8-Ks keep their primary-doc fetch.
    //
    // The trigger check runs on the submissions-API `items` metadata alone. That
    // is complete for 8-Ks: real 8-K bodies are HTML/text, never `edgarSubmission`
    // XML (see Form_8_K.parse), so an item code can never appear only in a parsed
    // `formData.items` and be missing from `items` here. The metadata item list
    // is authoritative.
    let spacNarrativeFullSubmission = false;
    if (
      (form === "8-K" || form === "8-K/A") &&
      (hasRedemptionTriggerItem(items) || hasLoiTriggerItem(items)) &&
      cik !== undefined &&
      (await new SpacRepo().getSpac(cik)) !== undefined
    ) {
      fileName = fullSubmissionFileName(accessionNumber);
      spacNarrativeFullSubmission = true;
    }

    const extractorId = formToExtractorId(form);
    if (!extractorId) {
      throw new TaskError(`No extractor registered for form '${form}'`);
    }

    const versionRegistry = new VersionRegistry(
      globalServiceRegistry.get(COMPONENT_VERSION_REPOSITORY_TOKEN)
    );
    const activeSlot = await getActiveSlot(versionRegistry, "extractor", extractorId);
    if (!activeSlot) {
      throw new TaskError(
        `No active slot for extractor '${extractorId}'. Run 'sec db setup' to bootstrap.`
      );
    }
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

    const recordDeadLetterSafe = async (reason_code: string, detail: string): Promise<void> => {
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

    // --- Domain 3: parse (contained) then store (hard error -> record + rethrow) ---
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
    // `{}`; Form_S_1 parses the text) and never hit either guard. Store
    // throws below remain hard errors: they run on parsed data, so a throw
    // there is a code bug that should surface loudly.
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

    // The registry is keyed by form name and holds every form class, so the
    // parse result it hands back is `unknown`. Re-pairing the name with the
    // value recovers the discriminated union each arm below narrows, which is
    // what type-checks the handler arguments.
    const parsedDocument = { form: form!, parsed } as ParsedFormDocument;

    await context.updateProgress(80, `${label} · storing`);
    let parseError: unknown = undefined;
    try {
      const storageArgs = {
        cik: cik!,
        file_number: file_number ?? "",
        accession_number: accessionNumber,
        filing_date: filing_date ?? "",
        primary_doc: fileName,
        // Threaded to the AI form processors so a local model's download renders
        // its progress in this task's CLI UI (via `prefetchModel`). Non-AI
        // processors ignore it (spread bypasses excess-property checks).
        context,
      };

      switch (parsedDocument.form) {
        case "D":
        case "D/A":
          await processFormD({ ...storageArgs, formD: parsedDocument.parsed });
          break;
        case "C":
        case "C/A":
        case "C-W":
        case "C-U":
        case "C-U-W":
        case "C/A-W":
        case "C-AR":
        case "C-AR-W":
        case "C-AR/A":
        case "C-AR/A-W":
        case "C-TR":
        case "C-TR-W":
          await processFormC({ ...storageArgs, formC: parsedDocument.parsed });
          break;
        case "CFPORTAL":
        case "CFPORTAL/A":
        case "CFPORTAL-W":
          await processFormCFPORTAL({ ...storageArgs, formCfportal: parsedDocument.parsed });
          break;
        case "1-A":
        case "1-A/A":
        case "1-A POS":
          await processForm1A({ ...storageArgs, form1A: parsedDocument.parsed });
          break;
        case "1-K":
        case "1-K/A":
          await processForm1K({ ...storageArgs, form1K: parsedDocument.parsed });
          break;
        case "1-Z":
        case "1-Z/A":
          await processForm1Z({ ...storageArgs, form1Z: parsedDocument.parsed });
          break;
        case "3":
        case "3/A":
        case "4":
        case "4/A":
        case "5":
        case "5/A":
          await processOwnershipForm({ ...storageArgs, form: form!, doc: parsedDocument.parsed });
          break;
        case "144":
        case "144/A":
          await processForm144({ ...storageArgs, form: form!, doc: parsedDocument.parsed });
          break;
        case "S-1":
        case "S-1/A":
        case "S-1MEF":
        case "DRS":
        case "DRS/A":
        case "F-1":
        case "F-1/A":
        case "F-1MEF":
          await processFormS1({ ...storageArgs, form: form!, formS1: parsedDocument.parsed });
          break;
        case "424A":
        case "424B1":
        case "424B2":
        case "424B3":
        case "424B4":
        case "424B5":
        case "424B7":
          await processForm424({ ...storageArgs, form: form!, form424: parsedDocument.parsed });
          break;
        case "8-K":
        case "8-K/A":
          await processForm8K({
            ...storageArgs,
            form: form!,
            items,
            report_date,
            form8K: parsedDocument.parsed,
            extractor_id: extractorId,
            extractor_version: extractorVersion,
            fullSubmissionText: spacNarrativeFullSubmission ? text : undefined,
          });
          break;
        case "DEFM14A":
        case "PREM14A":
        case "DEFM14C":
        case "PREM14C":
        case "DEFR14A":
        case "PRER14A":
          await processMergerProxy({
            ...storageArgs,
            form: form!,
            formMergerProxy: parsedDocument.parsed,
          });
          break;
        default:
          throw new TaskError(`Form '${form}' has no storage handler`);
      }
    } catch (err) {
      parseError = err;
    }

    if (parseError === undefined) {
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
      return { success: true };
    }

    const message = parseError instanceof Error ? parseError.message : String(parseError);
    await recordRunFailed(message);
    throw parseError;
  }
}
