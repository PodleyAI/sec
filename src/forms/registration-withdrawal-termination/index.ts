//    *******************************************************************************
//    *   PODLEY.AI: Your Agentic AI library                                        *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { Form_15_12B } from "./Form_15_12B";
import { Form_15_12G } from "./Form_15_12G";
import { Form_15_15D } from "./Form_15_15D";
import { Form_15F_12B } from "./Form_15F_12B";
import { Form_15F_12G } from "./Form_15F_12G";
import { Form_15F_15D } from "./Form_15F_15D";
import { Form_24F_2TM } from "./Form_24F_2TM";
import { Form_8_A12B } from "./Form_8_A12B";
import { Form_8_A12G } from "./Form_8_A12G";
import { Form_8_B12B } from "./Form_8_B12B";
import { Form_8_B12G } from "./Form_8_B12G";
import { Form_8A12BEF } from "./Form_8A12BEF";
import { Form_8A12BT } from "./Form_8A12BT";
import { Form_RW } from "./Form_RW";
import { Form_AW } from "./Form_AW";

export const REGISTRATION_WITHDRAWAL_TERMINATION_FORMS_MAP = [
  ...Form_15_12B.forms.map((form) => [form, Form_15_12B] as const),
  ...Form_15_12G.forms.map((form) => [form, Form_15_12G] as const),
  ...Form_15_15D.forms.map((form) => [form, Form_15_15D] as const),
  ...Form_15F_12B.forms.map((form) => [form, Form_15F_12B] as const),
  ...Form_15F_12G.forms.map((form) => [form, Form_15F_12G] as const),
  ...Form_15F_15D.forms.map((form) => [form, Form_15F_15D] as const),
  ...Form_24F_2TM.forms.map((form) => [form, Form_24F_2TM] as const),
  ...Form_8_A12B.forms.map((form) => [form, Form_8_A12B] as const),
  ...Form_8_A12G.forms.map((form) => [form, Form_8_A12G] as const),
  ...Form_8_B12B.forms.map((form) => [form, Form_8_B12B] as const),
  ...Form_8_B12G.forms.map((form) => [form, Form_8_B12G] as const),
  ...Form_8A12BEF.forms.map((form) => [form, Form_8A12BEF] as const),
  ...Form_8A12BT.forms.map((form) => [form, Form_8A12BT] as const),
  ...Form_RW.forms.map((form) => [form, Form_RW] as const),
  ...Form_AW.forms.map((form) => [form, Form_AW] as const),
] as const;

export const REGISTRATION_WITHDRAWAL_TERMINATION_FORMS =
  REGISTRATION_WITHDRAWAL_TERMINATION_FORMS_MAP.map(([form, Form]) => form);

export type RegistrationWithdrawalTerminationForm =
  (typeof REGISTRATION_WITHDRAWAL_TERMINATION_FORMS)[number];
