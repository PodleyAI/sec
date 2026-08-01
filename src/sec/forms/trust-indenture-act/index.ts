/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Form_305B2 } from "./Form_305B2";
import { Form_T_3 } from "./Form_T_3";
import { Form_T_6 } from "./Form_T_6";
import { Form_39_TIA } from "./Form_39_TIA";

export const TRUST_INDENTURE_ACT_FORM_NAMES_MAP = [
  ...Form_305B2.forms.map((form) => [form, Form_305B2] as const),
  ...Form_T_3.forms.map((form) => [form, Form_T_3] as const),
  ...Form_T_6.forms.map((form) => [form, Form_T_6] as const),
  ...Form_39_TIA.forms.map((form) => [form, Form_39_TIA] as const),
] as const;

export const TRUST_INDENTURE_ACT_FORM_NAMES = TRUST_INDENTURE_ACT_FORM_NAMES_MAP.map(
  ([form, Form]) => form
);
export type TrustIndentureActForm = (typeof TRUST_INDENTURE_ACT_FORM_NAMES)[number];
