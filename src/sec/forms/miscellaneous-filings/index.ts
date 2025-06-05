//    *******************************************************************************
//    *   PODLEY.AI: Your Agentic AI library                                        *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { Form_8_K } from "./Form_8_K";
import { Form_N_30B_2 } from "./Form_N_30B_2";
import { Form_2_E } from "./Form_2_E";
import { Form_SP_15D2 } from "./Form_SP_15D2";
import { Form_NT_15D2 } from "./Form_NT_15D2";
import { Form_6_K } from "./Form_6_K";
import { Form_8_K12B } from "./Form_8_K12B";
import { Form_8_K12G3 } from "./Form_8_K12G3";
import { Form_8_K15D5 } from "./Form_8_K15D5";
import { Form_BULK } from "./Form_BULK";
import { Form_SD } from "./Form_SD";
import { Form_TH } from "./Form_TH";
import { Form_12G3_2B } from "./Form_12G3_2B";
import { Form_REVOKED } from "./Form_REVOKED";
import { Form_DEL_AM } from "./Form_DEL_AM";
import { Form_CERT } from "./Form_CERT";
import { Form_487 } from "./Form_487";
import { Form_485A24E } from "./Form_485A24E";
import { Form_485A24F } from "./Form_485A24F";
import { Form_485APOS } from "./Form_485APOS";
import { Form_485B24E } from "./Form_485B24E";
import { Form_485B24F } from "./Form_485B24F";
import { Form_485BPOS } from "./Form_485BPOS";
import { Form_485BXT } from "./Form_485BXT";
import { Form_AW_WD } from "./Form_AW_WD";
import { Form_SUPPL } from "./Form_SUPPL";
import { Form_SE } from "./Form_SE";

export const MISCELLANEOUS_FILINGS_FORM_NAMES_MAP = [
  ...Form_AW_WD.forms.map((form) => [form, Form_AW_WD] as const),
  ...Form_SUPPL.forms.map((form) => [form, Form_SUPPL] as const),
  ...Form_8_K.forms.map((form) => [form, Form_8_K] as const),
  ...Form_N_30B_2.forms.map((form) => [form, Form_N_30B_2] as const),
  ...Form_2_E.forms.map((form) => [form, Form_2_E] as const),
  ...Form_SP_15D2.forms.map((form) => [form, Form_SP_15D2] as const),
  ...Form_NT_15D2.forms.map((form) => [form, Form_NT_15D2] as const),
  ...Form_6_K.forms.map((form) => [form, Form_6_K] as const),
  ...Form_8_K12B.forms.map((form) => [form, Form_8_K12B] as const),
  ...Form_8_K12G3.forms.map((form) => [form, Form_8_K12G3] as const),
  ...Form_8_K15D5.forms.map((form) => [form, Form_8_K15D5] as const),
  ...Form_BULK.forms.map((form) => [form, Form_BULK] as const),
  ...Form_SD.forms.map((form) => [form, Form_SD] as const),
  ...Form_TH.forms.map((form) => [form, Form_TH] as const),
  ...Form_12G3_2B.forms.map((form) => [form, Form_12G3_2B] as const),
  ...Form_REVOKED.forms.map((form) => [form, Form_REVOKED] as const),
  ...Form_DEL_AM.forms.map((form) => [form, Form_DEL_AM] as const),
  ...Form_CERT.forms.map((form) => [form, Form_CERT] as const),
  ...Form_487.forms.map((form) => [form, Form_487] as const),
  ...Form_485A24E.forms.map((form) => [form, Form_485A24E] as const),
  ...Form_485A24F.forms.map((form) => [form, Form_485A24F] as const),
  ...Form_485APOS.forms.map((form) => [form, Form_485APOS] as const),
  ...Form_485B24E.forms.map((form) => [form, Form_485B24E] as const),
  ...Form_485B24F.forms.map((form) => [form, Form_485B24F] as const),
  ...Form_485BPOS.forms.map((form) => [form, Form_485BPOS] as const),
  ...Form_485BXT.forms.map((form) => [form, Form_485BXT] as const),
  ...Form_SE.forms.map((form) => [form, Form_SE] as const),
] as const;

export const MISCELLANEOUS_FILINGS_FORM_NAMES = MISCELLANEOUS_FILINGS_FORM_NAMES_MAP.map(
  ([form, Form]) => form
);
export type MiscellaneousFilingForm = (typeof MISCELLANEOUS_FILINGS_FORM_NAMES)[number];
