//    *******************************************************************************
//    *   PODLEY.AI: Your Agentic AI library                                        *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { Form_TA_1 } from "./Form_TA_1";
import { Form_TA_2 } from "./Form_TA_2";
import { Form_TA_W } from "./Form_TA_W";

export const TRANSFER_AGENT_FORM_NAMES_MAP = [
  ...Form_TA_1.forms.map((form) => [form, Form_TA_1] as const),
  ...Form_TA_2.forms.map((form) => [form, Form_TA_2] as const),
  ...Form_TA_W.forms.map((form) => [form, Form_TA_W] as const),
] as const;

export const TRANSFER_AGENT_FORM_NAMES = TRANSFER_AGENT_FORM_NAMES_MAP.map(([form, Form]) => form);
export type TransferAgentForm = (typeof TRANSFER_AGENT_FORM_NAMES)[number];
