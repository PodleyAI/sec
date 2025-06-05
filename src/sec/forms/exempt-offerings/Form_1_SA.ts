//    *******************************************************************************
//    *   PODLEY.AI: Your Agentic AI library                                        *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { Form } from "../Form";

export class Form_1_SA extends Form {
  static readonly name = "Semiannual Report (Regulation A)";
  static readonly description = "Semiannual report pursuant to Regulation A.";
  static readonly forms = ["1-SA", "1-SA/A"] as const;
}
