//    *******************************************************************************
//    *   PODLEY.AI: Your Agentic AI library                                        *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { Form } from "../Form";

export class Form_1_Z extends Form {
  static readonly name = "Exit Report (Regulation A)";
  static readonly description = "Exit report pursuant to Regulation A.";
  static readonly forms = ["1-Z", "1-Z/A"] as const;
}
