/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Static, Type } from "typebox";
import { CIK_TYPE, SCHEMA_VERSION_TYPE } from "../FormSchemaUtil";

export const SubTypeList = Type.Union([Type.Literal("8-K"), Type.Literal("8-K/A")], {
  description: "Submission Type Form",
});

const SIGNATURE_TYPE = Type.Object({
  signatureName: Type.String({ minLength: 1, maxLength: 150 }),
  signatureTitle: Type.Optional(Type.String({ maxLength: 150 })),
  signatureDate: Type.Optional(Type.String()),
});

export type Form8KSignature = Static<typeof SIGNATURE_TYPE>;

const SIGNATURE_BLOCK_TYPE = Type.Object({
  signature: Type.Union([SIGNATURE_TYPE, Type.Array(SIGNATURE_TYPE)]),
});

const FILER_INFO_TYPE = Type.Object({
  filerCik: Type.Optional(CIK_TYPE),
  filerCcc: Type.Optional(Type.String({ maxLength: 8 })),
});

const HEADER_DATA_TYPE = Type.Object({
  filerInfo: Type.Optional(FILER_INFO_TYPE),
});

const FORM_DATA_TYPE = Type.Object({
  items: Type.Optional(
    Type.Object({
      item: Type.Union([Type.String(), Type.Array(Type.String())]),
    })
  ),
  periodOfReport: Type.Optional(Type.String()),
  signatureBlock: Type.Optional(SIGNATURE_BLOCK_TYPE),
});

/**
 * Schema for 8-K filings submitted as structured XML through EDGAR.
 */
export const Form8KSchema = Type.Object({
  schemaVersion: Type.Optional(SCHEMA_VERSION_TYPE),
  submissionType: Type.Optional(SubTypeList),
  headerData: Type.Optional(HEADER_DATA_TYPE),
  formData: Type.Optional(FORM_DATA_TYPE),
});

export type Form8K = Static<typeof Form8KSchema>;

export const Form8KSubmissionSchema = Type.Object({
  edgarSubmission: Form8KSchema,
});

export type Form8KSubmission = Static<typeof Form8KSubmissionSchema>;
