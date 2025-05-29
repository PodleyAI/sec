//    *******************************************************************************
//    *   PODLEY.AI: Your Agentic AI library                                        *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { Form_424 } from "./Form_424";
import { Form_424B8 } from "./Form_424B8";
import { Form_424H } from "./Form_424H";
import { Form_425 } from "./Form_425";
import { Form_DRS } from "./Form_DRS";
import { Form_FWP } from "./Form_FWP";
import { Form_POS_AM } from "./Form_POS_AM";
import { Form_POS_AMI } from "./Form_POS_AMI";
import { Form_S_1 } from "./Form_S_1";
import { Form_S_2 } from "./Form_S_2";
import { Form_S_3 } from "./Form_S_3";
import { Form_S_3D } from "./Form_S_3D";
import { Form_S_4 } from "./Form_S_4";
import { Form_S_6 } from "./Form_S_6";
import { Form_S_6EL24 } from "./Form_S_6EL24";
import { Form_S_8 } from "./Form_S_8";
import { Form_S_11 } from "./Form_S_11";
import { Form_S_20 } from "./Form_S_20";
import { Form_SB } from "./Form_SB";
import { Form_SB_1 } from "./Form_SB_1";
import { Form_SB_2 } from "./Form_SB_2";
import { Form_S_3ASR } from "./Form_S_3ASR";
import { Form_POSASR } from "./Form_POSASR";
import { Form_POS462B } from "./Form_POS462B";
import { Form_POS462C } from "./Form_POS462C";
import { Form_486APOS } from "./Form_486APOS";
import { Form_486BPOS } from "./Form_486BPOS";
import { Form_POS_EX } from "./Form_POS_EX";
import { Form_POS_8C } from "./Form_POS_8C";
import { Form_POS_AMC } from "./Form_POS_AMC";
import { Form_486BXT } from "./Form_486BXT";

export const REGISTRATION_STATEMENT_FORM_NAMES_MAP = [
  ...Form_424.forms.map((form) => [form, Form_424] as const),
  ...Form_424B8.forms.map((form) => [form, Form_424B8] as const),
  ...Form_424H.forms.map((form) => [form, Form_424H] as const),
  ...Form_425.forms.map((form) => [form, Form_425] as const),
  ...Form_DRS.forms.map((form) => [form, Form_DRS] as const),
  ...Form_FWP.forms.map((form) => [form, Form_FWP] as const),
  ...Form_POS_AM.forms.map((form) => [form, Form_POS_AM] as const),
  ...Form_POS_AMI.forms.map((form) => [form, Form_POS_AMI] as const),
  ...Form_S_1.forms.map((form) => [form, Form_S_1] as const),
  ...Form_S_2.forms.map((form) => [form, Form_S_2] as const),
  ...Form_S_3.forms.map((form) => [form, Form_S_3] as const),
  ...Form_S_3D.forms.map((form) => [form, Form_S_3D] as const),
  ...Form_S_4.forms.map((form) => [form, Form_S_4] as const),
  ...Form_S_6.forms.map((form) => [form, Form_S_6] as const),
  ...Form_S_6EL24.forms.map((form) => [form, Form_S_6EL24] as const),
  ...Form_S_8.forms.map((form) => [form, Form_S_8] as const),
  ...Form_S_11.forms.map((form) => [form, Form_S_11] as const),
  ...Form_S_20.forms.map((form) => [form, Form_S_20] as const),
  ...Form_SB.forms.map((form) => [form, Form_SB] as const),
  ...Form_SB_1.forms.map((form) => [form, Form_SB_1] as const),
  ...Form_SB_2.forms.map((form) => [form, Form_SB_2] as const),
  ...Form_S_3ASR.forms.map((form) => [form, Form_S_3ASR] as const),
  ...Form_POSASR.forms.map((form) => [form, Form_POSASR] as const),
  ...Form_POS462B.forms.map((form) => [form, Form_POS462B] as const),
  ...Form_POS462C.forms.map((form) => [form, Form_POS462C] as const),
  ...Form_486APOS.forms.map((form) => [form, Form_486APOS] as const),
  ...Form_486BPOS.forms.map((form) => [form, Form_486BPOS] as const),
  ...Form_POS_EX.forms.map((form) => [form, Form_POS_EX] as const),
  ...Form_POS_8C.forms.map((form) => [form, Form_POS_8C] as const),
  ...Form_POS_AMC.forms.map((form) => [form, Form_POS_AMC] as const),
  ...Form_486BXT.forms.map((form) => [form, Form_486BXT] as const),
] as const;

export const REGISTRATION_STATEMENT_FORM_NAMES = REGISTRATION_STATEMENT_FORM_NAMES_MAP.map(
  ([form, Form]) => form
);
export type RegistrationStatementForm = (typeof REGISTRATION_STATEMENT_FORM_NAMES)[number];
