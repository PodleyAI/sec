/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Type } from "typebox";
import { IExecuteContext, Task, TaskAbortedError, TaskError } from "workglow";
import { AddressImport } from "../../storage/address/AddressNormalization";
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

  static inputSchema() {
    return FetchSubmissionsTask.outputSchema();
  }

  static outputSchema() {
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
        const addressRecord = await addressRepo.saveAddress(address as AddressImport);
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
