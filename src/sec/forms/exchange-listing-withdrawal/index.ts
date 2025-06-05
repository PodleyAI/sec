//    *******************************************************************************
//    *   PODLEY.AI: Your Agentic AI library                                        *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { Form_25 } from "./Form_25";
import { Form_25NSE } from "./Form_25NSE";

export const EXCHANGE_LISTING_WITHDRAWAL_FORM_NAMES_MAP = [
  ...Form_25.forms.map((form) => [form, Form_25] as const),
  ...Form_25NSE.forms.map((form) => [form, Form_25NSE] as const),
] as const;

export const EXCHANGE_LISTING_WITHDRAWAL_FORM_NAMES =
  EXCHANGE_LISTING_WITHDRAWAL_FORM_NAMES_MAP.map(([form, Form]) => form);
export type ExchangeListingWithdrawalForm = (typeof EXCHANGE_LISTING_WITHDRAWAL_FORM_NAMES)[number];
