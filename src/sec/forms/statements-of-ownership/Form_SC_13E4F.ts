//    *******************************************************************************
//    *   PODLEY.AI: Your Agentic AI library                                        *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { Form } from "../Form";

export class Form_SC_13E4F extends Form {
  static readonly name = "Going Private Transaction";
  static readonly description = "This filing is made by an issuer that is going private.";
  static readonly forms = ["SC 13E4F", "SC 13E4F/A", "SC 13E-4F", "SC 13E-4F/A"] as const;
}
