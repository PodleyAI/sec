/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  formExtractorRegistryGeneration,
  registerFormExtractor,
} from "../sec/forms/formExtractors";
import { processForm1A } from "../sec/forms/exempt-offerings/Form_1_A.storage";
import { processForm1K } from "../sec/forms/exempt-offerings/Form_1_K.storage";
import { processForm1U } from "../sec/forms/exempt-offerings/Form_1_U.storage";
import { processForm1Z } from "../sec/forms/exempt-offerings/Form_1_Z.storage";
import { processFormC } from "../sec/forms/exempt-offerings/Form_C.storage";
import { processFormD } from "../sec/forms/exempt-offerings/Form_D.storage";
import { processFormQualif } from "../sec/forms/exempt-offerings/Form_QUALIF.storage";
import { processRegAOfferingEvent } from "../sec/forms/exempt-offerings/RegAOfferingEvent.storage";
import { processForm144 } from "../sec/forms/insider-trading/Form_144.storage";
import { processOwnershipForm } from "../sec/forms/insider-trading/OwnershipDocument.storage";
import { processForm8K } from "../sec/forms/miscellaneous-filings/Form_8_K.storage";
import { processFormCFPORTAL } from "../sec/forms/portal/Form_CFPORTAL.storage";
import { processForm424Structured } from "../sec/forms/registration-statements/Form_424.storage";
import { processFormS1Structured } from "../sec/forms/registration-statements/Form_S_1.storage";
import type { Form1A } from "../sec/forms/exempt-offerings/Form_1_A.schema";
import type { ParsedForm1K } from "../sec/forms/exempt-offerings/Form_1_K";
import type { FormC } from "../sec/forms/exempt-offerings/Form_C.schema";
import type { FormD } from "../sec/forms/exempt-offerings/Form_D.schema";
import type { FormQualif } from "../sec/forms/exempt-offerings/Form_QUALIF.schema";
import type { Form1Z } from "../sec/forms/exempt-offerings/Form_1_Z.schema";
import type { Form144 } from "../sec/forms/insider-trading/Form_144.schema";
import type { OwnershipDocument } from "../sec/forms/insider-trading/OwnershipDocument.schema";
import type { Form8K } from "../sec/forms/miscellaneous-filings/Form_8_K.schema";
import type { FormCfportal } from "../sec/forms/portal/Form_CFPORTAL.schema";
import type { FormS1Parsed } from "../sec/forms/registration-statements/Form_S_1";

/**
 * Which registry generation this function has already registered into, so a
 * second call is a no-op rather than a rebuild. See
 * {@link registerSecFormExtractors}.
 */
let registeredGeneration = -1;

/**
 * Register the extractors sec ships into the form-extractor registry. Called
 * from the CLI bootstrap, from the dispatch task's own module, and from any
 * test that dispatches a filing.
 *
 * Registration reads nothing and touches no dependency injection, so it is
 * safe before the runtime is up — the same property `registerSecTasks` relies
 * on. The `store` closures themselves may resolve DI once invoked, exactly as
 * the `.storage.ts` handlers they call already do.
 *
 * Registering ONCE per registry generation is what makes an override stick.
 * Every call builds fresh closures, so a second one would `set` every key it
 * holds again and silently replace a downstream package's registration under
 * any key it shares — including the natural case of that package registering
 * at its own module scope and then calling `bootstrapSecRuntime()`. Keying the
 * guard to the registry's generation rather than a plain boolean means clearing
 * the registry re-arms it, so a test that starts from an empty registry still
 * gets these.
 *
 * That re-arming cuts the other way around `clearFormExtractorsForTesting()`:
 * this function only refuses to clobber a registration made AFTER it last ran
 * in the current generation, so test setup that registers a downstream
 * override before calling this again loses that override anyway. A test that
 * needs both must clear, call this, THEN register its own extractor on top.
 */
export function registerSecFormExtractors(): void {
  const generation = formExtractorRegistryGeneration();
  if (registeredGeneration === generation) return;

  registerFormExtractor<FormD>({
    id: "D",
    forms: ["D", "D/A"],
    store: async ({ parsed, ...args }) => {
      await processFormD({ ...args, formD: parsed });
    },
  });

  registerFormExtractor<FormC>({
    id: "C",
    forms: [
      "C",
      "C/A",
      "C-W",
      "C-U",
      "C-U-W",
      "C/A-W",
      "C-AR",
      "C-AR-W",
      "C-AR/A",
      "C-AR/A-W",
      "C-TR",
      "C-TR-W",
    ],
    store: async ({ parsed, ...args }) => {
      await processFormC({ ...args, formC: parsed });
    },
  });

  registerFormExtractor<FormCfportal>({
    id: "CFPORTAL",
    forms: ["CFPORTAL", "CFPORTAL/A", "CFPORTAL-W"],
    store: async ({ parsed, ...args }) => {
      await processFormCFPORTAL({ ...args, formCfportal: parsed });
    },
  });

  registerFormExtractor<Form1A>({
    id: "1-A",
    forms: ["1-A", "1-A/A", "1-A POS"],
    store: async ({ parsed, ...args }) => {
      await processForm1A({ ...args, form1A: parsed });
    },
  });

  registerFormExtractor<ParsedForm1K>({
    id: "1-K",
    forms: ["1-K", "1-K/A"],
    needsFullSubmission: true,
    readsFullSubmission: true,
    store: async ({ parsed, form, ...args }) => {
      await processForm1K({ ...args, form, form1K: parsed });
    },
  });

  registerFormExtractor<FormQualif>({
    id: "QUALIF",
    forms: ["QUALIF"],
    store: async ({ cik, accession_number, filing_date, parsed }) => {
      await processFormQualif({ cik, accession_number, filing_date, formQualif: parsed });
    },
  });

  registerFormExtractor<Form1Z>({
    id: "1-Z",
    forms: ["1-Z", "1-Z/A"],
    store: async ({ parsed, ...args }) => {
      await processForm1Z({ ...args, form1Z: parsed });
    },
  });

  // Ownership forms 3/4/5 register as three separate entries, all calling the
  // same handler: each has its own version slot in `component_versions`, and
  // one entry covering all six forms would collapse three slots into one.
  registerFormExtractor<OwnershipDocument>({
    id: "3",
    forms: ["3", "3/A"],
    store: async ({ parsed, ...args }) => {
      await processOwnershipForm({ ...args, doc: parsed });
    },
  });
  registerFormExtractor<OwnershipDocument>({
    id: "4",
    forms: ["4", "4/A"],
    store: async ({ parsed, ...args }) => {
      await processOwnershipForm({ ...args, doc: parsed });
    },
  });
  registerFormExtractor<OwnershipDocument>({
    id: "5",
    forms: ["5", "5/A"],
    store: async ({ parsed, ...args }) => {
      await processOwnershipForm({ ...args, doc: parsed });
    },
  });

  registerFormExtractor<Form144>({
    id: "144",
    forms: ["144", "144/A"],
    store: async ({ parsed, ...args }) => {
      await processForm144({ ...args, doc: parsed });
    },
  });

  // The registration and prospectus families carry two readings apiece. What is
  // registered here is the structured one — the tagged facts, the issuer, the
  // header SIC — under an id of its own. Reading the prospectus PROSE takes a
  // model, and whatever supplies that registers `S-1` / `424` separately;
  // distinct ids give each its own version slot and run ledger, so a change to
  // one never re-selects the corpus for the other.
  //
  // Neither declares `readsFullSubmission`: both read the parse, and the parse
  // already carries the XBRL instance and the fee exhibit the whole `.txt` was
  // fetched for.
  registerFormExtractor<FormS1Parsed>({
    id: "S-1-xbrl",
    forms: ["S-1", "S-1/A", "S-1MEF", "DRS", "DRS/A", "F-1", "F-1/A", "F-1MEF"],
    needsFullSubmission: true,
    store: async ({ parsed, form, ...args }) => {
      await processFormS1Structured({ ...args, form, formS1: parsed });
    },
  });

  registerFormExtractor<FormS1Parsed>({
    id: "424-xbrl",
    forms: ["424A", "424B1", "424B2", "424B3", "424B4", "424B5", "424B7"],
    needsFullSubmission: true,
    store: async ({ parsed, form, ...args }) => {
      await processForm424Structured({ ...args, form, form424: parsed });
    },
  });

  // The 8-K carries two readings, split the way the registration and
  // prospectus families are. This is the STRUCTURED one — the item codes the
  // submissions payload declares, one `form_8k_events` row apiece — under an id
  // of its own. Reading those codes as de-SPAC lifecycle milestones takes the
  // filing's exhibit manifest and its Item 1.01 narrative, and whatever ships
  // that registers `8-K` separately; distinct ids give each its own version
  // slot and run ledger.
  //
  // No `readsFullSubmission`: the item codes arrive in the submissions
  // metadata and in the XML envelope, so this half never opens an exhibit or a
  // narrative, and `extractor_runs.read_full_submission` records `false` for it
  // however the filing was fetched. No `needsFullSubmission` either — every
  // 8-K is fetched whole by form policy (`submissionFetchKind`), so declaring
  // it here would only restate a decision already made for the filing.
  registerFormExtractor<Form8K>({
    id: "8-K-items",
    forms: ["8-K", "8-K/A"],
    store: async (args) => {
      const { cik, accession_number, filing_date, form, items, report_date, parsed, context } =
        args;
      await processForm8K({
        cik,
        accession_number,
        filing_date,
        form,
        items,
        report_date,
        form8K: parsed,
        extractor_id: args.extractor_id,
        extractor_version: args.extractor_version,
        context,
      });
    },
  });

  // The three extractors below declare `needsDocument: false`: everything they
  // record — the `024-` file number, the item codes, the event date — arrives in
  // the submissions payload, so the driver fetches and parses nothing for them
  // and their `store` receives `parsed: undefined`.
  registerFormExtractor<unknown>({
    id: "253G",
    forms: ["253G1", "253G2", "253G3", "253G4"],
    needsDocument: false,
    store: async ({ cik, accession_number, filing_date, file_number, form }) => {
      await processRegAOfferingEvent({
        cik,
        accession_number,
        form,
        filing_date,
        file_number: file_number || null,
      });
    },
  });

  registerFormExtractor<unknown>({
    id: "1-A-W",
    forms: ["1-A-W", "1-A-W/A", "1-Z-W", "1-Z-W/A"],
    needsDocument: false,
    store: async ({ cik, accession_number, filing_date, file_number, form }) => {
      await processRegAOfferingEvent({
        cik,
        accession_number,
        form,
        filing_date,
        file_number: file_number || null,
      });
    },
  });

  registerFormExtractor<unknown>({
    id: "1-U",
    forms: ["1-U", "1-U/A"],
    needsDocument: false,
    store: async ({ cik, accession_number, filing_date, file_number, form, items }) => {
      await processForm1U({
        cik,
        accession_number,
        form,
        filing_date,
        file_number: file_number || null,
        items: items ?? null,
      });
    },
  });

  // Marked done only once every registration above landed. Marking it first
  // would let a throw partway through leave the guard armed over a
  // half-populated registry, and every later call would decline to finish it.
  registeredGeneration = generation;
}
