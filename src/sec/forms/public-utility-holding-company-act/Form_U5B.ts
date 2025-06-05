//    *******************************************************************************
//    *   PODLEY.AI: Your Agentic AI library                                        *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { Form } from "../Form";

export class Form_U5B extends Form {
  static readonly name = "Registration Statement";
  static readonly description =
    "Registration statement filed under section 5 of the Public Utility Holding Company Act.";
  static readonly forms = ["U5B", "U5B/A"] as const;
}
