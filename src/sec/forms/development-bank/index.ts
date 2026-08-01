/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Form_ANNLRPT } from "./Form_ANNLRPT";
import { Form_QRTLYRPT } from "./Form_QRTLYRPT";
import { Form_DSTRBRPT } from "./Form_DSTRBRPT";
import { Form_DEV_BANK } from "./Form_DEV_BANK";

export const DEVELOPMENT_BANK_FORM_NAMES_MAP = [
  ...Form_ANNLRPT.forms.map((form) => [form, Form_ANNLRPT] as const),
  ...Form_QRTLYRPT.forms.map((form) => [form, Form_QRTLYRPT] as const),
  ...Form_DSTRBRPT.forms.map((form) => [form, Form_DSTRBRPT] as const),
  ...Form_DEV_BANK.forms.map((form) => [form, Form_DEV_BANK] as const),
] as const;

export const DEVELOPMENT_BANK_FORM_NAMES = DEVELOPMENT_BANK_FORM_NAMES_MAP.map(
  ([form, Form]) => form
);
export type DevelopmentBankForm = (typeof DEVELOPMENT_BANK_FORM_NAMES)[number];
