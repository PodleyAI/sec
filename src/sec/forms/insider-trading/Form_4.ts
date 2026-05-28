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

export class Form_4 extends Form {
  static readonly name = "Statement of Changes in Beneficial Ownership";
  static readonly description =
    "Any changes to a previously filed form 3 are reported in this filing.";
  static readonly forms = ["4", "4/A"] as const;

  static async parse(
    form: (typeof Form_4.forms)[number],
    xml: string
  ): Promise<OwnershipDocument> {
    if (!Form_4.forms.includes(form)) {
      throw new Error(`Invalid form: ${form}`);
    }
    const parser = Form_4.getParser(OwnershipDocumentSubmissionSchema);
    const json = parser.parse(xml) as OwnershipDocumentSubmission;
    return Value.Convert(OwnershipDocumentSchema, json.ownershipDocument) as OwnershipDocument;
  }
}
