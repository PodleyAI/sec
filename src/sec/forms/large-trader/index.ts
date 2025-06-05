//    *******************************************************************************
//    *   PODLEY.AI: Your Agentic AI library                                        *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { Form_13H } from "./Form_13H";
import { Form_13H_Q } from "./Form_13H_Q";
import { Form_13H_A } from "./Form_13H_A";
import { Form_13H_I } from "./Form_13H_I";
import { Form_13H_R } from "./Form_13H_R";
import { Form_13H_T } from "./Form_13H_T";
import { Form_13FCONP } from "./Form_13FCONP";

export const LARGE_TRADER_FORM_NAMES_MAP = [
  ...Form_13H.forms.map((form) => [form, Form_13H] as const),
  ...Form_13H_Q.forms.map((form) => [form, Form_13H_Q] as const),
  ...Form_13H_A.forms.map((form) => [form, Form_13H_A] as const),
  ...Form_13H_I.forms.map((form) => [form, Form_13H_I] as const),
  ...Form_13H_R.forms.map((form) => [form, Form_13H_R] as const),
  ...Form_13H_T.forms.map((form) => [form, Form_13H_T] as const),
  ...Form_13FCONP.forms.map((form) => [form, Form_13FCONP] as const),
] as const;

export const LARGE_TRADER_FORM_NAMES = LARGE_TRADER_FORM_NAMES_MAP.map(([form, Form]) => form);
export type LargeTraderForm = (typeof LARGE_TRADER_FORM_NAMES)[number];
