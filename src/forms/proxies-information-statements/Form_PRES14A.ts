//    *******************************************************************************
//    *   PODLEY.AI: Your Agentic AI library                                        *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { Form } from "../Form";

export class Form_PRES14A extends Form {
  static readonly name = "Preliminary Proxy Statement for Special Meeting";
  static readonly description =
    "A preliminary proxy statement giving notice regarding a special meeting.";
  static readonly forms = ["PRES14A"] as const;
}
