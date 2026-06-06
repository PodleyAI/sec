/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IExecuteContext, ModelConfig } from "workglow";
import { StructuredGenerationTask } from "workglow";
import {
  BeneficialOwnershipOutputSchema,
  ManagementOutputSchema,
  RelatedPartyOutputSchema,
  type BeneficialOwnerRow,
  type ManagementPersonRow,
  type RelatedPartyRow,
} from "./sectionSchemas";
import { SpacSponsorOutputSchema, type SpacSponsorRow } from "./spacSponsorSchema";
import { OfferingTermsOutputSchema, type OfferingTermsRow } from "./offeringTermsSchema";
import { UnderwriterOutputSchema, type UnderwriterRowOut } from "./underwriterSchema";
import { UseOfProceedsOutputSchema, type UseOfProceedsLineRow } from "./useOfProceedsSchema";

const MAX_TOKENS = 4096;

/**
 * Minimal execution context for driving a {@link StructuredGenerationTask}
 * outside a full task-graph run. The task only uses `signal`, `updateProgress`,
 * `own`, and (defensively) `registry`/`resourceScope` during a structured
 * generation, so a lightweight stub suffices.
 */
function makeExecuteContext(): IExecuteContext {
  const controller = new AbortController();
  return {
    signal: controller.signal,
    updateProgress: async () => {},
    own: <T>(value: T): T => value,
    registry: {
      has: () => false,
      get: () => {
        throw new Error("not registered");
      },
    } as any,
    resourceScope: {
      register: (_key: string, _fn: () => Promise<void>) => {},
      dispose: async () => {},
    } as any,
  } as IExecuteContext;
}

/**
 * Runs one real structured-generation round-trip against the registered
 * provider for `model`, validating the result against `outputSchema`, and
 * returns the parsed object.
 *
 * We drive the task via `execute(input, ctx)` rather than the `structuredGeneration()`
 * / `.run()` helper deliberately: `.run()` routes through the full TaskRunner
 * lifecycle (caching, graph wiring), which requires runtime setup we neither have
 * nor want for a one-shot CLI extraction call — provider resolution itself is
 * global (via the AiProviderRegistry), independent of the context. The `as any`
 * casts adapt our concrete input/config to the task's generic `NoInfer<Partial<…>>`
 * config shape, which TypeScript cannot narrow from the structured literal here.
 */
async function runStructured(
  model: ModelConfig,
  prompt: string,
  outputSchema: object
): Promise<Record<string, unknown>> {
  const input = {
    model,
    prompt,
    outputSchema,
    maxTokens: MAX_TOKENS,
    maxRetries: 1,
  };
  const task = new StructuredGenerationTask({ defaults: input } as any);
  const result = await task.execute(input as any, makeExecuteContext());
  return (result?.object as Record<string, unknown> | undefined) ?? {};
}

export async function extractManagement(
  sectionText: string,
  model: ModelConfig
): Promise<ManagementPersonRow[]> {
  const prompt =
    "Extract every director and executive officer named in the following S-1 MANAGEMENT section. " +
    "For each, give full_name, title (or null), relationship (or null), a confidence in [0,1], and " +
    "the verbatim source_span you drew them from. Return JSON matching the schema.\n\n" +
    sectionText;
  const obj = await runStructured(model, prompt, ManagementOutputSchema);
  return (obj.people as ManagementPersonRow[] | undefined) ?? [];
}

export async function extractBeneficialOwnership(
  sectionText: string,
  model: ModelConfig
): Promise<BeneficialOwnerRow[]> {
  const prompt =
    "Extract every beneficial owner from the following S-1 Principal and Selling Stockholders table. " +
    "For each row give name, owner_kind ('person' or 'company'), security_class, shares_owned, percent_owned, " +
    "shares_offered, shares_after, percent_after, is_selling_stockholder, footnote, a confidence in [0,1], and the " +
    "verbatim source_span. Use null for figures shown as '*', '—', or blank. Return JSON matching the schema.\n\n" +
    sectionText;
  const obj = await runStructured(model, prompt, BeneficialOwnershipOutputSchema);
  return (obj.owners as BeneficialOwnerRow[] | undefined) ?? [];
}

export async function extractRelatedParty(
  sectionText: string,
  model: ModelConfig
): Promise<RelatedPartyRow[]> {
  const prompt =
    "Extract related parties and their transactions from the following S-1 Certain Relationships and Related " +
    "Transactions section. For each party give name, party_kind ('person' or 'company'), a confidence in [0,1], the " +
    "verbatim source_span, and a transactions array (counterparty, nature, amount, period, footnote — any may be " +
    "null). Return JSON matching the schema.\n\n" +
    sectionText;
  const obj = await runStructured(model, prompt, RelatedPartyOutputSchema);
  return (obj.parties as RelatedPartyRow[] | undefined) ?? [];
}

export async function extractOfferingTerms(
  sectionText: string,
  model: ModelConfig
): Promise<OfferingTermsRow | null> {
  const prompt =
    "Extract the offering terms from the following S-1/F-1 'The Offering' and 'Underwriting' text. " +
    "For a normal IPO fill security_type, shares_offered, price (or price_low/price_high), gross_proceeds, " +
    "net_proceeds, over_allotment_shares, exchange, par_value. For a SPAC (units) fill units_offered, " +
    "price_per_unit, unit_composition (verbatim), warrant_fraction_per_unit, right_fraction_per_unit, " +
    "trust_per_unit, over_allotment_units. List every distinct ticker symbol in 'tickers' (exact symbol, " +
    "is_primary true for the common-equity/units symbol, false for warrant/right symbols). Use null for " +
    "anything not stated. Give a confidence in [0,1] and a verbatim source_span. Return JSON matching the " +
    "schema.\n\n" +
    sectionText;
  let obj: Record<string, unknown>;
  try {
    obj = await runStructured(model, prompt, OfferingTermsOutputSchema);
  } catch {
    return null;
  }
  if (obj.confidence == null || obj.source_span == null) return null;
  return obj as unknown as OfferingTermsRow;
}

export async function extractUnderwriters(
  sectionText: string,
  model: ModelConfig
): Promise<UnderwriterRowOut[]> {
  const prompt =
    "Extract every underwriter named in the following S-1/F-1 Underwriting (or Plan of Distribution) " +
    "section. For each give legal_name (full legal entity, e.g. 'Goldman Sachs & Co. LLC'), common_name " +
    "(the bank brand without legal suffix, e.g. 'Goldman Sachs'), role (one of 'lead' for the " +
    "representative/lead, 'bookrunner' for a book-running manager, 'co-manager', else 'underwriter'; null " +
    "if unclear), shares_allocated (the number of shares underwritten, or null), over_allotment_shares (or " +
    "null), a confidence in [0,1], and the verbatim source_span. Return JSON matching the schema.\n\n" +
    sectionText;
  const obj = await runStructured(model, prompt, UnderwriterOutputSchema);
  return (obj.underwriters as UnderwriterRowOut[] | undefined) ?? [];
}

export async function extractSpacSponsors(
  sectionText: string,
  model: ModelConfig
): Promise<SpacSponsorRow[]> {
  const prompt =
    "This is a SPAC (blank-check) registration statement. Identify each sponsor entity. " +
    "For each, give legal_name (the full legal entity, e.g. 'Acme Sponsor 2, LLC'), common_name " +
    "(the sponsor brand/family without the legal suffix or series number, e.g. 'Acme Sponsor'), a " +
    "confidence in [0,1], and the verbatim source_span. Return JSON matching the schema.\n\n" +
    sectionText;
  const obj = await runStructured(model, prompt, SpacSponsorOutputSchema);
  return (obj.sponsors as SpacSponsorRow[] | undefined) ?? [];
}

export async function extractUseOfProceeds(
  sectionText: string,
  model: ModelConfig
): Promise<UseOfProceedsLineRow[]> {
  const prompt =
    "Extract the use-of-proceeds line items from the following S-1/F-1 Use of Proceeds section. For each " +
    "stated purpose give purpose, amount (dollars, or null), percent (or null), note (any qualifier, or " +
    "null), a confidence in [0,1], and the verbatim source_span. Return JSON matching the schema.\n\n" +
    sectionText;
  const obj = await runStructured(model, prompt, UseOfProceedsOutputSchema);
  return (obj.line_items as UseOfProceedsLineRow[] | undefined) ?? [];
}
