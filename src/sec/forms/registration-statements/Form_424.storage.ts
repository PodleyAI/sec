/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry, type IExecuteContext, type ModelConfig } from "workglow";
import { buildEntityObserver } from "../../../resolver/buildEntityObserver";
import { ExtractionDeadLetterRepo } from "../../../storage/dead-letter/ExtractionDeadLetterRepo";
import type { DeadLetterReasonCode } from "../../../storage/dead-letter/ExtractionDeadLetterSchema";
import { IssuerTickerRepo } from "../../../storage/offering/IssuerTickerRepo";
import { SpacPromoteTermsRepo } from "../../../storage/offering/SpacPromoteTermsRepo";
import { SpacUnitTermsRepo } from "../../../storage/offering/SpacUnitTermsRepo";
import { ObservationProvenanceRepo } from "../../../storage/provenance/ObservationProvenanceRepo";
import { Section16Repo } from "../../../storage/section16/Section16Repo";
import { SpacRepo } from "../../../storage/spac/SpacRepo";
import { SpacReportWriter } from "../../../storage/spac/SpacReportWriter";
import type { SpacStatus } from "../../../storage/spac/SpacSchema";
import { COMPONENT_VERSION_REPOSITORY_TOKEN } from "../../../storage/versioning/ComponentVersionSchema";
import { VersionRegistry } from "../../../storage/versioning/VersionRegistry";
import { getActiveSlot } from "../../../storage/versioning/getActiveSlot";
import { prefetchModel } from "../../../task/model/EnsureModelDownloadedTask";
import { parseEdgarHtml } from "../../html/parseEdgarHtml";
import {
  looksLikePricedIpoProspectusBody,
  parsePricedProspectusCover,
} from "./pricedProspectusCover";
import type { S1SectionName } from "./s1/DocumentSegmenter";
import { DocumentTreeSegmenter } from "./s1/DocumentTreeSegmenter";
import { offeringSectionNames, runOfferingSections } from "./s1/offeringSections";
import type { FormS1Parsed } from "./s1/parseSubmission";
import { getS1Models, resolveModelId } from "./s1/s1Model";
import { makeRunSection } from "./s1/sectionRunner";
import { extractAndStoreXbrl } from "./s1/xbrlEnrichment";

const EXTRACTOR_ID = "424";
// v1.1.0: shares the prompt-injection hardening rolled out on the S-1
// offering sections — UNTRUSTED_FILER_DOCUMENT wrap + verifyRow source_span
// verification on offering-terms / underwriters / use-of-proceeds. Prompt
// shape change ⇒ confidence calibration drifts ⇒ fresh dev cycle.
// v1.2.0: picks up the deepened injection seal from the shared offering
// section extractors — per-call nonce fence, entity-decode + NFKC + zero-
// width strip before defang, and raw-byte cap on stored source_span.
const DEFAULT_EXTRACTOR_VERSION = "1.2.0";

/**
 * The 424 variants that are full priced-IPO prospectuses (Rule 430A pricing
 * after effectiveness) and therefore worth the AI offering-sections pass.
 * 424B3 is included only via {@link isPricedIpoProspectus} when it is the
 * SPAC's IPO prospectus (known SPAC, no ipo_date yet, IPO-shaped body).
 * Shelf takedowns (424B2/B5, 424A) stay deterministic-only.
 */
const PRICED_PROSPECTUS_FORMS = new Set(["424B1", "424B4"]);

/**
 * Statuses past which a `spac` row no longer speaks for the filings its CIK
 * makes. The row is deliberately kept after the combination — the shell keeps
 * its CIK and renames, which is what the three name eras model — and EDGAR
 * keeps coding the surviving operating company 6770 for years afterwards. So
 * neither signal on its own still means "this filing belongs to the vehicle",
 * and a follow-on prospectus from a company that already combined must not be
 * treated as SPAC unit economics.
 */
// Typed `ReadonlySet<string>` for lookup — the stored column is a plain string
// — while the literals are still checked against {@link SpacStatus}, so a typo
// or a renamed status is a compile error.
const TERMINAL_SPAC_STATUSES: ReadonlySet<string> = new Set<SpacStatus>([
  "completed",
  "liquidated",
  "withdrawn",
]);

/**
 * Whether this 424 is a priced IPO prospectus worth the AI offering-sections
 * pass and a `recordIpo` event.
 *
 * B1/B4 are always priced (Rule 430A after effectiveness). B3 is a SPAC IPO
 * prospectus when the vehicle has a spac row (or a 6770 header), has not
 * already recorded `ipo_date`, and the body is the blank-check IPO — later
 * B3s are supplements (Innventure has 65 of them) and S-4/F-4 424B3s are
 * de-SPAC proxy prospectuses, not IPOs.
 */
export function isPricedIpoProspectus(
  form: string,
  args: {
    readonly knownSpac: boolean;
    readonly ipoDate: string | null | undefined;
    readonly headerSic: number | null | undefined;
    readonly html?: string | undefined;
  }
): boolean {
  const f = form.trim().toUpperCase();
  if (PRICED_PROSPECTUS_FORMS.has(f)) return true;
  if (f !== "424B3") return false;
  if (args.ipoDate != null && args.ipoDate !== "") return false;
  if (!(args.knownSpac || args.headerSic === 6770)) return false;
  if (args.html != null && !looksLikePricedIpoProspectusBody(args.html)) return false;
  return true;
}

/**
 * IPO-day trust deposit. Prefer units × trust-per-unit (the same arithmetic
 * as gross proceeds). When the offering table omits a unit count — a live
 * 424B4 extracted `trust_per_unit` and `gross_proceeds` but left
 * `units_offered` null — fall back to the sponsor-promote `trust_total`.
 * When the unit row has a count but no per-unit trust, the promote
 * `trust_per_public_share` is the same $10 deposit (Maywood 2).
 */
export function ipoTrustAmount(args: {
  readonly trust_per_unit: number | null | undefined;
  readonly units_offered: number | null | undefined;
  readonly trust_total: number | null | undefined;
  readonly trust_per_public_share?: number | null | undefined;
}): number | null {
  const perUnit = args.trust_per_unit ?? args.trust_per_public_share ?? null;
  if (perUnit != null && args.units_offered != null) {
    return perUnit * args.units_offered;
  }
  return args.trust_total ?? null;
}

/**
 * IPO gross proceeds. Prefer a stated figure, then units × price (the cover
 * size is usually not inside "The Offering"), then the prospectus-cover
 * headline (`$200,000,000` / `20,000,000 Units`) when the AI row was wiped.
 */
export function ipoProceeds(args: {
  readonly gross_proceeds: number | null | undefined;
  readonly price_per_unit: number | null | undefined;
  readonly units_offered: number | null | undefined;
  readonly cover_proceeds: number | null | undefined;
}): number | null {
  if (args.gross_proceeds != null) return args.gross_proceeds;
  if (args.price_per_unit != null && args.units_offered != null) {
    return args.price_per_unit * args.units_offered;
  }
  return args.cover_proceeds ?? null;
}

export interface ProcessForm424Args {
  readonly cik: number;
  readonly file_number: string;
  readonly accession_number: string;
  readonly filing_date: string;
  readonly primary_doc: string;
  readonly form: string;
  readonly form424: FormS1Parsed;
  readonly model?: ModelConfig;
  readonly context?: IExecuteContext;
}

/**
 * Processes 424 prospectuses. All variants run the deterministic XBRL pass
 * (fee-exhibit / inline facts) and observe the issuer so the filing resolves
 * to the same canonical company as its registration statement. The priced
 * forms (424B1 / 424B4) additionally run the AI offering sections — offering
 * terms, underwriters, use of proceeds — recording the FINAL deal under
 * extractor id `424` (the S-1 rows keep the registered/anticipated terms).
 */
export async function processForm424(args: ProcessForm424Args): Promise<void> {
  const { cik, accession_number, form424, form } = args;

  const versionRegistry = new VersionRegistry(
    globalServiceRegistry.get(COMPONENT_VERSION_REPOSITORY_TOKEN)
  );
  const [extractorSlot, personSlot, companySlot, underwriterFamilySlot] = await Promise.all([
    getActiveSlot(versionRegistry, "extractor", EXTRACTOR_ID),
    getActiveSlot(versionRegistry, "resolver", "person"),
    getActiveSlot(versionRegistry, "resolver", "company"),
    getActiveSlot(versionRegistry, "resolver", "underwriter-family"),
  ]);
  const extractor_version = extractorSlot?.semver ?? DEFAULT_EXTRACTOR_VERSION;
  const activeResolverPersonVersion = personSlot?.semver ?? "1.0.0";
  const activeResolverCompanyVersion = companySlot?.semver ?? "1.0.0";
  const activeUnderwriterFamilyVersion = underwriterFamilySlot?.semver ?? "1.0.0";

  const xbrl = await extractAndStoreXbrl({
    cik,
    accession_number,
    html: form424.html,
    xbrlInstanceXml: form424.xbrlInstanceXml,
    feeExhibitHtml: form424.feeExhibitHtml,
  });

  const observer = buildEntityObserver({
    activeResolverPersonVersion,
    activeResolverCompanyVersion,
  });
  let idx = 0;
  await observer.observeCompany({
    accession_number,
    extractor_id: EXTRACTOR_ID,
    extractor_version,
    observation_index: idx++,
    cik,
    name: xbrl.name,
    jurisdiction: xbrl.jurisdiction,
    address_id: xbrl.address_id,
    international_number: xbrl.international_number,
    source_context: JSON.stringify(
      xbrl.hasIssuerAttributes
        ? { relation: "424:issuer", attributes_source: "xbrl-dei" }
        : { relation: "424:issuer" }
    ),
  });

  const spacRow = await new SpacRepo().getSpac(cik);
  const headerSic = form424.header?.sic ?? null;
  const priced = isPricedIpoProspectus(form, {
    knownSpac: spacRow != null,
    ipoDate: spacRow?.ipo_date ?? null,
    headerSic,
    html: form424.html,
  });
  if (!priced) return;

  const spacEraOver = spacRow != null && TERMINAL_SPAC_STATUSES.has(spacRow.status);
  const isSpac = !spacEraOver && (headerSic === 6770 || spacRow != null);
  const deadLetters = new ExtractionDeadLetterRepo();
  const recordFail = (section: string, reason: DeadLetterReasonCode, detail: string | null) =>
    deadLetters.record({
      extractor_id: EXTRACTOR_ID,
      accession_number,
      section_name: section,
      reason_code: reason,
      detail,
      failed_extractor_version: extractor_version,
      source_run_id: null,
    });

  // The IPO event is deterministic SPAC lifecycle bookkeeping — the priced
  // prospectus IS the IPO — so it must record regardless of whether the AI
  // offering sections completed. Reads spac_unit_terms null-tolerantly:
  // when the AI pass failed to produce a row (model resolution error, parse
  // error, low confidence), ipo_proceeds/trust_amount fall back to null so
  // the row still appears on the SPAC's timeline; a later replay can fill
  // the numeric fields once the version-gated dead letters clear.
  const recordSpacIpoEventIfEligible = async (): Promise<void> => {
    if (!isSpac) return;
    // A vehicle IPOs once. Keying on the ACCESSION rather than on `ipo_date`
    // alone keeps a replay of the SAME filing working — a version bump or a
    // dead-letter retry must still re-record its own event — while a later
    // prospectus from the same CIK cannot reprice the IPO. The `ipo_date`
    // short-circuit keeps the extra read off the common path.
    if (spacRow?.ipo_date) {
      const events = await new SpacRepo().getEvents(cik);
      const priorIpo = events.some(
        (e) => e.event_type === "ipo" && e.accession_number !== accession_number
      );
      if (priorIpo) return;
    }
    const unitTerms = await new SpacUnitTermsRepo().get(EXTRACTOR_ID, accession_number);
    const promoteTerms = await new SpacPromoteTermsRepo().get(EXTRACTOR_ID, accession_number);
    const tickerRows = (await new IssuerTickerRepo().history(cik)).filter(
      (t) => t.accession_number === accession_number
    );
    let tickers = [...new Set(tickerRows.map((t) => t.ticker))];
    if (tickers.length === 0) {
      tickers = await new Section16Repo().tradingSymbolsOnOrBefore(cik, args.filing_date);
    }
    const cover = parsePricedProspectusCover(form424.html);
    const ipo_proceeds = ipoProceeds({
      gross_proceeds: unitTerms?.gross_proceeds,
      price_per_unit: unitTerms?.price_per_unit,
      units_offered: unitTerms?.units_offered,
      cover_proceeds: cover?.gross_proceeds,
    });
    // A priced 424B1/B4 still runs the AI offering pass, but a Rule 419
    // share offering (RedHawk I) is not a SPAC unit IPO: cover parse is
    // null, proceeds stay empty, and the body never says it is an IPO.
    // Skip the event rather than minting an ipo with null proceeds.
    if (ipo_proceeds == null && !looksLikePricedIpoProspectusBody(form424.html)) {
      return;
    }
    await new SpacReportWriter().recordIpo({
      cik,
      accession_number,
      filing_date: args.filing_date,
      form,
      primary_document: null,
      // Derive from the unit economics when the prospectus does not state a
      // gross-proceeds figure inside "The Offering". It usually does not: the
      // number is printed on the prospectus COVER ("$240,000,000 / 24,000,000
      // Units"), which is not part of the section this extractor is handed, so
      // `gross_proceeds` came back null for 9 of 10 SPACs while
      // `units_offered` and `price_per_unit` were both extracted correctly.
      //
      // units × price is the definition of gross proceeds, not an estimate, and
      // `trust_amount` below is already computed exactly this way — that is why
      // trust was right while proceeds was empty. Prefer a stated figure when
      // there is one, since it accounts for anything the arithmetic misses.
      // When the whole unit-terms row is wiped (source_span failed), the cover
      // headline is the same number the arithmetic would have produced.
      ipo_proceeds,
      trust_amount: ipoTrustAmount({
        trust_per_unit: unitTerms?.trust_per_unit,
        units_offered: unitTerms?.units_offered,
        trust_total: promoteTerms?.trust_total,
        trust_per_public_share: promoteTerms?.trust_per_public_share,
      }),
      spac_tickers: tickers.length > 0 ? tickers : null,
    });
  };

  // --- AI offering sections (priced prospectuses only) ---
  // Model resolution can throw when the configured model is not registered;
  // catch and dead-letter the AI sections so the deterministic SPAC IPO event
  // still records, mirroring the "XBRL failures never abort the filing" contract.
  let models: ModelConfig[] = [];
  try {
    models = args.model ? [args.model] : await getS1Models();
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    for (const section of offeringSectionNames(isSpac)) {
      await recordFail(section, "MODEL_RESOLUTION_ERROR", detail);
    }
    await recordSpacIpoEventIfEligible();
    return;
  }
  const model = models[0];
  if (!model) {
    await recordSpacIpoEventIfEligible();
    return;
  }
  const model_id = resolveModelId(model);
  for (const m of models) await prefetchModel(resolveModelId(m), args.context);

  // Mirror the S-1 PARSE_ERROR containment: a converter throw dead-letters the
  // offering sections so the filing stays on the retry worklist.
  let byName: Map<S1SectionName, string>;
  try {
    const doc = parseEdgarHtml(form424.html, `${form} ${accession_number}`);
    const sections = new DocumentTreeSegmenter().segment(doc);
    byName = new Map<S1SectionName, string>(sections.map((s) => [s.name, s.text]));
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    for (const section of offeringSectionNames(isSpac)) {
      await recordFail(section, "PARSE_ERROR", detail);
    }
    await recordSpacIpoEventIfEligible();
    return;
  }

  await runOfferingSections({
    runSection: makeRunSection({
      deadLetters,
      extractor_id: EXTRACTOR_ID,
      extractor_version,
      accession_number,
      signal: args.context?.signal,
    }),
    observer,
    provenance: new ObservationProvenanceRepo(),
    nextIndex: () => idx++,
    accession_number,
    extractor_id: EXTRACTOR_ID,
    extractor_version,
    cik,
    filing_date: args.filing_date,
    isSpac,
    model,
    models,
    model_id,
    activeUnderwriterFamilyVersion,
    byName,
    context: args.context,
  });

  await recordSpacIpoEventIfEligible();
}
