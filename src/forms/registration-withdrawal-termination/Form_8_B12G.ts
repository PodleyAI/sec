//    *******************************************************************************
//    *   PODLEY.AI: Your Agentic AI library                                        *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { Form } from "../Form";

export class Form_8_B12G extends Form {
  static readonly name = "Registration of Securities on Form 8-B";
  static readonly description =
    "Registration of securities pursuant to Section 12(g) of the Securities Exchange Act of 1934";
  static readonly forms = ["8-B12G", "8-B12G/A"] as const;
}
