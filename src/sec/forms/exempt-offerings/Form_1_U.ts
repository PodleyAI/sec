//    *******************************************************************************
//    *   PODLEY.AI: Your Agentic AI library                                        *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { Form } from "../Form";

export class Form_1_U extends Form {
  static readonly name = "Current Report (Regulation A)";
  static readonly description = "Current report pursuant to Regulation A.";
  static readonly forms = ["1-U", "1-U/A"] as const;
}
