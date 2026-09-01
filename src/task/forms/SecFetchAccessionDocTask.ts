/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Type } from "typebox";
import { DataPortSchemaObject, TaskInput } from "workglow";
import { TypeSecCik } from "../../sec/submissions/EnititySubmissionSchema";
import { SecCachedFetchTask } from "../fetch/SecCachedFetchTask";

// NOTE: accession documents are immutable, so we don't need to pass in a date for invalidation

export interface SecFetchAccessionDocTaskInput extends TaskInput {
  cik: number;
  accessionNumber: string;
  fileName: string;
}

export interface SecFetchAccessionDocTaskOutput extends TaskInput {
  accessionDoc: string;
}

export class SecFetchAccessionDocTask extends SecCachedFetchTask<SecFetchAccessionDocTaskInput> {
  static readonly type = "SecFetchAccessionDocTask";
  static readonly category = "Hidden";
  static readonly title = "Download filing document";
  static readonly immutable = true;

  public static inputSchema() {
    return Type.Object({
      cik: TypeSecCik(),
      accessionNumber: Type.String({
        title: "Accession Number",
        description: "The accession number of the document to fetch",
      }),
      fileName: Type.String({
        title: "File Name",
        description: "The name of the document to fetch",
      }),
    }) as DataPortSchemaObject;
  }

  inputToFileName(input: SecFetchAccessionDocTaskInput): string {
    return `accessiondocs/${input.cik
      .toString()
      .padStart(10, "0")}/${input.accessionNumber.replaceAll("-", "")}-${input.fileName}`;
  }
  inputToUrl(input: SecFetchAccessionDocTaskInput): string {
    return `https://www.sec.gov/Archives/edgar/data/${input.cik
      .toString()
      .padStart(10, "0")}/${input.accessionNumber.replaceAll("-", "")}/${input.fileName}`;
  }
}
