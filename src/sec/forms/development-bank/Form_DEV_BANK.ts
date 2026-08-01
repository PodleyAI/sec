/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Form } from "../Form";

export class Form_DEV_BANK extends Form {
  static readonly name = "Development Bank Filing";
  static readonly description =
    "Filing by an international financial institution exempt from Securities Act registration, recorded against an 083- file number. The code identifies the institution: ADB (Asian Development Bank), AFDB (African Development Bank), EBRD (European Bank for Reconstruction and Development), IADB (Inter-American Development Bank) and IFC (International Finance Corporation). BW-2 and BW-3 are the reports of the International Bank for Reconstruction and Development (World Bank).";
  static readonly forms = [
    "ADB",
    "AFDB",
    "AFDB/A",
    "EBRD",
    "EBRD/A",
    "IADB",
    "IFC",
    "BW-2",
    "BW-3",
  ] as const;
}
