/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Static, Type } from "typebox";
import { DataPortSchemaObject } from "workglow";
import { SecCachedFetchTask } from "../fetch/SecCachedFetchTask";
import {
  FullCompanySubmissionSchema,
  TypeSecCik,
} from "../../sec/submissions/EnititySubmissionSchema";
import { TypeOptionalSecDate } from "../../util/parseDate";

// NOTE: company submissions are mutable, so we need to pass in a date to break the cache

const SecFetchSubmissionsTaskInputSchema = () =>
  Type.Object({
    cik: TypeSecCik(),
    file: Type.Optional(Type.String()),
    date: TypeOptionalSecDate(),
  });

export type SecFetchSubmissionsTaskInput = Static<
  ReturnType<typeof SecFetchSubmissionsTaskInputSchema>
>;

const SecFetchSubmissionsTaskOutputSchema = () =>
  Type.Object({
    json: FullCompanySubmissionSchema(),
  });

export type SecFetchSubmissionsTaskOutput = Static<
  ReturnType<typeof SecFetchSubmissionsTaskOutputSchema>
>;

export class SecFetchSubmissionsTask extends SecCachedFetchTask<
  SecFetchSubmissionsTaskInput,
  SecFetchSubmissionsTaskOutput
> {
  static readonly type = "SecFetchSubmissionsTask";
  static readonly category = "Hidden";
  static readonly immutable = false;

  public static inputSchema() {
    return SecFetchSubmissionsTaskInputSchema() as DataPortSchemaObject;
  }

  public static outputSchema() {
    return SecFetchSubmissionsTaskOutputSchema() as DataPortSchemaObject;
  }

  inputToFileName(input: SecFetchSubmissionsTaskInput): string {
    const cik = input.cik.toString().padStart(10, "0");
    const fileName = input.file || `CIK${cik}.json`;
    return `submissions/${fileName}`;
  }
  inputToUrl(input: SecFetchSubmissionsTaskInput): string {
    const cik = input.cik.toString().padStart(10, "0");
    const fileName = input.file || `CIK${cik}.json`;
    return `https://data.sec.gov/submissions/${fileName}${input.date ? `?date=${input.date}` : ""}`;
  }
}
