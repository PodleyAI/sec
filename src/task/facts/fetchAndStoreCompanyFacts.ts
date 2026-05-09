/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { globalServiceRegistry, IExecuteContext, pipe } from "workglow";
import { PROCESSED_FACTS_REPOSITORY_TOKEN } from "../../storage/processing/ProcessedFactsSchema";
import { todayYYYYdMMdDD } from "../../util/dataCleaningUtils";
import { FetchCompanyFactsTask } from "./FetchCompanyFactsTask";
import { StoreCompanyFactsTask } from "./StoreCompanyFactsTask";

export async function fetchAndStoreCompanyFacts(
  input: { cik: number; date?: string },
  ctx: IExecuteContext
): Promise<{ success: boolean }> {
  const pipeline = ctx.own(pipe([new FetchCompanyFactsTask(), new StoreCompanyFactsTask()]));
  let success = false;
  try {
    await pipeline.run(input);
    success = true;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.warn(`Failed to fetch/store company facts for CIK ${input.cik}: ${message}`);
  } finally {
    const processedFactsRepo = globalServiceRegistry.get(PROCESSED_FACTS_REPOSITORY_TOKEN);
    await processedFactsRepo.put({
      cik: input.cik,
      last_processed: input.date ?? todayYYYYdMMdDD(),
      success,
    });
  }
  // Per-item failures are recorded above; the map task itself always succeeds
  return { success: true };
}
