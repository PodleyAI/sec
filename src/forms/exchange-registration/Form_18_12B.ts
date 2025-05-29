//    *******************************************************************************
//    *   PODLEY.AI: Your Agentic AI library                                        *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { Form } from "../Form";

export class Form_18_12B extends Form {
  static readonly name = "Registration of Securities of Foreign Private Issuers";
  static readonly description =
    "Registration statement for securities of foreign private issuers pursuant to Section 12(b) of the Securities Exchange Act of 1934";
  static readonly forms = ["18-12B", "18-12B/A"] as const;
}
