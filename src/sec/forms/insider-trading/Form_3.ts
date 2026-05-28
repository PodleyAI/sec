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

export class Form_3 extends Form {
  static readonly name = "Initial Statement of Beneficial Ownership";
  static readonly description =
    "An initial filing of equity securities filed by every director, officer, or owner of more than ten percent of a class of equity securities.";
  static readonly forms = ["3", "3/A"] as const;

  static async parse(
    form: (typeof Form_3.forms)[number],
    xml: string
  ): Promise<OwnershipDocument> {
    if (!Form_3.forms.includes(form)) {
      throw new Error(`Invalid form: ${form}`);
    }
    const parser = Form_3.getParser(OwnershipDocumentSubmissionSchema);
    const json = parser.parse(xml) as OwnershipDocumentSubmission;
    return Value.Convert(OwnershipDocumentSchema, json.ownershipDocument) as OwnershipDocument;
  }
}
