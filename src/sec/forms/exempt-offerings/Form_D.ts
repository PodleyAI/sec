//    *******************************************************************************
//    *   PODLEY.AI: Your Agentic AI library                                        *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { Value } from "@sinclair/typebox/value";
import { Readable } from "node:stream";
import { Form } from "../Form";
import { streamToString } from "../parse_util";
import { FormD, FormDSchema, FormDSubmission, FormDSubmissionSchema } from "./Form_D.schema";

export class Form_D extends Form {
  static readonly name = "Notice of Sales of Unregistered Securities";
  static readonly description = "Notice of sales of unregistered securities";
  static readonly forms = ["D", "D/A"] as const;

  static async parse(input: string | Readable): Promise<FormD> {
    const xml = typeof input === "string" ? input : await streamToString(input);
    const parser = Form_D.getParser(FormDSubmissionSchema);
    const json = parser.parse(xml) as FormDSubmission;
    const rawFormD = json.edgarSubmission;
    const formD = Value.Convert(FormDSchema, rawFormD);
    return formD as FormD;
  }
}

export type { FormD };
