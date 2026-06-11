/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Form_1_A } from "./Form_1_A";
import { Form_1_A_W } from "./Form_1_A_W";
import { Form_1_K } from "./Form_1_K";
import { Form_1_SA } from "./Form_1_SA";
import { Form_1_U } from "./Form_1_U";
import { Form_1_Z } from "./Form_1_Z";
import { Form_1_Z_W } from "./Form_1_Z_W";
import { Form_DOS } from "./Form_DOS";
import { Form_DOSLTR } from "./Form_DOSLTR";
import { Form_C } from "./Form_C";
import { Form_D } from "./Form_D";
import { Form_REGDEX } from "./Form_REGDEX";
import { Form_253G1 } from "./Form_253G1";
import { Form_253G2 } from "./Form_253G2";
import { Form_253G3 } from "./Form_253G3";
import { Form_253G4 } from "./Form_253G4";
import { Form_QUALIF } from "./Form_QUALIF";
import { Form_TTW } from "./Form_TTW";

export const EXEMPT_OFFERING_FORM_NAMES_MAP = [
  ...Form_1_A.forms.map((form) => [form, Form_1_A] as const),
  ...Form_1_A_W.forms.map((form) => [form, Form_1_A_W] as const),
  ...Form_1_K.forms.map((form) => [form, Form_1_K] as const),
  ...Form_1_SA.forms.map((form) => [form, Form_1_SA] as const),
  ...Form_1_U.forms.map((form) => [form, Form_1_U] as const),
  ...Form_1_Z.forms.map((form) => [form, Form_1_Z] as const),
  ...Form_1_Z_W.forms.map((form) => [form, Form_1_Z_W] as const),
  ...Form_DOS.forms.map((form) => [form, Form_DOS] as const),
  ...Form_DOSLTR.forms.map((form) => [form, Form_DOSLTR] as const),
  ...Form_C.forms.map((form) => [form, Form_C] as const),
  ...Form_D.forms.map((form) => [form, Form_D] as const),
  ...Form_REGDEX.forms.map((form) => [form, Form_REGDEX] as const),
  ...Form_253G1.forms.map((form) => [form, Form_253G1] as const),
  ...Form_253G2.forms.map((form) => [form, Form_253G2] as const),
  ...Form_253G3.forms.map((form) => [form, Form_253G3] as const),
  ...Form_253G4.forms.map((form) => [form, Form_253G4] as const),
  ...Form_QUALIF.forms.map((form) => [form, Form_QUALIF] as const),
  ...Form_TTW.forms.map((form) => [form, Form_TTW] as const),
] as const;

export const EXEMPT_OFFERING_FORM_NAMES = EXEMPT_OFFERING_FORM_NAMES_MAP.map(
  ([form, Form]) => form
);
export type ExemptOfferingForm = (typeof EXEMPT_OFFERING_FORM_NAMES)[number];
