//    *******************************************************************************
//    *   PODLEY.AI: Your Agentic AI library                                        *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { Form_ANNLRPT } from "./Form_ANNLRPT";
import { Form_QRTLYRPT } from "./Form_QRTLYRPT";
import { Form_DSTRBRPT } from "./Form_DSTRBRPT";

export const DEVELOPMENT_BANK_FORM_NAMES_MAP = [
  ...Form_ANNLRPT.forms.map((form) => [form, Form_ANNLRPT] as const),
  ...Form_QRTLYRPT.forms.map((form) => [form, Form_QRTLYRPT] as const),
  ...Form_DSTRBRPT.forms.map((form) => [form, Form_DSTRBRPT] as const),
] as const;

export const DEVELOPMENT_BANK_FORM_NAMES = DEVELOPMENT_BANK_FORM_NAMES_MAP.map(
  ([form, Form]) => form
);
export type DevelopmentBankForm = (typeof DEVELOPMENT_BANK_FORM_NAMES)[number];
