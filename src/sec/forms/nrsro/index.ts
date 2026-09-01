/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Form_NRSRO } from "./Form_NRSRO";
import { Form_NRSRO_CE } from "./Form_NRSRO_CE";
import { Form_NRSRO_IQ } from "./Form_NRSRO_IQ";
import { Form_NRSRO_UPD } from "./Form_NRSRO_UPD";
import { Form_NRSRO_WP } from "./Form_NRSRO_WP";

export const NRSRO_FORM_NAMES_MAP = [
  ...Form_NRSRO.forms.map((form) => [form, Form_NRSRO] as const),
  ...Form_NRSRO_IQ.forms.map((form) => [form, Form_NRSRO_IQ] as const),
  ...Form_NRSRO_WP.forms.map((form) => [form, Form_NRSRO_WP] as const),
  ...Form_NRSRO_CE.forms.map((form) => [form, Form_NRSRO_CE] as const),
  ...Form_NRSRO_UPD.forms.map((form) => [form, Form_NRSRO_UPD] as const),
] as const;

export const NRSRO_FORM_NAMES = NRSRO_FORM_NAMES_MAP.map(([form, Form]) => form);
export type NRSROForm = (typeof NRSRO_FORM_NAMES)[number];
