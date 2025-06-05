//    *******************************************************************************
//    *   PODLEY.AI: Your Agentic AI library                                        *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { IExecuteContext, Task, TaskAbortedError, TaskError } from "@podley/task-graph";
import { TObject, Type } from "@sinclair/typebox";
import { AddressRepo } from "../../storage/address/AddressRepo";
import { PhoneRepo } from "../../storage/phone/PhoneRepo";
import { FetchSubmissionsOutput, FetchSubmissionsTask } from "./FetchSubmissionsTask";

export type StoreSubmissionContactInfoTaskInput = FetchSubmissionsOutput;

export type StoreSubmissionContactInfoTaskOutput = {
  success: boolean;
};

export class StoreSubmissionContactInfoTask extends Task<
  StoreSubmissionContactInfoTaskInput,
  StoreSubmissionContactInfoTaskOutput
> {
  static readonly type = "StoreSubmissionContactInfoTask";
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
    input: StoreSubmissionContactInfoTaskInput,
    context: IExecuteContext
  ): Promise<StoreSubmissionContactInfoTaskOutput> {
    if (context.signal?.aborted) {
      throw new TaskAbortedError();
    }
    let { submission } = input;
    if (Array.isArray(submission)) {
      submission = submission[0];
    }
    if (!submission) throw new TaskError("No submission data");
    const cik = submission.cik;

    let country_code = undefined;

    for (const [kind, address] of Object.entries(submission.addresses)) {
      if (address) {
        const addressRepo = new AddressRepo();
        const addressRecord = await addressRepo.saveAddress(address);
        if (!country_code && addressRecord.country_code) {
          country_code = addressRecord.country_code;
        }
        await addressRepo.saveRelatedEntity(addressRecord.address_hash_id, "entity:" + kind, cik);
      }
    }
    if (submission.phone) {
      const phoneRepo = new PhoneRepo();
      const phone = await phoneRepo.savePhone({
        phone_raw: submission.phone,
        country_code: country_code,
      });
      await phoneRepo.saveRelatedEntity(phone.international_number, "entity:contact", cik);
    }

    return { success: true };
  }
}
