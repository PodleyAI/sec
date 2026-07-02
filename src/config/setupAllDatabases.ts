/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry, Sqlite } from "workglow";
import { ADDRESS_HISTORY_JUNCTION_REPOSITORY_TOKEN } from "../storage/address/AddressHistorySchema";
import {
  ADDRESS_JUNCTION_REPOSITORY_TOKEN,
  ADDRESS_REPOSITORY_TOKEN,
} from "../storage/address/AddressSchema";
import { CHANGE_LOG_REPOSITORY_TOKEN } from "../storage/change-tracking/ChangeLogSchema";
import { CIK_NAME_REPOSITORY_TOKEN } from "../storage/entity/CikNameSchema";
import { ENTITY_HISTORY_REPOSITORY_TOKEN } from "../storage/entity/EntityHistorySchema";
import { ENTITY_REPOSITORY_TOKEN } from "../storage/entity/EntitySchema";
import { ENTITY_TICKER_REPOSITORY_TOKEN } from "../storage/entity/EntityTickerSchema";
import { SIC_CODE_REPOSITORY_TOKEN } from "../storage/entity/SicCodeSchema";
import { COMPANY_FACTS_REPOSITORY_TOKEN } from "../storage/facts/CompanyFactsSchema";
import { FILING_REPOSITORY_TOKEN } from "../storage/filing/FilingSchema";
import { INVESTMENT_OFFERING_HISTORY_REPOSITORY_TOKEN } from "../storage/investment-offering/InvestmentOfferingHistorySchema";
import { INVESTMENT_OFFERING_REPOSITORY_TOKEN } from "../storage/investment-offering/InvestmentOfferingSchema";
import { ISSUER_REPOSITORY_TOKEN } from "../storage/investment-offering/IssuerSchema";
import {
  PHONE_ENTITY_JUNCTION_REPOSITORY_TOKEN,
  PHONE_REPOSITORY_TOKEN,
} from "../storage/phone/PhoneSchema";
import { CROWDFUNDING_HISTORY_REPOSITORY_TOKEN } from "../storage/portal/CrowdfundingHistorySchema";
import {
  CROWDFUNDING_OFFERINGS_REPOSITORY_TOKEN,
  CROWDFUNDING_REPORTS_REPOSITORY_TOKEN,
  CROWDFUNDING_REPOSITORY_TOKEN,
} from "../storage/portal/CrowdfundingSchema";
import { PORTAL_REPOSITORY_TOKEN } from "../storage/portal/PortalSchema";
import {
  SECTION16_FILING_REPOSITORY_TOKEN,
  SECTION16_HOLDING_REPOSITORY_TOKEN,
  SECTION16_TRANSACTION_REPOSITORY_TOKEN,
} from "../storage/section16/Section16Schema";
import {
  FORM144_ACQUISITION_REPOSITORY_TOKEN,
  FORM144_FILING_REPOSITORY_TOKEN,
  FORM144_RECENT_SALE_REPOSITORY_TOKEN,
} from "../storage/form144/Form144Schema";
import { CIK_LAST_UPDATE_REPOSITORY_TOKEN } from "../storage/processing/CikLastUpdateSchema";
import { PROCESSED_FACTS_REPOSITORY_TOKEN } from "../storage/processing/ProcessedFactsSchema";
import { PROCESSED_SUBMISSIONS_REPOSITORY_TOKEN } from "../storage/processing/ProcessedSubmissionsSchema";
import { REGA_EQUITY_CLASS_REPOSITORY_TOKEN } from "../storage/reg-a/RegAEquityClassSchema";
import { REGA_FINANCIAL_DATA_REPOSITORY_TOKEN } from "../storage/reg-a/RegAFinancialDataSchema";
import { REGA_OFFERING_HISTORY_REPOSITORY_TOKEN } from "../storage/reg-a/RegAOfferingHistorySchema";
import { REGA_OFFERING_REPOSITORY_TOKEN } from "../storage/reg-a/RegAOfferingSchema";
import { REGA_SERVICE_PROVIDER_REPOSITORY_TOKEN } from "../storage/reg-a/RegAServiceProviderSchema";
import { SPAC_REPOSITORY_TOKEN } from "../storage/spac/SpacSchema";
import { SPAC_DEAL_REPOSITORY_TOKEN } from "../storage/spac/SpacDealSchema";
import { SPAC_EVENT_REPOSITORY_TOKEN } from "../storage/spac/SpacEventSchema";
import { SPAC_HISTORY_REPOSITORY_TOKEN } from "../storage/spac/SpacHistorySchema";
import { SPAC_MERGER_EXTRACTION_REPOSITORY_TOKEN } from "../storage/spac/SpacMergerExtractionSchema";
import { SPAC_REDEMPTION_EXTRACTION_REPOSITORY_TOKEN } from "../storage/spac/SpacRedemptionExtractionSchema";
import {
  CANONICAL_COMPANY_ALIAS_REPOSITORY_TOKEN,
  CANONICAL_PERSON_ALIAS_REPOSITORY_TOKEN,
  CANONICAL_SPONSOR_FAMILY_ALIAS_REPOSITORY_TOKEN,
  CANONICAL_UNDERWRITER_FAMILY_ALIAS_REPOSITORY_TOKEN,
} from "../storage/canonical/CanonicalAliasSchemas";
import { CANONICAL_SPONSOR_FAMILY_REPOSITORY_TOKEN } from "../storage/canonical/CanonicalSponsorFamilySchema";
import { FAMILY_DESCRIPTION_REPOSITORY_TOKEN } from "../storage/canonical/FamilyDescriptionSchema";
import { SPONSOR_FAMILY_MEMBERSHIP_REPOSITORY_TOKEN } from "../storage/canonical/SponsorFamilyMembershipSchema";
import { SPAC_SPONSOR_LINK_REPOSITORY_TOKEN } from "../storage/canonical/SpacSponsorLinkSchema";
import { OFFERING_TERMS_REPOSITORY_TOKEN } from "../storage/offering/OfferingTermsSchema";
import { SPAC_UNIT_TERMS_REPOSITORY_TOKEN } from "../storage/offering/SpacUnitTermsSchema";
import { ISSUER_TICKER_REPOSITORY_TOKEN } from "../storage/offering/IssuerTickerSchema";
import { CANONICAL_UNDERWRITER_FAMILY_REPOSITORY_TOKEN } from "../storage/canonical/CanonicalUnderwriterFamilySchema";
import { UNDERWRITER_FAMILY_MEMBERSHIP_REPOSITORY_TOKEN } from "../storage/canonical/UnderwriterFamilyMembershipSchema";
import { UNDERWRITER_LINK_REPOSITORY_TOKEN } from "../storage/canonical/UnderwriterLinkSchema";
import { USE_OF_PROCEEDS_REPOSITORY_TOKEN } from "../storage/use-of-proceeds/UseOfProceedsSchema";
import { XBRL_FACT_REPOSITORY_TOKEN } from "../storage/xbrl/XbrlFactSchema";
import { FORM_8K_EVENT_REPOSITORY_TOKEN } from "../storage/form-8k-event/Form8KEventSchema";
import { migrateLegacyForm8KEventsTable } from "../storage/form-8k-event/Form8KEventLegacyMigration";
import { CANONICAL_COMPANY_REPOSITORY_TOKEN } from "../storage/canonical/CanonicalCompanySchema";
import {
  CANONICAL_COMPANY_ADDRESS_REPOSITORY_TOKEN,
  CANONICAL_COMPANY_PHONE_REPOSITORY_TOKEN,
  CANONICAL_PERSON_ADDRESS_REPOSITORY_TOKEN,
  CANONICAL_PERSON_PHONE_REPOSITORY_TOKEN,
} from "../storage/canonical/CanonicalJunctionSchemas";
import { CANONICAL_PERSON_REPOSITORY_TOKEN } from "../storage/canonical/CanonicalPersonSchema";
import { COMPANY_IDENTITY_LINK_REPOSITORY_TOKEN } from "../storage/canonical/CompanyIdentityLinkSchema";
import { PERSON_IDENTITY_LINK_REPOSITORY_TOKEN } from "../storage/canonical/PersonIdentityLinkSchema";
import { CURRENT_CANONICAL_VIEW_DDL } from "../storage/canonical/views";
import { COMPANY_OBSERVATION_REPOSITORY_TOKEN } from "../storage/observation/CompanyObservationSchema";
import { PERSON_OBSERVATION_REPOSITORY_TOKEN } from "../storage/observation/PersonObservationSchema";
import { OBSERVATION_PROVENANCE_REPOSITORY_TOKEN } from "../storage/provenance/ObservationProvenanceSchema";
import { BENEFICIAL_OWNERSHIP_REPOSITORY_TOKEN } from "../storage/beneficial-ownership/BeneficialOwnershipSchema";
import { RELATED_PARTY_TRANSACTION_REPOSITORY_TOKEN } from "../storage/related-party/RelatedPartyTransactionSchema";
import { EXTRACTION_DEAD_LETTER_REPOSITORY_TOKEN } from "../storage/dead-letter/ExtractionDeadLetterSchema";
import { S1_CLASSIFICATION_REPOSITORY_TOKEN } from "../storage/classification/S1ClassificationSchema";
import { getDb } from "../util/db";
import { bootstrapComponentVersions } from "../storage/versioning/bootstrapComponentVersions";
import { SEC_DB_FOLDER, SEC_DB_TYPE } from "./tokens";
import { COMPONENT_VERSION_REPOSITORY_TOKEN } from "../storage/versioning/ComponentVersionSchema";
import { EXTRACTOR_RUN_REPOSITORY_TOKEN } from "../storage/versioning/ExtractorRunSchema";
import { VERSION_EVENT_REPOSITORY_TOKEN } from "../storage/versioning/VersionEventSchema";

/**
 * Calls setupDatabase() on all registered repository instances,
 * creating tables and indexes from their TypeBox schemas.
 *
 * NOTE: When adding a new repository token in DefaultDI.ts, you must also
 * add its setupDatabase() call here or the table will not be created.
 */
export async function setupAllDatabases(): Promise<void> {
  // Load the SQLite native binding before any repo opens a database. Guarded
  // because older workglow releases ship without Sqlite.init.
  if (typeof Sqlite.init === "function") {
    await Sqlite.init();
  }
  await globalServiceRegistry.get(ADDRESS_REPOSITORY_TOKEN).setupDatabase();
  await globalServiceRegistry.get(ADDRESS_JUNCTION_REPOSITORY_TOKEN).setupDatabase();
  await globalServiceRegistry.get(ADDRESS_HISTORY_JUNCTION_REPOSITORY_TOKEN).setupDatabase();
  await globalServiceRegistry.get(PHONE_REPOSITORY_TOKEN).setupDatabase();
  await globalServiceRegistry.get(PHONE_ENTITY_JUNCTION_REPOSITORY_TOKEN).setupDatabase();
  await globalServiceRegistry.get(INVESTMENT_OFFERING_REPOSITORY_TOKEN).setupDatabase();
  await globalServiceRegistry.get(INVESTMENT_OFFERING_HISTORY_REPOSITORY_TOKEN).setupDatabase();
  await globalServiceRegistry.get(ISSUER_REPOSITORY_TOKEN).setupDatabase();
  await globalServiceRegistry.get(ENTITY_REPOSITORY_TOKEN).setupDatabase();
  await globalServiceRegistry.get(ENTITY_HISTORY_REPOSITORY_TOKEN).setupDatabase();
  await globalServiceRegistry.get(ENTITY_TICKER_REPOSITORY_TOKEN).setupDatabase();
  await globalServiceRegistry.get(SIC_CODE_REPOSITORY_TOKEN).setupDatabase();
  await globalServiceRegistry.get(CIK_NAME_REPOSITORY_TOKEN).setupDatabase();
  await globalServiceRegistry.get(FILING_REPOSITORY_TOKEN).setupDatabase();
  await globalServiceRegistry.get(CROWDFUNDING_REPOSITORY_TOKEN).setupDatabase();
  await globalServiceRegistry.get(CROWDFUNDING_OFFERINGS_REPOSITORY_TOKEN).setupDatabase();
  await globalServiceRegistry.get(CROWDFUNDING_REPORTS_REPOSITORY_TOKEN).setupDatabase();
  await globalServiceRegistry.get(CROWDFUNDING_HISTORY_REPOSITORY_TOKEN).setupDatabase();
  await globalServiceRegistry.get(SECTION16_FILING_REPOSITORY_TOKEN).setupDatabase();
  await globalServiceRegistry.get(SECTION16_TRANSACTION_REPOSITORY_TOKEN).setupDatabase();
  await globalServiceRegistry.get(SECTION16_HOLDING_REPOSITORY_TOKEN).setupDatabase();
  await globalServiceRegistry.get(FORM144_FILING_REPOSITORY_TOKEN).setupDatabase();
  await globalServiceRegistry.get(FORM144_ACQUISITION_REPOSITORY_TOKEN).setupDatabase();
  await globalServiceRegistry.get(FORM144_RECENT_SALE_REPOSITORY_TOKEN).setupDatabase();
  await globalServiceRegistry.get(CHANGE_LOG_REPOSITORY_TOKEN).setupDatabase();
  await globalServiceRegistry.get(PORTAL_REPOSITORY_TOKEN).setupDatabase();
  await globalServiceRegistry.get(REGA_OFFERING_REPOSITORY_TOKEN).setupDatabase();
  await globalServiceRegistry.get(REGA_OFFERING_HISTORY_REPOSITORY_TOKEN).setupDatabase();
  await globalServiceRegistry.get(REGA_SERVICE_PROVIDER_REPOSITORY_TOKEN).setupDatabase();
  await globalServiceRegistry.get(REGA_FINANCIAL_DATA_REPOSITORY_TOKEN).setupDatabase();
  await globalServiceRegistry.get(REGA_EQUITY_CLASS_REPOSITORY_TOKEN).setupDatabase();
  await globalServiceRegistry.get(SPAC_REPOSITORY_TOKEN).setupDatabase();
  await globalServiceRegistry.get(SPAC_DEAL_REPOSITORY_TOKEN).setupDatabase();
  await globalServiceRegistry.get(SPAC_EVENT_REPOSITORY_TOKEN).setupDatabase();
  await globalServiceRegistry.get(SPAC_HISTORY_REPOSITORY_TOKEN).setupDatabase();
  await globalServiceRegistry.get(SPAC_MERGER_EXTRACTION_REPOSITORY_TOKEN).setupDatabase();
  await globalServiceRegistry.get(SPAC_REDEMPTION_EXTRACTION_REPOSITORY_TOKEN).setupDatabase();
  await globalServiceRegistry.get(CIK_LAST_UPDATE_REPOSITORY_TOKEN).setupDatabase();
  await globalServiceRegistry.get(PROCESSED_FACTS_REPOSITORY_TOKEN).setupDatabase();
  await globalServiceRegistry.get(PROCESSED_SUBMISSIONS_REPOSITORY_TOKEN).setupDatabase();
  await globalServiceRegistry.get(COMPANY_FACTS_REPOSITORY_TOKEN).setupDatabase();
  await globalServiceRegistry.get(COMPONENT_VERSION_REPOSITORY_TOKEN).setupDatabase();
  await globalServiceRegistry.get(EXTRACTOR_RUN_REPOSITORY_TOKEN).setupDatabase();
  await globalServiceRegistry.get(VERSION_EVENT_REPOSITORY_TOKEN).setupDatabase();
  await globalServiceRegistry.get(PERSON_OBSERVATION_REPOSITORY_TOKEN).setupDatabase();
  await globalServiceRegistry.get(COMPANY_OBSERVATION_REPOSITORY_TOKEN).setupDatabase();
  await globalServiceRegistry.get(OBSERVATION_PROVENANCE_REPOSITORY_TOKEN).setupDatabase();
  await globalServiceRegistry.get(BENEFICIAL_OWNERSHIP_REPOSITORY_TOKEN).setupDatabase();
  await globalServiceRegistry.get(RELATED_PARTY_TRANSACTION_REPOSITORY_TOKEN).setupDatabase();
  await globalServiceRegistry.get(EXTRACTION_DEAD_LETTER_REPOSITORY_TOKEN).setupDatabase();
  await globalServiceRegistry.get(S1_CLASSIFICATION_REPOSITORY_TOKEN).setupDatabase();
  await globalServiceRegistry.get(CANONICAL_PERSON_REPOSITORY_TOKEN).setupDatabase();
  await globalServiceRegistry.get(CANONICAL_COMPANY_REPOSITORY_TOKEN).setupDatabase();
  await globalServiceRegistry.get(PERSON_IDENTITY_LINK_REPOSITORY_TOKEN).setupDatabase();
  await globalServiceRegistry.get(COMPANY_IDENTITY_LINK_REPOSITORY_TOKEN).setupDatabase();
  await globalServiceRegistry.get(CANONICAL_PERSON_ADDRESS_REPOSITORY_TOKEN).setupDatabase();
  await globalServiceRegistry.get(CANONICAL_PERSON_PHONE_REPOSITORY_TOKEN).setupDatabase();
  await globalServiceRegistry.get(CANONICAL_COMPANY_ADDRESS_REPOSITORY_TOKEN).setupDatabase();
  await globalServiceRegistry.get(CANONICAL_COMPANY_PHONE_REPOSITORY_TOKEN).setupDatabase();
  await globalServiceRegistry.get(CANONICAL_PERSON_ALIAS_REPOSITORY_TOKEN).setupDatabase();
  await globalServiceRegistry.get(CANONICAL_COMPANY_ALIAS_REPOSITORY_TOKEN).setupDatabase();
  await globalServiceRegistry.get(CANONICAL_SPONSOR_FAMILY_REPOSITORY_TOKEN).setupDatabase();
  await globalServiceRegistry.get(FAMILY_DESCRIPTION_REPOSITORY_TOKEN).setupDatabase();
  await globalServiceRegistry.get(CANONICAL_SPONSOR_FAMILY_ALIAS_REPOSITORY_TOKEN).setupDatabase();
  await globalServiceRegistry.get(SPONSOR_FAMILY_MEMBERSHIP_REPOSITORY_TOKEN).setupDatabase();
  await globalServiceRegistry.get(SPAC_SPONSOR_LINK_REPOSITORY_TOKEN).setupDatabase();
  await globalServiceRegistry.get(OFFERING_TERMS_REPOSITORY_TOKEN).setupDatabase();
  await globalServiceRegistry.get(SPAC_UNIT_TERMS_REPOSITORY_TOKEN).setupDatabase();
  await globalServiceRegistry.get(ISSUER_TICKER_REPOSITORY_TOKEN).setupDatabase();
  await globalServiceRegistry.get(CANONICAL_UNDERWRITER_FAMILY_REPOSITORY_TOKEN).setupDatabase();
  await globalServiceRegistry
    .get(CANONICAL_UNDERWRITER_FAMILY_ALIAS_REPOSITORY_TOKEN)
    .setupDatabase();
  await globalServiceRegistry.get(UNDERWRITER_FAMILY_MEMBERSHIP_REPOSITORY_TOKEN).setupDatabase();
  await globalServiceRegistry.get(UNDERWRITER_LINK_REPOSITORY_TOKEN).setupDatabase();
  await globalServiceRegistry.get(USE_OF_PROCEEDS_REPOSITORY_TOKEN).setupDatabase();
  await globalServiceRegistry.get(XBRL_FACT_REPOSITORY_TOKEN).setupDatabase();
  // Drop the legacy form_8k_events shape (no event_id / extractor_id /
  // extractor_version) before creating the current one; the natural-key PK
  // of the legacy table cannot be ALTERed away on either backend.
  await migrateLegacyForm8KEventsTable();
  await globalServiceRegistry.get(FORM_8K_EVENT_REPOSITORY_TOKEN).setupDatabase();
  // View DDL is created here only on the SQLite path; the Postgres backend
  // owns its own view bootstrap (and getDb() now throws when SEC_DB_TYPE
  // isn't sqlite). Tests use the in-memory backend where views don't apply.
  const dbType = globalServiceRegistry.has(SEC_DB_TYPE)
    ? globalServiceRegistry.get(SEC_DB_TYPE)
    : "sqlite";
  if (dbType === "sqlite" && globalServiceRegistry.has(SEC_DB_FOLDER)) {
    const db = getDb();
    for (const ddl of CURRENT_CANONICAL_VIEW_DDL) {
      db.exec(ddl);
    }
    backfillExtractorRunsOutcome(db);
    migrateSpacNarrativeColumns(db);
  }
  await bootstrapComponentVersions();
}

/**
 * One-shot additive migration: the embarc-facing narrative/enrichment columns
 * are new nullable columns on existing tables. `CREATE TABLE IF NOT EXISTS` is a
 * no-op once the table exists, so add each missing column on a previously-set-up
 * SQLite database. Fresh DBs create them from the TypeBox schema; nullable
 * columns need no default backfill. Mirrors {@link backfillExtractorRunsOutcome}.
 */
function migrateSpacNarrativeColumns(db: Sqlite.Database): void {
  const ADDITIONS: ReadonlyArray<{ table: string; columns: ReadonlyArray<[string, string]> }> = [
    {
      table: "spac",
      columns: [
        ["focus", "TEXT"],
        ["focus_location", "TEXT"],
        ["description", "TEXT"],
        ["target_description", "TEXT"],
        ["team", "TEXT"],
        ["details", "TEXT"],
        ["url_spac", "TEXT"],
        ["url_sponsor", "TEXT"],
        ["investorpres_url", "TEXT"],
        ["investorpres_date", "TEXT"],
      ],
    },
    {
      table: "spac_history",
      columns: [
        ["focus", "TEXT"],
        ["focus_location", "TEXT"],
        ["description", "TEXT"],
        ["target_description", "TEXT"],
        ["team", "TEXT"],
        ["details", "TEXT"],
        ["url_spac", "TEXT"],
        ["url_sponsor", "TEXT"],
        ["investorpres_url", "TEXT"],
        ["investorpres_date", "TEXT"],
      ],
    },
    { table: "spac_deal", columns: [["target_description", "TEXT"]] },
    { table: "spac_merger_extraction", columns: [["target_description", "TEXT"]] },
    { table: "portals", columns: [["featured", "BOOLEAN"]] },
    {
      table: "person_observations",
      columns: [
        ["birth_year", "INTEGER"],
        ["bio", "TEXT"],
      ],
    },
  ];
  for (const { table, columns } of ADDITIONS) {
    const cols = db.prepare<[], { name: string }>(`PRAGMA table_info(\`${table}\`)`).all();
    if (cols.length === 0) continue; // table not created yet (clean DB)
    const present = new Set(cols.map((c) => c.name));
    for (const [col, type] of columns) {
      if (!present.has(col)) {
        db.exec(`ALTER TABLE \`${table}\` ADD COLUMN ${col} ${type}`);
      }
    }
  }
}

/**
 * One-shot migration: pre-`outcome` extractor_runs rows on a previously-set-up
 * SQLite database lack the new column. CREATE TABLE IF NOT EXISTS is a no-op
 * once the table exists, so add the column if missing and seed it from the
 * existing `success` boolean (partial is unknowable for legacy rows).
 */
function backfillExtractorRunsOutcome(db: Sqlite.Database): void {
  const cols = db.prepare<[], { name: string }>(`PRAGMA table_info(\`extractor_runs\`)`).all();
  if (cols.length === 0) return; // table not created yet (clean DB)
  if (cols.some((c) => c.name === "outcome")) return; // already migrated
  db.exec(`ALTER TABLE \`extractor_runs\` ADD COLUMN outcome TEXT NOT NULL DEFAULT 'failure'`);
  db.exec(
    `UPDATE \`extractor_runs\` SET outcome = CASE WHEN success = 1 OR success = 'true' THEN 'success' ELSE 'failure' END`
  );
}
