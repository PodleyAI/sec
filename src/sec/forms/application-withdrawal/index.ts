/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Form_APP_WD } from "./Form_APP_WD";
import { Form_APP_ORDR } from "./Form_APP_ORDR";
import { Form_APP_NTC } from "./Form_APP_NTC";
import { Form_APP_WDG } from "./Form_APP_WDG";
import { Form_ADN_MTL } from "./Form_ADN_MTL";

export const APPLICATION_WITHDRAWAL_FORM_NAMES_MAP = [
  ...Form_APP_WD.forms.map((form) => [form, Form_APP_WD] as const),
  ...Form_APP_ORDR.forms.map((form) => [form, Form_APP_ORDR] as const),
  ...Form_APP_NTC.forms.map((form) => [form, Form_APP_NTC] as const),
  ...Form_APP_WDG.forms.map((form) => [form, Form_APP_WDG] as const),
  ...Form_ADN_MTL.forms.map((form) => [form, Form_ADN_MTL] as const),
] as const;

export const APPLICATION_WITHDRAWAL_FORM_NAMES = APPLICATION_WITHDRAWAL_FORM_NAMES_MAP.map(
  ([form, Form]) => form
);
export type ApplicationWithdrawalForm = (typeof APPLICATION_WITHDRAWAL_FORM_NAMES)[number];
