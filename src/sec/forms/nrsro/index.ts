//    *******************************************************************************
//    *   PODLEY.AI: Your Agentic AI library                                        *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { Form_NRSRO } from "./Form_NRSRO";
import { Form_NRSRO_IQ } from "./Form_NRSRO_IQ";
import { Form_NRSRO_WP } from "./Form_NRSRO_WP";

export const NRSRO_FORM_NAMES_MAP = [
  ...Form_NRSRO.forms.map((form) => [form, Form_NRSRO] as const),
  ...Form_NRSRO_IQ.forms.map((form) => [form, Form_NRSRO_IQ] as const),
  ...Form_NRSRO_WP.forms.map((form) => [form, Form_NRSRO_WP] as const),
] as const;

export const NRSRO_FORM_NAMES = NRSRO_FORM_NAMES_MAP.map(([form, Form]) => form);
export type NRSROForm = (typeof NRSRO_FORM_NAMES)[number];
