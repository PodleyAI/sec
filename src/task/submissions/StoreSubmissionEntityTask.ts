//    *******************************************************************************
//    *   PODLEY.AI: Your Agentic AI library                                        *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { IExecuteContext, Task, TaskAbortedError, TaskError } from "@podley/task-graph";
import { TObject, Type } from "@sinclair/typebox";
import { EntityRepo } from "../../storage/entity/EntityRepo";
import type { Entity } from "../../storage/entity/EntitySchema";
import { FetchSubmissionsOutput, FetchSubmissionsTask } from "./FetchSubmissionsTask";

export type StoreSubmissionEntityTaskInput = FetchSubmissionsOutput;

export type StoreSubmissionEntityTaskOutput = {
  success: boolean;
};

export class StoreSubmissionEntityTask extends Task<
  StoreSubmissionEntityTaskInput,
  StoreSubmissionEntityTaskOutput
> {
  static readonly type = "StoreSubmissionEntityTask";
  static readonly category = "SEC";
  static readonly cacheable = false;

  static inputSchema(): TObject {
    return FetchSubmissionsTask.outputSchema();
  }

  static outputSchema(): TObject {
    return Type.Object({
      success: Type.Boolean({ title: "Successful" }),
    });
  }

  async execute(
    input: StoreSubmissionEntityTaskInput,
    context: IExecuteContext
  ): Promise<StoreSubmissionEntityTaskOutput> {
    if (context.signal?.aborted) {
      throw new TaskAbortedError();
    }
    let { submission } = input;
    if (Array.isArray(submission)) {
      submission = submission[0];
    }
    if (!submission) throw new TaskError("No submission data");

    // Transform submission data to Entity schema
    const entity: Entity = {
      cik: submission.cik,
      name: submission.name,
      type: submission.entityType,
      sic: submission.sic ? parseInt(submission.sic, 10) : null,
      ein: submission.ein,
      description: submission.description,
      website: submission.website,
      investor_website: submission.investorWebsite,
      category: submission.category,
      fiscal_year: submission.fiscalYearEnd,
      state_incorporation: submission.stateOfIncorporation,
      state_incorporation_desc: submission.stateOfIncorporationDescription,
    };

    const submissionRepo = new EntityRepo();
    await submissionRepo.saveEntity(entity);

    return { success: true };
  }
}
