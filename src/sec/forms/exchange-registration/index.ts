/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Form_1 } from "./Form_1";
import { Form_10_12B } from "./Form_10_12B";
import { Form_10_12G } from "./Form_10_12G";
import { Form_10SB12B } from "./Form_10SB12B";
import { Form_10SB12G } from "./Form_10SB12G";
import { Form_18_12B } from "./Form_18_12B";
import { Form_18_12G } from "./Form_18_12G";
import { Form_19B_4 } from "./Form_19B_4";

export const EXCHANGE_REGISTRATION_FORMS_MAP = [
  ...Form_1.forms.map((form) => [form, Form_1] as const),
  ...Form_10_12B.forms.map((form) => [form, Form_10_12B] as const),
  ...Form_10_12G.forms.map((form) => [form, Form_10_12G] as const),
  ...Form_10SB12B.forms.map((form) => [form, Form_10SB12B] as const),
  ...Form_10SB12G.forms.map((form) => [form, Form_10SB12G] as const),
  ...Form_18_12B.forms.map((form) => [form, Form_18_12B] as const),
  ...Form_18_12G.forms.map((form) => [form, Form_18_12G] as const),
  ...Form_19B_4.forms.map((form) => [form, Form_19B_4] as const),
] as const;

export const EXCHANGE_REGISTRATION_FORMS = EXCHANGE_REGISTRATION_FORMS_MAP.map(
  ([form, Form]) => form
);
export type ExchangeRegistrationForm = (typeof EXCHANGE_REGISTRATION_FORMS)[number];
