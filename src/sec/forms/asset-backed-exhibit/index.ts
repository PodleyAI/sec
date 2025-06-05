//    *******************************************************************************
//    *   PODLEY.AI: Your Agentic AI library                                        *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { Form_ABS_EE } from "./Form_ABS_EE";
import { Form_ABS_15G } from "./Form_ABS_15G";
import { Form_10D } from "./Form_10D";
import { Form_SF3 } from "./Form_SF3";
import { Form_SF1 } from "./Form_SF1";

export const ASSET_BACKED_EXHIBIT_FORM_NAMES_MAP = [
  ...Form_ABS_EE.forms.map((form) => [form, Form_ABS_EE] as const),
  ...Form_ABS_15G.forms.map((form) => [form, Form_ABS_15G] as const),
  ...Form_10D.forms.map((form) => [form, Form_10D] as const),
  ...Form_SF3.forms.map((form) => [form, Form_SF3] as const),
  ...Form_SF1.forms.map((form) => [form, Form_SF1] as const),
] as const;

export const ASSET_BACKED_EXHIBIT_FORM_NAMES = ASSET_BACKED_EXHIBIT_FORM_NAMES_MAP.map(
  ([form, Form]) => form
);
export type AssetBackedExhibitForm = (typeof ASSET_BACKED_EXHIBIT_FORM_NAMES)[number];
