//    *******************************************************************************
//    *   PODLEY.AI: Your Agentic AI library                                        *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { Form_APP_WD } from "./Form_APP_WD";
import { Form_APP_ORDR } from "./Form_APP_ORDR";
import { Form_APP_NTC } from "./Form_APP_NTC";
import { Form_APP_WDG } from "./Form_APP_WDG";

export const APPLICATION_WITHDRAWAL_FORM_NAMES_MAP = [
  ...Form_APP_WD.forms.map((form) => [form, Form_APP_WD] as const),
  ...Form_APP_ORDR.forms.map((form) => [form, Form_APP_ORDR] as const),
  ...Form_APP_NTC.forms.map((form) => [form, Form_APP_NTC] as const),
  ...Form_APP_WDG.forms.map((form) => [form, Form_APP_WDG] as const),
] as const;

export const APPLICATION_WITHDRAWAL_FORM_NAMES = APPLICATION_WITHDRAWAL_FORM_NAMES_MAP.map(
  ([form, Form]) => form
);
export type ApplicationWithdrawalForm = (typeof APPLICATION_WITHDRAWAL_FORM_NAMES)[number];
