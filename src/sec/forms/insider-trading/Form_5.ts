/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import Value from "typebox/value";
import { Form } from "../Form";
import {
  OwnershipDocument,
  OwnershipDocumentSchema,
  OwnershipDocumentSubmission,
  OwnershipDocumentSubmissionSchema,
} from "./OwnershipDocument.schema";

export class Form_5 extends Form {
  static readonly name = "Annual Statement of Beneficial Ownership";
  static readonly description =
    "An annual statement of ownership of securities filed by every director, officer, or owner of more than ten percent of a class of equity securities.";
  static readonly forms = ["5", "5/A"] as const;

  static async parse(
    form: (typeof Form_5.forms)[number],
    xml: string
  ): Promise<OwnershipDocument> {
    if (!Form_5.forms.includes(form)) {
      throw new Error(`Invalid form: ${form}`);
    }
    const parser = Form_5.getParser(OwnershipDocumentSubmissionSchema);
    const json = parser.parse(xml) as OwnershipDocumentSubmission;
    return Value.Convert(OwnershipDocumentSchema, json.ownershipDocument) as OwnershipDocument;
  }
}
