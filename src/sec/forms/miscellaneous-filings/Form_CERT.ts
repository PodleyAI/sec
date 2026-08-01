/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Form } from "../Form";

export class Form_CERT extends Form {
  static readonly name = "Certification";
  static readonly description =
    "Certification of compliance with the requirements of Section 12(g) of the Securities Exchange Act of 1934";
  static readonly forms = [
    "CERT",
    "CERTNYS",
    "CERTNYS/A",
    "CERTARCA",
    "CERTARCA/A",
    "CERTPAC",
    "CERTNAS",
    "CERTCBO",
    "CERTAMX",
    "CERTPAC/A",
    "CERTCBO/A",
    "CERTNAS/A",
    "CERTAMX/A",
    "CERTBATS",
    "CERTBATS/A",
    "CERTBSE",
    "CERTBSE/A",
    // Two further exchange codes appear in the EDGAR record.
    "CERTCSE",
    "CERTPBS",
  ] as const;
}
