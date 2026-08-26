/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { globalServiceRegistry } from "workglow";
import { registerFormExtractor } from "../sec/forms/formExtractors";
import { processDeregistration } from "../sec/forms/exchange-listing-withdrawal/processDeregistration";
import { processForm1A } from "../sec/forms/exempt-offerings/Form_1_A.storage";
import { processForm1K } from "../sec/forms/exempt-offerings/Form_1_K.storage";
import { processForm1SA } from "../sec/forms/exempt-offerings/Form_1_SA.storage";
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
import { processMergerProxy } from "../sec/forms/proxies-information-statements/Form_DEFM14A.storage";
import { processForm424 } from "../sec/forms/registration-statements/Form_424.storage";
import { processFormS1 } from "../sec/forms/registration-statements/Form_S_1.storage";
import { processWithdrawal } from "../sec/forms/registration-withdrawal-termination/processWithdrawal";
import { FILING_REPOSITORY_TOKEN } from "../storage/filing/FilingSchema";
import { COMPONENT_VERSION_REPOSITORY_TOKEN } from "../storage/versioning/ComponentVersionSchema";
import { getActiveSlot } from "../storage/versioning/getActiveSlot";
import { VersionRegistry } from "../storage/versioning/VersionRegistry";
import type { Form1A } from "../sec/forms/exempt-offerings/Form_1_A.schema";
import type { ParsedForm1K } from "../sec/forms/exempt-offerings/Form_1_K";
import type { ParsedForm1SA } from "../sec/forms/exempt-offerings/Form_1_SA";
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
 * `items` and `report_date` live on the filing row, not on
 * `FormExtractorStoreArgs` — most extractors never need them, so the shared
 * store args stay minimal and the two that do (8-K, 1-U) resolve them here.
 */
async function filingItemsAndReportDate(
  cik: number,
  accessionNumber: string
): Promise<{ readonly items: string | null; readonly report_date: string | null }> {
  const filingRepo = globalServiceRegistry.get(FILING_REPOSITORY_TOKEN);
  const filings = await filingRepo.query({ accession_number: accessionNumber });
  const filing = filings?.find((f) => f.cik === cik) ?? filings?.[0];
  return { items: filing?.items ?? null, report_date: filing?.report_date ?? null };
}

/**
 * The 424 and merger-proxy processors resolve their own active extractor
 * version internally; the 8-K processor does not, since it stamps every
 * `Form8KEvent` row with a caller-supplied version. This resolves it the same
 * way those two do, for the one id nothing else computes it for.
 */
async function activeExtractorVersion(id: string): Promise<string> {
  const versionRegistry = new VersionRegistry(
    globalServiceRegistry.get(COMPONENT_VERSION_REPOSITORY_TOKEN)
  );
  const slot = await getActiveSlot(versionRegistry, "extractor", id);
  return slot?.semver ?? "1.0.0";
}

/**
 * Register the extractors sec ships into the form-extractor registry. Called
 * from the CLI bootstrap, and from any test that dispatches a filing.
 *
 * Registration reads nothing and touches no dependency injection, so it is
 * safe before the runtime is up — the same property `registerSecTasks` relies
 * on. The `store` closures themselves may resolve DI once invoked, exactly as
 * the `.storage.ts` handlers they call already do.
 */
export function registerSecFormExtractors(): void {
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
    store: async ({ parsed, form, ...args }) => {
      await processForm1K({ ...args, form, form1K: parsed });
    },
  });

  registerFormExtractor<ParsedForm1SA>({
    id: "1-SA",
    forms: ["1-SA", "1-SA/A"],
    store: async ({ cik, accession_number, filing_date, form, parsed }) => {
      await processForm1SA({ cik, accession_number, form, filing_date, form1SA: parsed });
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

  registerFormExtractor<FormS1Parsed>({
    id: "S-1",
    forms: ["S-1", "S-1/A", "S-1MEF", "DRS", "DRS/A", "F-1", "F-1/A", "F-1MEF"],
    needsFullSubmission: true,
    store: async ({ parsed, form, ...args }) => {
      await processFormS1({ ...args, form, formS1: parsed });
    },
  });

  registerFormExtractor<FormS1Parsed>({
    id: "424",
    forms: ["424A", "424B1", "424B2", "424B3", "424B4", "424B5", "424B7"],
    needsFullSubmission: true,
    store: async ({ parsed, form, ...args }) => {
      await processForm424({ ...args, form, form424: parsed });
    },
  });

  registerFormExtractor<Form8K>({
    id: "8-K",
    forms: ["8-K", "8-K/A"],
    // The redemption/LOI narrative pass reads the fetched full-submission body
    // directly; that raw text isn't part of `FormExtractorStoreArgs`, so it
    // stays out of scope here and that pass does not run through this path.
    store: async ({ cik, accession_number, filing_date, form, parsed, context }) => {
      const { items, report_date } = await filingItemsAndReportDate(cik, accession_number);
      const extractor_version = await activeExtractorVersion("8-K");
      await processForm8K({
        cik,
        accession_number,
        filing_date,
        form,
        items,
        report_date,
        form8K: parsed,
        extractor_id: "8-K",
        extractor_version,
        context,
      });
    },
  });

  registerFormExtractor<FormS1Parsed>({
    id: "merger-proxy",
    forms: [
      "DEFM14A",
      "PREM14A",
      "DEFM14C",
      "PREM14C",
      "DEFR14A",
      "PRER14A",
      "DEF 14A",
      "PRE 14A",
      "PRE 14A/A",
      "PRE14A",
      "PREN14A",
      "PREN14A/A",
      "PREM14A/A",
      "PREC14A/A",
      "DEFA14A",
      "DEF 14C",
      "PRE 14C",
      "PREA14C",
    ],
    store: async ({ parsed, form, ...args }) => {
      await processMergerProxy({ ...args, form, formMergerProxy: parsed });
    },
  });

  // The four extractors below are dispatched before the storage switch today
  // (metadata carried in the submissions payload, so no document is fetched),
  // registered here with the same argument shape their existing call site uses.
  registerFormExtractor<unknown>({
    id: "253G",
    forms: ["253G1", "253G2", "253G3", "253G4"],
    store: async ({ cik, accession_number, filing_date, file_number, form }) => {
      await processRegAOfferingEvent({ cik, accession_number, form, filing_date, file_number });
    },
  });

  registerFormExtractor<unknown>({
    id: "1-A-W",
    forms: ["1-A-W", "1-A-W/A", "1-Z-W", "1-Z-W/A"],
    store: async ({ cik, accession_number, filing_date, file_number, form }) => {
      await processRegAOfferingEvent({ cik, accession_number, form, filing_date, file_number });
    },
  });

  registerFormExtractor<unknown>({
    id: "1-U",
    forms: ["1-U", "1-U/A"],
    store: async ({ cik, accession_number, filing_date, file_number, form }) => {
      const { items } = await filingItemsAndReportDate(cik, accession_number);
      await processForm1U({ cik, accession_number, form, filing_date, file_number, items });
    },
  });

  registerFormExtractor<unknown>({
    id: "25-15",
    forms: [
      "25",
      "25/A",
      "25-NSE",
      "25-NSE/A",
      "15-12B",
      "15-12B/A",
      "15-12G",
      "15-12G/A",
      "15-15D",
      "15-15D/A",
      "15F-12B",
      "15F-12B/A",
      "15F-12G",
      "15F-12G/A",
      "15F-15D",
      "15F-15D/A",
      "20-F",
      "20-F/A",
    ],
    store: async ({ cik, accession_number, filing_date, form }) => {
      await processDeregistration({ cik, accession_number, form, filing_date });
    },
  });

  registerFormExtractor<unknown>({
    id: "RW",
    forms: ["RW", "SEC STAFF ACTION"],
    store: async ({ cik, accession_number, filing_date, form }) => {
      await processWithdrawal({ cik, accession_number, form, filing_date });
    },
  });
}
