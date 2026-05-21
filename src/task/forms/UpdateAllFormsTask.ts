/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Type } from "typebox";
import { globalServiceRegistry, IExecuteContext, Task, Workflow } from "workglow";
import { isDryRun } from "../../cli/isDryRun";
import { FILING_REPOSITORY_TOKEN, type Filing } from "../../storage/filing/FilingSchema";
import { COMPONENT_VERSION_REPOSITORY_TOKEN } from "../../storage/versioning/ComponentVersionSchema";
import { ExtractorRunRepo } from "../../storage/versioning/ExtractorRunRepo";
import { EXTRACTOR_RUN_REPOSITORY_TOKEN } from "../../storage/versioning/ExtractorRunSchema";
import { formToExtractorId } from "../../storage/versioning/extractorIds";
import { VersionRegistry } from "../../storage/versioning/VersionRegistry";
import { ProcessAccessionDocFormTask } from "./ProcessAccessionDocFormTask";

export type UpdateAllFormsTaskInput = {
  readonly form: string[];
};

export type UpdateAllFormsTaskOutput = {
  success: boolean;
};

/**
 * Schedules ProcessAccessionDocFormTask for every filing of the requested
 * form types that does not yet have a successful extractor_runs row at the
 * current extractor version. Re-processing existing rows requires a
 * version bump (PR3's `sec version start-dev` / `promote`); there is no
 * --force escape hatch.
 */
export class UpdateAllFormsTask extends Task<UpdateAllFormsTaskInput, UpdateAllFormsTaskOutput> {
  static readonly type = "UpdateAllFormsTask";
  static readonly category = "SEC";
  static readonly cacheable = false;

  public static inputSchema() {
    return Type.Object({
      form: Type.Array(Type.String()),
    });
  }

  public static outputSchema() {
    return Type.Object({
      success: Type.Boolean(),
    });
  }

  async execute(
    input: UpdateAllFormsTaskInput,
    context: IExecuteContext
  ): Promise<UpdateAllFormsTaskOutput> {
    const filingRepo = globalServiceRegistry.get(FILING_REPOSITORY_TOKEN);
    const runRepo = new ExtractorRunRepo(
      globalServiceRegistry.get(EXTRACTOR_RUN_REPOSITORY_TOKEN)
    );
    const versionRegistry = new VersionRegistry(
      globalServiceRegistry.get(COMPONENT_VERSION_REPOSITORY_TOKEN)
    );

    const formSet = new Set(input.form);
    const formsToProcess: Filing[] = [];

    for (const form of formSet) {
      const extractorId = formToExtractorId(form);
      if (!extractorId) {
        console.warn(
          `update-forms: form '${form}' has no registered extractor; skipping`
        );
        continue;
      }
      const current = await versionRegistry.getCurrent("extractor", extractorId);
      if (!current) {
        throw new Error(
          `No current version for extractor '${extractorId}'. Run 'sec db setup' to bootstrap.`
        );
      }

      const filings = (await filingRepo.query({ form })) ?? [];
      const unprocessed = await runRepo.listFilingsWithoutSuccessfulRun(
        filings,
        extractorId,
        current.semver
      );
      for (const f of unprocessed) {
        formsToProcess.push(f);
      }
    }

    if (isDryRun()) {
      const forms = [...formSet].join(", ");
      console.log(
        `Would process ${formsToProcess.length} unprocessed filings for forms: ${forms}`
      );
      return { success: true };
    }

    if (formsToProcess.length) {
      const wf = context.own(new Workflow());
      const loop = wf.map({ concurrencyLimit: 10, maxIterations: formsToProcess.length });
      loop.pipe(new ProcessAccessionDocFormTask());
      loop.endMap();
      await wf.run({
        accessionNumber: formsToProcess.map((f) => f.accession_number),
        cik: formsToProcess.map((f) => f.cik),
        form: formsToProcess.map((f) => f.form!),
        fileName: formsToProcess.map((f) => f.primary_doc.replaceAll(/^(xsl[^\/]+\/)/g, "")),
      });
    }
    return { success: true };
  }
}
