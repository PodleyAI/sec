import type { ServiceToken } from "workglow";
import { globalServiceRegistry } from "workglow";
import { ADDRESS_REPOSITORY_TOKEN } from "../../storage/address/AddressSchema";
import { CIK_NAME_REPOSITORY_TOKEN } from "../../storage/entity/CikNameSchema";
import { ENTITY_REPOSITORY_TOKEN } from "../../storage/entity/EntitySchema";
import { COMPANY_FACTS_REPOSITORY_TOKEN } from "../../storage/facts/CompanyFactsSchema";
import { FILING_REPOSITORY_TOKEN } from "../../storage/filing/FilingSchema";
import { INVESTMENT_OFFERING_REPOSITORY_TOKEN } from "../../storage/investment-offering/InvestmentOfferingSchema";
import { PHONE_REPOSITORY_TOKEN } from "../../storage/phone/PhoneSchema";
import { CROWDFUNDING_REPOSITORY_TOKEN } from "../../storage/portal/CrowdfundingSchema";
import { PORTAL_REPOSITORY_TOKEN } from "../../storage/portal/PortalSchema";
import { PROCESSED_FACTS_REPOSITORY_TOKEN } from "../../storage/processing/ProcessedFactsSchema";
import { PROCESSED_SUBMISSIONS_REPOSITORY_TOKEN } from "../../storage/processing/ProcessedSubmissionsSchema";
import { EXTRACTOR_RUN_REPOSITORY_TOKEN } from "../../storage/versioning/ExtractorRunSchema";

export interface DbStatusResult {
  readonly entityCount: number;
  readonly filingCount: number;
  readonly factsCount: number;
  readonly processedSubmissions: number;
  readonly processedFacts: number;
  readonly extractorRuns: number;
}

export interface TableStat {
  readonly table: string;
  readonly rows: number;
}

/**
 * Counts rows in a repository via the storage `size()` method rather than
 * loading every entity with `getAll()`. `cik_names` in particular has ~1M rows,
 * so `getAll()` would be both slow and memory-hungry.
 */
async function countRows(token: ServiceToken<{ size(): Promise<number> }>): Promise<number> {
  const repo = globalServiceRegistry.get(token);
  return await repo.size();
}

export async function getDbStatus(): Promise<DbStatusResult> {
  const [
    entityCount,
    filingCount,
    factsCount,
    processedSubmissions,
    processedFacts,
    extractorRuns,
  ] = await Promise.all([
    countRows(ENTITY_REPOSITORY_TOKEN as any),
    countRows(FILING_REPOSITORY_TOKEN as any),
    countRows(COMPANY_FACTS_REPOSITORY_TOKEN as any),
    countRows(PROCESSED_SUBMISSIONS_REPOSITORY_TOKEN as any),
    countRows(PROCESSED_FACTS_REPOSITORY_TOKEN as any),
    countRows(EXTRACTOR_RUN_REPOSITORY_TOKEN as any),
  ]);

  return {
    entityCount,
    filingCount,
    factsCount,
    processedSubmissions,
    processedFacts,
    extractorRuns,
  };
}

const TABLE_TOKENS: ReadonlyArray<{
  readonly table: string;
  readonly token: ServiceToken<{ size(): Promise<number> }>;
}> = [
  { table: "cik_names", token: CIK_NAME_REPOSITORY_TOKEN as any },
  { table: "entity", token: ENTITY_REPOSITORY_TOKEN as any },
  { table: "filing", token: FILING_REPOSITORY_TOKEN as any },
  { table: "company_facts", token: COMPANY_FACTS_REPOSITORY_TOKEN as any },
  { table: "investment_offering", token: INVESTMENT_OFFERING_REPOSITORY_TOKEN as any },
  { table: "crowdfunding", token: CROWDFUNDING_REPOSITORY_TOKEN as any },
  { table: "address", token: ADDRESS_REPOSITORY_TOKEN as any },
  { table: "phone", token: PHONE_REPOSITORY_TOKEN as any },
  { table: "portal", token: PORTAL_REPOSITORY_TOKEN as any },
  { table: "extractor_runs", token: EXTRACTOR_RUN_REPOSITORY_TOKEN as any },
];

export async function getDbStats(): Promise<TableStat[]> {
  const results = await Promise.all(
    TABLE_TOKENS.map(async ({ table, token }) => {
      const rows = await countRows(token);
      return { table, rows };
    })
  );
  return results;
}
