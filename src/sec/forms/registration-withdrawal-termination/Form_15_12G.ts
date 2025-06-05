//    *******************************************************************************
//    *   PODLEY.AI: Your Agentic AI library                                        *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { Form } from "../Form";

export class Form_15_12G extends Form {
  static readonly name = "Section 12(g) Termination";
  static readonly description =
    "Certification of termination of registration of a class of security under Section 12(g) or notice of suspension of duty to file reports pursuant to Section 13 and 15(d) of the Securities Exchange Act. Section 12 (g) initial filing.";
  static readonly forms = ["15-12G", "15-12G/A"] as const;
}
