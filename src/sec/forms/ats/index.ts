//    *******************************************************************************
//    *   PODLEY.AI: Your Agentic AI library                                        *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { Form_ATS_N } from "./Form_ATS_N";

export const ATS_FORM_NAMES_MAP = [
  ...Form_ATS_N.forms.map((form) => [form, Form_ATS_N] as const),
] as const;

export const ATS_FORM_NAMES = ATS_FORM_NAMES_MAP.map(([form, Form]) => form);

export type AtsForm = (typeof ATS_FORM_NAMES)[number];
