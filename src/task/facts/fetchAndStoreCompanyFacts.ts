/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { IExecuteContext, TaskAbortedError } from "workglow";
import type { FactsReasonCode } from "../../storage/processing/ProcessedFactsSchema";
import { recordFactsOutcome } from "../../storage/processing/recordFactsOutcome";
import { todayYYYYdMMdDD } from "../../util/dataCleaningUtils";
import { classifyFactsFetchError } from "./classifyFactsFetchError";
import { FetchCompanyFactsTask, FetchCompanyFactsTaskOutput } from "./FetchCompanyFactsTask";
import { StoreCompanyFactsTask } from "./StoreCompanyFactsTask";

export interface FetchAndStoreFactsDeps {
  readonly fetchFacts: (
    input: { cik: number; date?: string },
    ctx: IExecuteContext
  ) => Promise<FetchCompanyFactsTaskOutput>;
  readonly storeFacts: (
    fetched: FetchCompanyFactsTaskOutput,
    ctx: IExecuteContext
  ) => Promise<void>;
}

const defaultDeps: FetchAndStoreFactsDeps = {
  fetchFacts: async (input, ctx) => await ctx.own(new FetchCompanyFactsTask()).run(input),
  storeFacts: async (fetched, ctx) => {
    await ctx.own(new StoreCompanyFactsTask()).run(fetched);
  },
};

export async function fetchAndStoreCompanyFacts(
  input: { cik: number; date?: string },
  ctx: IExecuteContext
): Promise<{ success: boolean }> {
  return await fetchAndStoreCompanyFactsWithDeps(input, ctx, defaultDeps);
}

/**
 * Fetches and stores one CIK's facts, recording a classified outcome in
 * `processed_facts`. A companyfacts 404 is a successful terminal outcome
 * (`NO_XBRL_FACTS`); other failures are recorded for the `--retry-failed`
 * sweep. Aborts propagate without recording. Per-item failures are swallowed
 * so the enclosing map task always succeeds.
 */
export async function fetchAndStoreCompanyFactsWithDeps(
  input: { cik: number; date?: string },
  ctx: IExecuteContext,
  deps: FetchAndStoreFactsDeps
): Promise<{ success: boolean }> {
  const date = input.date ?? todayYYYYdMMdDD();

  const recordFailure = async (reason_code: FactsReasonCode, e: unknown): Promise<void> => {
    const message = e instanceof Error ? e.message : String(e);
    console.warn(
      `Failed to ${reason_code === "STORE_ERROR" ? "store" : "fetch"} company facts for CIK ${input.cik} (${reason_code}): ${message}`
    );
    await recordFactsOutcome({
      cik: input.cik,
      date,
      success: false,
      reason_code,
      detail: message,
    });
  };

  let fetched: FetchCompanyFactsTaskOutput;
  try {
    fetched = await deps.fetchFacts(input, ctx);
  } catch (e) {
    if (e instanceof TaskAbortedError) throw e;
    const reason = classifyFactsFetchError(e);
    if (reason === "NO_XBRL_FACTS") {
      await recordFactsOutcome({
        cik: input.cik,
        date,
        success: true,
        reason_code: "NO_XBRL_FACTS",
        detail: null,
      });
    } else {
      await recordFailure(reason, e);
    }
    return { success: true };
  }

  try {
    await deps.storeFacts(fetched, ctx);
  } catch (e) {
    if (e instanceof TaskAbortedError) throw e;
    await recordFailure("STORE_ERROR", e);
    return { success: true };
  }

  await recordFactsOutcome({
    cik: input.cik,
    date,
    success: true,
    reason_code: null,
    detail: null,
  });
  return { success: true };
}
