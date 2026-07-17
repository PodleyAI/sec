/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Type } from "typebox";
import { Task, type IExecuteContext } from "workglow";
import { TypeSecCik } from "../../sec/submissions/EnititySubmissionSchema";
import { TypeOptionalSecDate } from "../../util/parseDate";
import { fetchAndStoreCompanyFacts } from "./fetchAndStoreCompanyFacts";

export type FetchCompanyFactsForCikTaskInput = {
  readonly cik: number;
  readonly date?: string;
};

export type FetchCompanyFactsForCikTaskOutput = {
  readonly success: boolean;
};

/**
 * Fetches and stores company facts for a single CIK. Routes through the
 * orchestrator (not a raw Fetch→Store pipe) so the processed_facts outcome —
 * incl. NO_XBRL_FACTS on 404 — is recorded exactly once, same as the batch
 * update path.
 */
export class FetchCompanyFactsForCikTask extends Task<
  FetchCompanyFactsForCikTaskInput,
  FetchCompanyFactsForCikTaskOutput
> {
  static readonly type = "FetchCompanyFactsForCikTask";
  static readonly category = "SEC";
  static readonly title = "Fetch company facts";
  static readonly cacheable = false;

  public static inputSchema() {
    return Type.Object({
      cik: TypeSecCik(),
      date: TypeOptionalSecDate(),
    });
  }

  public static outputSchema() {
    return Type.Object({
      success: Type.Boolean(),
    });
  }

  async execute(
    input: FetchCompanyFactsForCikTaskInput,
    context: IExecuteContext
  ): Promise<FetchCompanyFactsForCikTaskOutput> {
    return await fetchAndStoreCompanyFacts({ cik: input.cik, date: input.date }, context);
  }
}
