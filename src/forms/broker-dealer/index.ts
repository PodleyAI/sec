//    *******************************************************************************
//    *   PODLEY.AI: Your Agentic AI library                                        *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { Form_17HACON } from "./Form_17HACON";
import { Form_17HQCON } from "./Form_17HQCON";
import { Form_X17A5 } from "./Form_X17A5";
import { Form_FOCUSN } from "./Form_FOCUSN";
import { Form_7M } from "./Form_7M";
import { Form_8M } from "./Form_8M";
import { Form_9M } from "./Form_9M";
import { Form_G_FIN } from "./Form_G_FIN";
import { Form_MSD } from "./Form_MSD";
import { Form_REG_NR } from "./Form_REG_NR";

export const BROKER_DEALER_FORM_NAMES_MAP = [
  ...Form_17HACON.forms.map((form) => [form, Form_17HACON] as const),
  ...Form_17HQCON.forms.map((form) => [form, Form_17HQCON] as const),
  ...Form_X17A5.forms.map((form) => [form, Form_X17A5] as const),
  ...Form_FOCUSN.forms.map((form) => [form, Form_FOCUSN] as const),
  ...Form_7M.forms.map((form) => [form, Form_7M] as const),
  ...Form_8M.forms.map((form) => [form, Form_8M] as const),
  ...Form_9M.forms.map((form) => [form, Form_9M] as const),
  ...Form_G_FIN.forms.map((form) => [form, Form_G_FIN] as const),
  ...Form_MSD.forms.map((form) => [form, Form_MSD] as const),
  ...Form_REG_NR.forms.map((form) => [form, Form_REG_NR] as const),
] as const;

export const BROKER_DEALER_FORM_NAMES = BROKER_DEALER_FORM_NAMES_MAP.map(([form, Form]) => form);
export type BrokerDealerForm = (typeof BROKER_DEALER_FORM_NAMES)[number];
