/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Form_17AD_27 } from "./Form_17AD_27";
import { Form_TA_1 } from "./Form_TA_1";
import { Form_TA_2 } from "./Form_TA_2";
import { Form_TA_W } from "./Form_TA_W";
import { Form_TACO } from "./Form_TACO";

export const TRANSFER_AGENT_FORM_NAMES_MAP = [
  ...Form_TA_1.forms.map((form) => [form, Form_TA_1] as const),
  ...Form_TA_2.forms.map((form) => [form, Form_TA_2] as const),
  ...Form_TA_W.forms.map((form) => [form, Form_TA_W] as const),
  ...Form_TACO.forms.map((form) => [form, Form_TACO] as const),
  ...Form_17AD_27.forms.map((form) => [form, Form_17AD_27] as const),
] as const;

export const TRANSFER_AGENT_FORM_NAMES = TRANSFER_AGENT_FORM_NAMES_MAP.map(([form, Form]) => form);
export type TransferAgentForm = (typeof TRANSFER_AGENT_FORM_NAMES)[number];
