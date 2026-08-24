/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Type } from "typebox";
import { Task } from "workglow";
import { isFormParsingSupported } from "../../sec/forms/all-forms";
import { TypeSecCik } from "../../sec/submissions/EnititySubmissionSchema";
import { EntityRepo } from "../../storage/entity/EntityRepo";

export type ListFormTypesTaskInput = {
  readonly cik: number;
};

export type FormTypeCountRow = {
  readonly form: string;
  readonly count: number;
  readonly parse: "yes" | "no";
};

export type ListFormTypesTaskOutput = {
  /** One row per distinct form type in the CIK's stored filings, sorted by form. */
  readonly forms: FormTypeCountRow[];
  /** True when the local database has no filings for the CIK. */
  readonly empty: boolean;
};

/** Aggregates the form types present in a CIK's locally stored filings. */
export class ListFormTypesTask extends Task<ListFormTypesTaskInput, ListFormTypesTaskOutput> {
  static readonly type = "ListFormTypesTask";
  static readonly category = "SEC";
  static readonly title = "List stored form types";
  static readonly description =
    "Lists the distinct filing form types stored, optionally for one CIK";
  static readonly cacheable = false;

  public static inputSchema() {
    return Type.Object({
      cik: TypeSecCik(),
    });
  }

  public static outputSchema() {
    return Type.Object({
      forms: Type.Array(Type.Unknown()),
      empty: Type.Boolean(),
    });
  }

  async execute(input: ListFormTypesTaskInput): Promise<ListFormTypesTaskOutput> {
    const entityRepo = new EntityRepo();
    const filings = await entityRepo.getFilings(input.cik);
    const counts = new Map<string, number>();
    for (const f of filings) {
      if (f.form == null || f.form === "") continue;
      counts.set(f.form, (counts.get(f.form) ?? 0) + 1);
    }
    const forms: FormTypeCountRow[] = [...counts.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([form, count]) => ({
        form,
        count,
        parse: isFormParsingSupported(form) ? "yes" : "no",
      }));
    return { forms, empty: forms.length === 0 };
  }
}
