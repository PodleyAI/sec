//    *******************************************************************************
//    *   PODLEY.AI: Your Agentic AI library                                        *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { Form } from "../Form";

export class Form_24F_2EL extends Form {
  static readonly name = "Annual Notice of Securities Sold";
  static readonly description =
    "Annual notice of securities sold by open-end management investment companies pursuant to Rule 24f-2 under the Investment Company Act of 1940";
  static readonly forms = ["24F-2EL", "24F-2EL/A"] as const;
}
