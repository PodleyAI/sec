//    *******************************************************************************
//    *   PODLEY.AI: Your Agentic AI library                                        *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { Form_SC_13D } from "./Form_SC_13D";
import { Form_SC_13G } from "./Form_SC_13G";
import { Form_SC_13E1 } from "./Form_SC_13E1";
import { Form_SC_13E3 } from "./Form_SC_13E3";
import { Form_SC_13E4 } from "./Form_SC_13E4";
import { Form_SC_13E4F } from "./Form_SC_13E4F";
import { Form_SC_14D1 } from "./Form_SC_14D1";
import { Form_SC_14D1F } from "./Form_SC_14D1F";
import { Form_SC_14D9 } from "./Form_SC_14D9";
import { Form_SC_14F1 } from "./Form_SC_14F1";
import { Form_SC_14N } from "./Form_SC_14N";
import { Form_SC_TO_C } from "./Form_SC_TO_C";
import { Form_SC_TO_I } from "./Form_SC_TO_I";
import { Form_SC_TO_T } from "./Form_SC_TO_T";
import { Form_SC14D9C } from "./Form_SC14D9C";
import { Form_SC14D9F } from "./Form_SC14D9F";
import { Form_SC14D1F } from "./Form_SC14D1F";

export const STATEMENTS_OF_OWNERSHIP_FORMS_MAP = [
  ...Form_SC_13D.forms.map((form) => [form, Form_SC_13D] as const),
  ...Form_SC_13G.forms.map((form) => [form, Form_SC_13G] as const),
  ...Form_SC_13E1.forms.map((form) => [form, Form_SC_13E1] as const),
  ...Form_SC_13E3.forms.map((form) => [form, Form_SC_13E3] as const),
  ...Form_SC_13E4.forms.map((form) => [form, Form_SC_13E4] as const),
  ...Form_SC_13E4F.forms.map((form) => [form, Form_SC_13E4F] as const),
  ...Form_SC_14D1.forms.map((form) => [form, Form_SC_14D1] as const),
  ...Form_SC_14D1F.forms.map((form) => [form, Form_SC_14D1F] as const),
  ...Form_SC_14D9.forms.map((form) => [form, Form_SC_14D9] as const),
  ...Form_SC_14F1.forms.map((form) => [form, Form_SC_14F1] as const),
  ...Form_SC_14N.forms.map((form) => [form, Form_SC_14N] as const),
  ...Form_SC_TO_C.forms.map((form) => [form, Form_SC_TO_C] as const),
  ...Form_SC_TO_I.forms.map((form) => [form, Form_SC_TO_I] as const),
  ...Form_SC_TO_T.forms.map((form) => [form, Form_SC_TO_T] as const),
  ...Form_SC14D1F.forms.map((form) => [form, Form_SC14D1F] as const),
  ...Form_SC14D9C.forms.map((form) => [form, Form_SC14D9C] as const),
  ...Form_SC14D9F.forms.map((form) => [form, Form_SC14D9F] as const),
] as const;

export const STATEMENTS_OF_OWNERSHIP_FORMS = STATEMENTS_OF_OWNERSHIP_FORMS_MAP.map(
  ([form, Form]) => form
);

export type StatementOfOwnershipForm = (typeof STATEMENTS_OF_OWNERSHIP_FORMS)[number];
