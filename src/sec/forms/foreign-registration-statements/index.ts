/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Form_20FR12B } from "./Form_20FR12B";
import { Form_20FR12G } from "./Form_20FR12G";
import { Form_CB } from "./Form_CB";
import { Form_F_1 } from "./Form_F_1";
import { Form_F_1MEF } from "./Form_F_1MEF";
import { Form_F_2 } from "./Form_F_2";
import { Form_F_2D } from "./Form_F_2D";
import { Form_F_2DPOS } from "./Form_F_2DPOS";
import { Form_F_2MEF } from "./Form_F_2MEF";
import { Form_F_3 } from "./Form_F_3";
import { Form_F_3ASR } from "./Form_F_3ASR";
import { Form_F_3D } from "./Form_F_3D";
import { Form_F_3DPOS } from "./Form_F_3DPOS";
import { Form_F_4 } from "./Form_F_4";
import { Form_F_4EF } from "./Form_F_4EF";
import { Form_F_6 } from "./Form_F_6";
import { Form_F_6_POS } from "./Form_F_6_POS";
import { Form_F_6EF } from "./Form_F_6EF";
import { Form_F_7 } from "./Form_F_7";
import { Form_F_8 } from "./Form_F_8";
import { Form_F_9 } from "./Form_F_9";
import { Form_F_9EF } from "./Form_F_9EF";
import { Form_F_10 } from "./Form_F_10";
import { Form_F_10EF } from "./Form_F_10EF";
import { Form_F_10POS } from "./Form_F_10POS";
import { Form_F_80 } from "./Form_F_80";
import { Form_F_N } from "./Form_F_N";
import { Form_F_X } from "./Form_F_X";

export const FOREIGN_REGISTRATION_FORM_NAMES_MAP = [
  ...Form_CB.forms.map((form) => [form, Form_CB] as const),
  ...Form_F_X.forms.map((form) => [form, Form_F_X] as const),
  ...Form_F_1.forms.map((form) => [form, Form_F_1] as const),
  ...Form_20FR12B.forms.map((form) => [form, Form_20FR12B] as const),
  ...Form_20FR12G.forms.map((form) => [form, Form_20FR12G] as const),
  ...Form_F_1MEF.forms.map((form) => [form, Form_F_1MEF] as const),
  ...Form_F_2.forms.map((form) => [form, Form_F_2] as const),
  ...Form_F_2D.forms.map((form) => [form, Form_F_2D] as const),
  ...Form_F_2DPOS.forms.map((form) => [form, Form_F_2DPOS] as const),
  ...Form_F_2MEF.forms.map((form) => [form, Form_F_2MEF] as const),
  ...Form_F_3.forms.map((form) => [form, Form_F_3] as const),
  ...Form_F_3ASR.forms.map((form) => [form, Form_F_3ASR] as const),
  ...Form_F_3D.forms.map((form) => [form, Form_F_3D] as const),
  ...Form_F_3DPOS.forms.map((form) => [form, Form_F_3DPOS] as const),
  ...Form_F_4.forms.map((form) => [form, Form_F_4] as const),
  ...Form_F_6.forms.map((form) => [form, Form_F_6] as const),
  ...Form_F_6_POS.forms.map((form) => [form, Form_F_6_POS] as const),
  ...Form_F_6EF.forms.map((form) => [form, Form_F_6EF] as const),
  ...Form_F_7.forms.map((form) => [form, Form_F_7] as const),
  ...Form_F_8.forms.map((form) => [form, Form_F_8] as const),
  ...Form_F_9.forms.map((form) => [form, Form_F_9] as const),
  ...Form_F_10.forms.map((form) => [form, Form_F_10] as const),
  ...Form_F_10EF.forms.map((form) => [form, Form_F_10EF] as const),
  ...Form_F_10POS.forms.map((form) => [form, Form_F_10POS] as const),
  ...Form_F_N.forms.map((form) => [form, Form_F_N] as const),
  ...Form_F_80.forms.map((form) => [form, Form_F_80] as const),
  ...Form_F_9EF.forms.map((form) => [form, Form_F_9EF] as const),
  ...Form_F_4EF.forms.map((form) => [form, Form_F_4EF] as const),
] as const;

export const FOREIGN_REGISTRATION_FORM_NAMES = FOREIGN_REGISTRATION_FORM_NAMES_MAP.map(
  ([form, Form]) => form
);
export type ForeignRegistrationStatementForm = (typeof FOREIGN_REGISTRATION_FORM_NAMES)[number];
