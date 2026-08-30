/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Type } from "typebox";
import { globalServiceRegistry, IExecuteContext, Task, Workflow } from "workglow";
import { isDryRun } from "../../cli/isDryRun";
import { CIK_LAST_UPDATE_REPOSITORY_TOKEN } from "../../storage/processing/CikLastUpdateSchema";
import {
  PROCESSED_FACTS_REPOSITORY_TOKEN,
  type ProcessedFacts,
} from "../../storage/processing/ProcessedFactsSchema";
import { todayYYYYdMMdDD } from "../../util/dataCleaningUtils";
import { computeFactsWorklist, type FactsWorkItem } from "./computeFactsWorklist";
import { listFactsEligibleCiks } from "./factsEligibleCiks";
import { fetchAndStoreCompanyFacts } from "./fetchAndStoreCompanyFacts";

export type UpdateAllCompanyFactsTaskInput = {
  readonly force?: boolean;
  readonly retryFailed?: boolean;
  /**
   * Sweep every never-processed CIK instead of only those plausibly holding
   * facts. The default filter drops ~93% of that lane — almost all of it
   * Section 16 reporting persons who answer companyfacts with a 404 — so this
   * is the escape hatch for auditing what the filter excludes, not a routine
   * setting. Has no effect on the changed/retry lanes, which are never filtered.
   */
  readonly allCiks?: boolean;
};

export type UpdateAllCompanyFactsTaskOutput = {
  success: boolean;
};

/**
 * Task for storing company facts
 */
export class UpdateAllCompanyFactsTask extends Task<
  UpdateAllCompanyFactsTaskInput,
  UpdateAllCompanyFactsTaskOutput
> {
  static readonly type = "UpdateAllCompanyFactsTask";
  static readonly category = "SEC";
  static readonly title = "Update company facts for all CIKs";
  static readonly cacheable = false;

  public static inputSchema() {
    return Type.Object({
      force: Type.Optional(Type.Boolean()),
      retryFailed: Type.Optional(Type.Boolean()),
      allCiks: Type.Optional(Type.Boolean()),
    });
  }

  public static outputSchema() {
    return Type.Object({
      success: Type.Boolean(),
    });
  }

  async execute(
    input: UpdateAllCompanyFactsTaskInput,
    context: IExecuteContext
  ): Promise<UpdateAllCompanyFactsTaskOutput> {
    const cikLastUpdateRepo = globalServiceRegistry.get(CIK_LAST_UPDATE_REPOSITORY_TOKEN);
    const processedFactsRepo = globalServiceRegistry.get(PROCESSED_FACTS_REPOSITORY_TOKEN);

    // getAll() rather than query({}, …): the tabular backend rejects an empty
    // criteria object ("Query criteria must not be empty. Use getAll()"), which
    // is exactly the all-rows read we want here.
    const allCikUpdates =
      (await cikLastUpdateRepo.getAll({
        orderBy: [{ column: "last_update", direction: "DESC" }],
      })) ?? [];

    // Stream rather than getAll() — see UpdateAllSubmissionsTask for the
    // same pattern. We need both cik and last_processed for freshness,
    // so a Map built page-by-page is unavoidable but the intermediate
    // row materialisation isn't.
    const processedMap = new Map<number, ProcessedFacts>();
    if (!input.force) {
      for await (const pf of processedFactsRepo.records(5000)) {
        processedMap.set(pf.cik, pf);
      }
    }

    // Skipped under `force` (which routes everything through needsUpdating and
    // so never consults it) and under `allCiks`, so neither pays for the scan.
    const eligible = input.force || input.allCiks ? undefined : await listFactsEligibleCiks();

    const { needsUpdating, needsProcessing, needsRetrying } = computeFactsWorklist(
      allCikUpdates,
      processedMap,
      {
        force: input.force ?? false,
        retryFailed: input.retryFailed ?? false,
        retryDate: todayYYYYdMMdDD(),
        eligible,
      }
    );

    if (isDryRun()) {
      if (input.force) {
        console.log(
          `Would update ${needsUpdating.length} company facts (force — reprocessing all)`
        );
      } else {
        const retrySuffix = input.retryFailed
          ? `, retrying ${needsRetrying.length} previously failed,`
          : "";
        const scope =
          eligible === undefined
            ? " (unfiltered — every never-processed CIK)"
            : ` (of ${allCikUpdates.length - processedMap.size} never processed, ${eligible.size} pass the XBRL/SIC filter)`;
        console.log(
          `Would update ${needsUpdating.length} changed${retrySuffix} and ${needsProcessing.length} new company facts${scope}`
        );
      }
      return { success: true };
    }

    const runLane = async (
      lane: string,
      items: FactsWorkItem[],
      concurrencyLimit: number
    ): Promise<void> => {
      if (!items.length) return;
      const wf = context.own(new Workflow(), {
        title: `${lane} company facts (${items.length} CIKs)`,
      });
      const loop = wf.map({ concurrencyLimit, maxIterations: items.length });
      loop.pipe(fetchAndStoreCompanyFacts);
      loop.endMap();
      await wf.run({
        cik: items.map((r) => r.cik),
        date: items.map((r) => r.last_update),
      });
    };

    await runLane("Update changed", needsUpdating, 1);
    await runLane("Retry failed", needsRetrying, 1);
    await runLane("Process new", needsProcessing, 10);

    return { success: true };
  }
}
