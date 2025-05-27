//    *******************************************************************************
//    *   PODLEY.AI: Your Agentic AI library                                        *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { Form } from "../Form";

export class Form_485B24E extends Form {
  static readonly name = "Post-Effective Amendment to Registration Statement";
  static readonly description =
    "Post-effective amendment to registration statement filed pursuant to Rule 485(b) and Rule 24e-2 under the Investment Company Act of 1940";
  static readonly forms = ["485B24E"] as const;
}
