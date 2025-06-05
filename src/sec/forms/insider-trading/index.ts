//    *******************************************************************************
//    *   PODLEY.AI: Your Agentic AI library                                        *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { Form_3 } from "./Form_3";
import { Form_4 } from "./Form_4";
import { Form_5 } from "./Form_5";
import { Form_144 } from "./Form_144";

export const INSIDER_TRADING_FORM_NAMES_MAP = [
  ...Form_3.forms.map((form) => [form, Form_3] as const),
  ...Form_4.forms.map((form) => [form, Form_4] as const),
  ...Form_5.forms.map((form) => [form, Form_5] as const),
  ...Form_144.forms.map((form) => [form, Form_144] as const),
] as const;

export const INSIDER_TRADING_FORM_NAMES = INSIDER_TRADING_FORM_NAMES_MAP.map(
  ([form, Form]) => form
);
export type InsiderTradingForm = (typeof INSIDER_TRADING_FORM_NAMES)[number];
