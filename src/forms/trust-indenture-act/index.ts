//    *******************************************************************************
//    *   PODLEY.AI: Your Agentic AI library                                        *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { Form_305B2 } from "./Form_305B2";
import { Form_T_3 } from "./Form_T_3";

export const TRUST_INDENTURE_ACT_FORM_NAMES_MAP = [
  ...Form_305B2.forms.map((form) => [form, Form_305B2] as const),
  ...Form_T_3.forms.map((form) => [form, Form_T_3] as const),
] as const;

export const TRUST_INDENTURE_ACT_FORM_NAMES = TRUST_INDENTURE_ACT_FORM_NAMES_MAP.map(
  ([form, Form]) => form
);
export type TrustIndentureActForm = (typeof TRUST_INDENTURE_ACT_FORM_NAMES)[number];
