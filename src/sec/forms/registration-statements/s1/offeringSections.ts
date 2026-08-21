/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IExecuteContext, ModelConfig } from "workglow";
import type { EntityObserver } from "../../../../resolver/EntityObserver";
import { UnderwriterFamilyResolver } from "../../../../resolver/UnderwriterFamilyResolver";
import { CanonicalUnderwriterFamilyRepo } from "../../../../storage/canonical/CanonicalUnderwriterFamilyRepo";
import { CanonicalUnderwriterFamilyAliasRepo } from "../../../../storage/canonical/CanonicalUnderwriterFamilyAliasRepo";
import { UnderwriterFamilyMembershipRepo } from "../../../../storage/canonical/UnderwriterFamilyMembershipRepo";
import { UnderwriterLinkRepo } from "../../../../storage/canonical/UnderwriterLinkRepo";
import { OfferingTermsRepo } from "../../../../storage/offering/OfferingTermsRepo";
import { SpacUnitTermsRepo } from "../../../../storage/offering/SpacUnitTermsRepo";
import { SpacPromoteTermsRepo } from "../../../../storage/offering/SpacPromoteTermsRepo";
import { IssuerTickerRepo } from "../../../../storage/offering/IssuerTickerRepo";
import type { ObservationProvenanceRepo } from "../../../../storage/provenance/ObservationProvenanceRepo";
import { UseOfProceedsRepo } from "../../../../storage/use-of-proceeds/UseOfProceedsRepo";
import { S1_SECTIONS, type S1SectionName } from "./DocumentSegmenter";
import type { OfferingTermsRow } from "./offeringTermsSchema";
import {
  extractOfferingTerms,
  extractSponsorPromote,
  extractUnderwriters,
  extractUseOfProceeds,
} from "./sectionExtractors";
import type { SponsorPromoteRow } from "./sponsorPromoteSchema";
import type { RunSection } from "./sectionRunner";
import { modelExtractChain, persistModelId } from "./s1Model";
import type { UnderwriterRowOut } from "./underwriterSchema";
import type { UseOfProceedsLineRow } from "./useOfProceedsSchema";
import { normalizeFamilyName } from "../../../../resolver/FamilyResolver";
import { isCompanyFamilyPrefixEcho } from "../../../../storage/company/CompanyFamilyName";
import { isUnnamedCompanyName } from "../../../../storage/company/CompanyNormalization";
import {
  parentClauseSourceContext,
  splitParentClause,
} from "../../../../storage/company/splitParentClause";
import { boundSourceSpan, classifySpan } from "./verifySourceSpan";
import { verifyNumericObjectSpan } from "./verifyNumericObjectSpan";
import { anchorFieldSpan } from "./anchorFieldSpan";
import { FieldProvenanceRepo } from "../../../../storage/provenance/FieldProvenanceRepo";
import {
  parseSpacOfferingTerms,
  parseSpacPromoteTerms,
  promoteCoverage,
} from "./parseOfferingTables";
import { parseSpacUnderwriters } from "./parseSpacUnderwriters";
import { parseSpacUseOfProceeds, useOfProceedsIsComplete } from "./parseSpacUseOfProceeds";

/**
 * Concatenate the sections production hands the offering-terms parser, so eval
 * and persist cannot drift.
 */
export function offeringParseText(byName: ReadonlyMap<string, string>): string {
  return [byName.get(S1_SECTIONS.THE_OFFERING), byName.get(S1_SECTIONS.UNDERWRITING)]
    .filter((t): t is string => typeof t === "string")
    .join("\n\n");
}

/**
 * Concatenate the sections production hands the sponsor-promote parser.
 */
export function promoteParseText(byName: ReadonlyMap<string, string>): string {
  return [
    byName.get(S1_SECTIONS.THE_OFFERING),
    byName.get(S1_SECTIONS.THE_SPONSOR),
    byName.get(S1_SECTIONS.PROSPECTUS_SUMMARY),
  ]
    .filter((t): t is string => typeof t === "string")
    .join("\n\n");
}

/**
 * Section names used by the offering-related dead letters. `sponsor-promote` is
 * SPAC-only — {@link runOfferingSections} skips it for a non-SPAC filing, and a
 * skipped section never markResolves — so a non-SPAC dead letter recorded under
 * that name could never drain off the retry worklist. Callers must pass the same
 * `isSpac` they pass to runOfferingSections.
 */
/**
 * Records one citation per field for an object-shaped extraction.
 *
 * Prefers a citation anchored on the field's OWN value — located in the section
 * text — and falls back to the model's object-level span when the value cannot
 * be found. The distinction is recorded in `method`, because the two mean very
 * different things: an anchored citation proves this value came from this text,
 * while the model span only proves the model read the document.
 *
 * A field whose value is absent from its own section gets NO anchored citation,
 * and that absence is the point. A live run reported a trust total of
 * $300,000,000 and 4,500,000 over-allotment units for the sponsor promote; the
 * first is derived (30,000,000 x $10) and the second appears only in the
 * Underwriting section, which that extractor is never given. Both are
 * defensible arithmetic and neither is an extraction — nothing in the
 * object-level span check could tell.
 */
async function citeFields(args: {
  readonly repo: FieldProvenanceRepo;
  readonly extractor_id: string;
  readonly accession_number: string;
  readonly table_name: string;
  readonly row_key?: string;
  readonly text: string;
  readonly confidence: number | null;
  readonly modelSpan: string | null;
  readonly model_id: string | null;
  readonly prompt_version: string;
  readonly fields: ReadonlyArray<readonly [name: string, value: unknown, label?: string]>;
}): Promise<void> {
  const citations = args.fields
    .filter(([, value]) => value !== null && value !== undefined)
    .map(([field_name, value, label]) => {
      const anchored = anchorFieldSpan(args.text, value, label ?? field_name.replace(/_/g, " "));
      return {
        field_name,
        confidence: args.confidence,
        source_span: anchored ?? args.modelSpan,
        method: (anchored !== null ? "anchored" : "model") as "anchored" | "model",
      };
    });
  await args.repo.saveForRow({
    extractor_id: args.extractor_id,
    accession_number: args.accession_number,
    table_name: args.table_name,
    row_key: args.row_key,
    model_id: args.model_id,
    prompt_version: args.prompt_version,
    citations,
  });
}

export function offeringSectionNames(isSpac: boolean): readonly string[] {
  return [
    "offering-terms",
    ...(isSpac ? ["sponsor-promote"] : []),
    "underwriters",
    "use-of-proceeds",
  ];
}

/**
 * Share/unit counts are emitted by the model as plain numbers but stored in
 * integer-typed columns. Round a finite value to the nearest integer (a stray
 * decimal would otherwise be rejected on write and dead-letter the whole
 * section); pass through null.
 */
export function toIntCount(n: number | null | undefined): number | null {
  return n == null || !Number.isFinite(n) ? null : Math.round(n);
}

/**
 * Appended to every offering-terms failure detail. The section returns ONE
 * object carrying the unit/offering terms AND the issuer's whole ticker array
 * under a single `source_span`, so any failure drops all three tables at once —
 * `spac_unit_terms`/`offering_terms` and every `issuer_ticker` row. A real run
 * dead-lettered here and came back with no tickers at all, with nothing in the
 * dead letter to say the ticker series had gone with them.
 */
const OFFERING_TERMS_LOSS =
  " — no offering/unit terms and NO issuer ticker rows were recorded for this filing (one span covers all of them)";

/**
 * Comparison key for an entity name: case- and whitespace-insensitive, ignoring
 * trailing punctuation. Only for detecting that two model rows name the same
 * entity — the stored name stays exactly as the filing wrote it.
 */
export function normalizeEntityName(name: string): string {
  return name
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .replace(/[.,;:]+$/, "")
    .trim()
    .toLowerCase();
}

export interface OfferingSectionsArgs {
  readonly runSection: RunSection;
  readonly observer: EntityObserver;
  readonly provenance: ObservationProvenanceRepo;
  /** Allocates the next observation_index in the caller's per-filing sequence. */
  readonly nextIndex: () => number;
  readonly accession_number: string;
  readonly extractor_id: string;
  readonly extractor_version: string;
  readonly cik: number;
  readonly filing_date: string;
  readonly isSpac: boolean;
  readonly model: ModelConfig;
  readonly models?: readonly ModelConfig[];
  readonly model_id: string | null;
  readonly activeUnderwriterFamilyVersion: string;
  readonly byName: ReadonlyMap<S1SectionName, string>;
  /** Running task context, threaded to the generation calls for CLI progress. */
  readonly context?: IExecuteContext;
}

/**
 * The deal itself, extracted from prospectus text: offering terms (equity →
 * `offering_terms`, SPAC units → `spac_unit_terms`) plus the exact ticker
 * series, underwriters rolled up to families, and use-of-proceeds line items.
 * Shared by the S-1 registration processor and the 424 priced-prospectus
 * processor (which records the final deal under extractor id `424`).
 */
export async function runOfferingSections(args: OfferingSectionsArgs): Promise<void> {
  const {
    runSection,
    observer,
    provenance,
    nextIndex,
    accession_number,
    extractor_id,
    extractor_version,
    cik,
    filing_date,
    isSpac,
    model,
    activeUnderwriterFamilyVersion,
    byName,
    context,
  } = args;
  const models = args.models ?? [model];
  const base = { accession_number, extractor_id, extractor_version };
  // Relation labels follow the issuer convention: "s1:issuer" / "424:issuer".
  const relationPrefix = extractor_id === "S-1" ? "s1" : extractor_id;

  const offeringTermsRepo = new OfferingTermsRepo();
  const spacUnitTermsRepo = new SpacUnitTermsRepo();
  const spacPromoteTermsRepo = new SpacPromoteTermsRepo();
  const issuerTickerRepo = new IssuerTickerRepo();
  const useOfProceedsRepo = new UseOfProceedsRepo();
  const fieldProvenanceRepo = new FieldProvenanceRepo();
  const underwriterFamilyResolver = new UnderwriterFamilyResolver({
    canonicalUnderwriterFamilyRepo: new CanonicalUnderwriterFamilyRepo(),
    canonicalUnderwriterFamilyAliasRepo: new CanonicalUnderwriterFamilyAliasRepo(),
    activeResolverVersion: activeUnderwriterFamilyVersion,
  });
  const underwriterMembershipRepo = new UnderwriterFamilyMembershipRepo();
  const underwriterLinkRepo = new UnderwriterLinkRepo();

  await fieldProvenanceRepo.clear(accession_number);
  await issuerTickerRepo.clear(accession_number);
  await underwriterLinkRepo.clear(accession_number);
  await useOfProceedsRepo.clear(accession_number);

  // --- Offering terms (read from The Offering + Underwriting) ---
  // The extractor returns a single object; adapt it onto runSection by treating
  // a null result as an empty array and wrapping a present result as `[terms]`.
  const offeringText = offeringParseText(byName);
  // The two destinations are mutually exclusive: a SPAC's unit terms, or an
  // equity issuer's share terms. Naming the one in play keeps the coverage
  // contract exact rather than asserting the section rewrites both.
  const termsTable = isSpac ? "spac_unit_terms" : "offering_terms";
  await runSection<OfferingTermsRow>({
    sectionName: "offering-terms",
    text: offeringText,
    notFoundDetail: `no The Offering / Underwriting section text${OFFERING_TERMS_LOSS}`,
    emptyDetail: `no offering terms returned${OFFERING_TERMS_LOSS}`,
    lowConfidenceDetail: `below confidence floor${OFFERING_TERMS_LOSS}`,
    // Prompt-injection backstop: refuse to persist a model-emitted offering-terms
    // row whose source_span is not a verbatim substring of the section text.
    // A paraphrase still persists when two numeric fields locate in the
    // section — the figures came from the filing even if the citation did not.
    verifyRow: (text, r) =>
      verifyNumericObjectSpan(text, r, [
        { key: "units_offered", label: "units" },
        { key: "price_per_unit", label: "per unit" },
        { key: "trust_per_unit", label: "trust" },
        { key: "gross_proceeds", label: "proceeds" },
        { key: "shares_offered", label: "shares" },
        { key: "price", label: "price" },
      ]),
    unverifiedAllDetail: `all $T confident offering-terms rows had source_span not present in section text${OFFERING_TERMS_LOSS}`,
    unverifiedPartialDetail:
      "$N of $T confident offering-terms rows had source_span not present in section text",
    clears: new Set([
      termsTable,
      `field_provenance:${termsTable}`,
      "issuer_ticker",
      "field_provenance:issuer_ticker",
    ]),
    // SPAC-only: the walker reads a unit/price table a non-SPAC equity
    // prospectus does not have. As declared it never stands in for the model —
    // it reads the offering table, not the listing sentence naming the issuer's
    // symbols, so the ticker series cleared above would be left empty. Teaching
    // it to read that sentence is what would let `issuer_ticker` join `covers`.
    ...modelExtractChain(
      models,
      async (text, m) => {
        const terms = await extractOfferingTerms(text, m, context);
        return terms === null ? [] : [terms];
      },
      {
        deterministic: isSpac
          ? {
              extract: (text) => {
                const det = parseSpacOfferingTerms(text);
                return det === null ? [] : [det];
              },
              covers: new Set([termsTable, `field_provenance:${termsTable}`]),
            }
          : undefined,
        clears: new Set([
          termsTable,
          `field_provenance:${termsTable}`,
          "issuer_ticker",
          "field_provenance:issuer_ticker",
        ]),
      }
    ),
    persist: async (rows, meta) => {
      const terms = rows[0];
      const model_id = persistModelId(models, meta.modelIndex);
      const now = new Date().toISOString();
      if (isSpac) {
        await spacUnitTermsRepo.save({
          extractor_id,
          accession_number,
          cik,
          units_offered: toIntCount(terms.units_offered),
          price_per_unit: terms.price_per_unit,
          unit_composition: terms.unit_composition,
          warrant_fraction_per_unit: terms.warrant_fraction_per_unit,
          right_fraction_per_unit: terms.right_fraction_per_unit,
          trust_per_unit: terms.trust_per_unit,
          over_allotment_units: toIntCount(terms.over_allotment_units),
          exchange: terms.exchange,
          ticker: terms.tickers.find((t) => t.is_primary)?.ticker ?? null,
          gross_proceeds: terms.gross_proceeds,
          net_proceeds: terms.net_proceeds,
          confidence: terms.confidence,
          source_span: boundSourceSpan(terms.source_span),
          created_at: now,
        });
      } else {
        await offeringTermsRepo.save({
          extractor_id,
          accession_number,
          cik,
          security_type: terms.security_type,
          shares_offered: toIntCount(terms.shares_offered),
          price: terms.price,
          price_low: terms.price_low,
          price_high: terms.price_high,
          gross_proceeds: terms.gross_proceeds,
          net_proceeds: terms.net_proceeds,
          over_allotment_shares: toIntCount(terms.over_allotment_shares),
          exchange: terms.exchange,
          ticker: terms.tickers.find((t) => t.is_primary)?.ticker ?? null,
          par_value: terms.par_value,
          confidence: terms.confidence,
          source_span: boundSourceSpan(terms.source_span),
          created_at: now,
        });
      }
      await citeFields({
        repo: fieldProvenanceRepo,
        extractor_id,
        accession_number,
        table_name: isSpac ? "spac_unit_terms" : "offering_terms",
        text: offeringText,
        confidence: terms.confidence,
        modelSpan: boundSourceSpan(terms.source_span),
        model_id,
        prompt_version: extractor_version,
        fields: isSpac
          ? [
              ["units_offered", toIntCount(terms.units_offered), "securities offered"],
              ["price_per_unit", terms.price_per_unit, "securities offered"],
              ["trust_per_unit", terms.trust_per_unit, "trust account"],
              ["over_allotment_units", toIntCount(terms.over_allotment_units), "over-allotment"],
              ["gross_proceeds", terms.gross_proceeds, "proceeds"],
              ["net_proceeds", terms.net_proceeds, "proceeds"],
              ["exchange", terms.exchange, "listed on"],
            ]
          : [
              ["shares_offered", toIntCount(terms.shares_offered), "shares offered"],
              ["price", terms.price, "price"],
              ["price_low", terms.price_low, "price"],
              ["price_high", terms.price_high, "price"],
              ["gross_proceeds", terms.gross_proceeds, "proceeds"],
              ["net_proceeds", terms.net_proceeds, "proceeds"],
              ["over_allotment_shares", toIntCount(terms.over_allotment_shares), "over-allotment"],
              ["exchange", terms.exchange, "listed on"],
              ["par_value", terms.par_value, "par value"],
            ],
      });
      for (const t of terms.tickers) {
        const ticker = t.ticker?.trim() ?? "";
        if (ticker === "") continue;
        // Each ticker cites the passage naming THAT symbol. Previously every
        // ticker row stored the parent object's span, which mentions none of
        // them — a populated provenance column that pointed at nothing.
        await citeFields({
          repo: fieldProvenanceRepo,
          extractor_id,
          accession_number,
          table_name: "issuer_ticker",
          row_key: ticker,
          text: offeringText,
          confidence: terms.confidence,
          modelSpan: boundSourceSpan(terms.source_span),
          model_id,
          prompt_version: extractor_version,
          fields: [["ticker", ticker, ticker]],
        });
        await issuerTickerRepo.save({
          extractor_id,
          accession_number,
          exchange: (t.exchange ?? terms.exchange ?? "").trim(),
          ticker,
          cik,
          filing_date,
          security_type: t.security_type,
          is_primary: t.is_primary,
          confidence: terms.confidence,
          source_span: boundSourceSpan(terms.source_span),
          created_at: now,
        });
      }
      return 1;
    },
  });

  // --- Sponsor promote economics (SPAC only) ---
  // Founder-share promote, private-placement warrant coverage, and trust sizing.
  // These live in "The Offering" and "The Sponsor" prose; read both (falling back
  // to the concatenated offering/underwriting text when a dedicated sponsor
  // heading is absent). Skipped for non-SPAC filings.
  const promoteText = promoteParseText(byName);
  await runSection<SponsorPromoteRow>({
    sectionName: "sponsor-promote",
    skip: !isSpac,
    text: promoteText,
    notFoundDetail: "no The Offering / The Sponsor / Prospectus Summary section text",
    emptyDetail: "no sponsor promote terms returned",
    lowConfidenceDetail: "below confidence floor",
    // Prompt-injection backstop: refuse to persist a promote row whose
    // source_span is not a verbatim substring of the section text.
    // Same field-anchor fallback as offering-terms: two located figures
    // beat a paraphrased citation.
    verifyRow: (text, r) =>
      verifyNumericObjectSpan(text, r, [
        { key: "founder_shares", label: "founder" },
        { key: "founder_percent", label: "founder" },
        { key: "trust_per_public_share", label: "trust" },
        { key: "trust_total", label: "trust" },
        { key: "private_placement_warrants", label: "private placement" },
      ]),
    unverifiedAllDetail:
      "all $T confident sponsor-promote rows had source_span not present in section text",
    // Column-granular because the parse is column-granular: `parseSpacPromoteTerms`
    // returns a row on EITHER a founder-share or a trust-per-share anchor, so a
    // table stating one of them yields a row whose other columns are null. Named
    // as a table, that row would overwrite the five figures the model reads out
    // of the surrounding prose with nulls, on this filing and on every replay.
    clears: new Set([
      "spac_promote_terms.founder_shares",
      "spac_promote_terms.founder_percent",
      "spac_promote_terms.private_placement_warrants",
      "spac_promote_terms.private_placement_warrant_price",
      "spac_promote_terms.public_warrant_coverage",
      "spac_promote_terms.trust_per_public_share",
      "spac_promote_terms.trust_total",
      "field_provenance:spac_promote_terms",
    ]),
    ...modelExtractChain(
      models,
      async (text, m) => {
        const promote = await extractSponsorPromote(text, m, context);
        return promote === null ? [] : [promote];
      },
      {
        deterministic: {
          extract: (text) => {
            const det = parseSpacPromoteTerms(text);
            return det === null ? [] : [det];
          },
          covers: promoteCoverage,
          // `spac_promote_terms` is keyed by (extractor, accession): one row per
          // filing, so producing it IS enumerating the population. Which of its
          // columns that row may state is `promoteCoverage`'s question.
          complete: (rows) => rows.length === 1,
        },
        clears: new Set([
          "spac_promote_terms.founder_shares",
          "spac_promote_terms.founder_percent",
          "spac_promote_terms.private_placement_warrants",
          "spac_promote_terms.private_placement_warrant_price",
          "spac_promote_terms.public_warrant_coverage",
          "spac_promote_terms.trust_per_public_share",
          "spac_promote_terms.trust_total",
          "field_provenance:spac_promote_terms",
        ]),
      }
    ),
    persist: async (rows, meta) => {
      const promote = rows[0];
      const model_id = persistModelId(models, meta.modelIndex);
      await spacPromoteTermsRepo.save({
        extractor_id,
        accession_number,
        cik,
        founder_shares: toIntCount(promote.founder_shares),
        founder_percent: promote.founder_percent,
        private_placement_warrants: toIntCount(promote.private_placement_warrants),
        private_placement_warrant_price: promote.private_placement_warrant_price,
        public_warrant_coverage: promote.public_warrant_coverage,
        trust_per_public_share: promote.trust_per_public_share,
        trust_total: promote.trust_total,
        confidence: promote.confidence,
        source_span: boundSourceSpan(promote.source_span),
        created_at: new Date().toISOString(),
      });
      await citeFields({
        repo: fieldProvenanceRepo,
        extractor_id,
        accession_number,
        table_name: "spac_promote_terms",
        text: promoteText,
        confidence: promote.confidence,
        modelSpan: boundSourceSpan(promote.source_span),
        model_id,
        prompt_version: extractor_version,
        fields: [
          ["founder_shares", toIntCount(promote.founder_shares), "founder shares"],
          ["founder_percent", promote.founder_percent, "founder shares"],
          [
            "private_placement_warrants",
            toIntCount(promote.private_placement_warrants),
            "private placement warrants",
          ],
          [
            "private_placement_warrant_price",
            promote.private_placement_warrant_price,
            "private placement warrants",
          ],
          ["public_warrant_coverage", promote.public_warrant_coverage, "warrant"],
          ["trust_per_public_share", promote.trust_per_public_share, "trust account"],
          ["trust_total", promote.trust_total, "trust account"],
        ],
      });
      return 1;
    },
  });

  // --- Underwriters (Underwriting section; all filings) ---
  const underwritingText = byName.get(S1_SECTIONS.UNDERWRITING);
  await runSection<UnderwriterRowOut>({
    sectionName: "underwriters",
    text: underwritingText,
    emptyDetail: "no underwriters returned",
    lowConfidenceDetail: "all rows below confidence floor",
    invalidWriteDetail: "no underwriter rows had a usable legal name",
    // Prompt-injection backstop: refuse to persist any underwriter row whose
    // source_span is not a verbatim substring of the Underwriting section text.
    verifyRow: (text, r) => classifySpan(text, r.source_span),
    unverifiedAllDetail:
      "all $T confident underwriter rows had source_span not present in section text",
    unverifiedPartialDetail:
      "$N of $T confident underwriter rows had source_span not present in section text",
    // `underwriter_family_membership` is derived from the legal name, so the
    // parse supplies it wherever it supplies the observation — it stays a bare
    // table in both sets. `underwriter_link` does not: the syndicate table
    // states an allocation and nothing else, while the ROLE ("sole book-running
    // manager", "co-manager") is prose beside the table and the over-allotment
    // column is often a separate table entirely. Named as a table, an S-1
    // re-run would empty the links and rewrite a filed bookrunner as NULL.
    clears: new Set([
      "underwriter_link.role_detail",
      "underwriter_link.shares_allocated",
      "underwriter_link.over_allotment_shares",
      "underwriter_family_membership",
      "company_observation",
      "observation_provenance",
    ]),
    // SPAC-only: the parser reads the syndicate table a unit IPO prints. As
    // declared it never stands in for the model — teaching it to read the role
    // sentence is what would let `role_detail` join `covers`.
    ...modelExtractChain(models, (text, m) => extractUnderwriters(text, m, context), {
      deterministic: isSpac
        ? {
            extract: parseSpacUnderwriters,
            covers: new Set([
              "underwriter_link.shares_allocated",
              "underwriter_family_membership",
              "company_observation",
              "observation_provenance",
            ]),
          }
        : undefined,
      clears: new Set([
        "underwriter_link.role_detail",
        "underwriter_link.shares_allocated",
        "underwriter_link.over_allotment_shares",
        "underwriter_family_membership",
        "company_observation",
        "observation_provenance",
      ]),
    }),
    persist: async (rows, meta) => {
      const model_id = persistModelId(models, meta.modelIndex);
      let wrote = 0;
      // One underwriter, one link row. The model repeats an underwriter across
      // rows more often than not — a sole-underwriter filing came back with the
      // same bank once, twice, and three times on three consecutive runs — and
      // every duplicate previously minted its own observation, family
      // membership and link row, inflating `sec underwriter by-family` counts by
      // however many times the model stuttered. Deduped on the LEGAL name, not
      // the common name: "Citigroup Global Markets Inc." and "Citigroup Global
      // Markets Limited" are two entities that share one family, and collapsing
      // on the family would silently drop the second.
      const seenLegalNames = new Set<string>();
      const splits = rows.map((r) => splitParentClause(r.legal_name?.trim() ?? ""));
      const extractedNames = splits.map((s) => s.observationName);
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i]!;
        const split = splits[i]!;
        if (split.observationName === "") continue;
        if (isUnnamedCompanyName(split.observationName)) continue;
        // Brand stub next to the full legal name ("Cantor" + "Cantor Fitzgerald
        // & Co.") is one house, not two. Inc vs Limited of the same house are
        // equal-length family keys and are not dropped.
        if (isCompanyFamilyPrefixEcho(split.observationName, extractedNames)) continue;
        const dedupeKey = normalizeEntityName(split.observationName);
        if (seenLegalNames.has(dedupeKey)) continue;
        seenLegalNames.add(dedupeKey);
        // companyFamilyName wipes non-ASCII and punctuation, so "[●]" (a
        // still-blank F-1 table cell) and a CJK legal name both have no family
        // key. A letterless placeholder is not an entity — skip it before
        // observeCompany. A name that still has letters (CJK) is observed
        // without a family rather than throwing "empty name" and aborting the
        // rest of the table.
        const familyKey = normalizeFamilyName(split.familyName);
        if (!familyKey && !/\p{L}/u.test(split.observationName)) continue;
        const observation_index = nextIndex();
        const { observation_id, canonical_company_id } = await observer.observeCompany({
          ...base,
          observation_index,
          name: split.observationName,
          source_context: parentClauseSourceContext(`${relationPrefix}:underwriter`, split),
        });
        await provenance.save({
          kind: "company",
          observation_id,
          confidence: r.confidence,
          source_span: boundSourceSpan(r.source_span),
          section_name: "underwriters",
          model_id,
          prompt_version: extractor_version,
          extra: null,
        });
        if (!familyKey) {
          wrote++;
          continue;
        }
        const underwriter_family_id = await underwriterFamilyResolver.resolve(split.familyName);
        await underwriterMembershipRepo.record({
          resolver_version: activeUnderwriterFamilyVersion,
          canonical_company_id,
          canonical_underwriter_family_id: underwriter_family_id,
          seen_at: new Date().toISOString(),
        });
        await underwriterLinkRepo.save({
          accession_number,
          extractor_id,
          observation_index,
          issuer_cik: cik,
          underwriter_canonical_company_id: canonical_company_id,
          underwriter_family_id,
          role_detail: r.role,
          shares_allocated: toIntCount(r.shares_allocated),
          over_allotment_shares: toIntCount(r.over_allotment_shares),
          resolver_version: activeUnderwriterFamilyVersion,
        });
        wrote++;
      }
      return wrote;
    },
  });

  // --- Use of proceeds ---
  const useOfProceedsText = byName.get(S1_SECTIONS.USE_OF_PROCEEDS);
  await runSection<UseOfProceedsLineRow>({
    sectionName: "use-of-proceeds",
    text: useOfProceedsText,
    emptyDetail: "no line items returned",
    lowConfidenceDetail: "all rows below confidence floor",
    verifyRow: (text, r) => classifySpan(text, r.source_span),
    unverifiedAllDetail:
      "all $T confident use-of-proceeds rows had source_span not present in section text",
    unverifiedPartialDetail:
      "$N of $T confident use-of-proceeds rows had source_span not present in section text",
    // Bare on both sides, including the `note` the parse hardcodes null. The
    // prompt directs every qualifier a line item carries into `purpose` ("the
    // row label copied WHOLE, including any parenthetical the cell carries"),
    // and the parse copies that same cell verbatim — so `note` holds nothing
    // the row does not still say, which is not true of any other null in this
    // change.
    clears: new Set(["use_of_proceeds"]),
    // SPAC-only: the parser reads the offering-expenses table a unit IPO
    // prints. A single line is not one of those tables — it is one figure the
    // row scan happened to match — so it is reported as no parse at all rather
    // than as a one-line use of proceeds.
    ...modelExtractChain(models, (text, m) => extractUseOfProceeds(text, m, context), {
      deterministic: isSpac
        ? {
            extract: (text) => parseSpacUseOfProceeds(text),
            covers: new Set(["use_of_proceeds"]),
            // `use_of_proceeds` holds one row per line item, so covering its
            // columns says nothing about the rows. The walk's own decline log
            // does: a labelled row it could not represent means the table was
            // not enumerated, and the model gets the section. It reads the
            // section rather than `rows` because the count of rows the walk
            // DECLINED is not recoverable from the ones it returned — and it
            // is the same walk, not a second reading: `parseInner` is cached on
            // the text `extract` just passed it.
            complete: (_rows, text) => useOfProceedsIsComplete(text),
          }
        : undefined,
      clears: new Set(["use_of_proceeds"]),
    }),
    persist: async (rows) => {
      const now = new Date().toISOString();
      let lineIndex = 0;
      for (const r of rows) {
        await useOfProceedsRepo.save({
          extractor_id,
          accession_number,
          line_index: lineIndex++,
          cik,
          purpose: r.purpose,
          amount: r.amount,
          percent: r.percent,
          note: r.note,
          confidence: r.confidence,
          source_span: boundSourceSpan(r.source_span),
          created_at: now,
        });
      }
      return rows.length;
    },
  });
}
