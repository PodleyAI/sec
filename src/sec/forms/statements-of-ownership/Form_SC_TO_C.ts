//    *******************************************************************************
//    *   PODLEY.AI: Your Agentic AI library                                        *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { Form } from "../Form";

export class Form_SC_TO_C extends Form {
  static readonly name = "Tender Offer Statement";
  static readonly description =
    "This filing is made by a person making a tender offer for securities of a public company.";
  static readonly forms = ["SC TO-C", "SC TO-C/A"] as const;
}
