//    *******************************************************************************
//    *   PODLEY.AI: Your Agentic AI library                                        *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { Form_CORRESP } from "./Form_CORRESP";
import { Form_IRANNOTICE } from "./Form_IRANNOTICE";
import { Form_NO_ACT } from "./Form_NO_ACT";
import { Form_SEC_STAFF_ACTION } from "./Form_SEC_STAFF_ACTION";
import { Form_SEC_STAFF_LETTER } from "./Form_SEC_STAFF_LETTER";
import { Form_EFFECT } from "./Form_EFFECT";
import { Form_UPLOAD } from "./Form_UPLOAD";
import { Form_CT_ORDER } from "./Form_CT_ORDER";

export const CORRESPONDENCE_SUBMISSION_TYPE_FORM_NAMES_MAP = [
  ...Form_CORRESP.forms.map((form) => [form, Form_CORRESP] as const),
  ...Form_IRANNOTICE.forms.map((form) => [form, Form_IRANNOTICE] as const),
  ...Form_NO_ACT.forms.map((form) => [form, Form_NO_ACT] as const),
  ...Form_SEC_STAFF_ACTION.forms.map((form) => [form, Form_SEC_STAFF_ACTION] as const),
  ...Form_SEC_STAFF_LETTER.forms.map((form) => [form, Form_SEC_STAFF_LETTER] as const),
  ...Form_EFFECT.forms.map((form) => [form, Form_EFFECT] as const),
  ...Form_UPLOAD.forms.map((form) => [form, Form_UPLOAD] as const),
  ...Form_CT_ORDER.forms.map((form) => [form, Form_CT_ORDER] as const),
] as const;

export const CORRESPONDENCE_SUBMISSION_TYPE_FORM_NAMES =
  CORRESPONDENCE_SUBMISSION_TYPE_FORM_NAMES_MAP.map(([form, Form]) => form);

export type CorrespondenceSubmissionTypeForm =
  (typeof CORRESPONDENCE_SUBMISSION_TYPE_FORM_NAMES)[number];
