//    *******************************************************************************
//    *   PODLEY.AI: Your Agentic AI library                                        *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { Form } from "../Form";

export class Form_1_K extends Form {
  static readonly name = "Annual Report (Regulation A)";
  static readonly description = "Annual report pursuant to Regulation A.";
  static readonly forms = ["1-K", "1-K/A"] as const;
}
