//    *******************************************************************************
//    *   PODLEY.AI: Your Agentic AI library                                        *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { Form_PRE_14A } from "./Form_PRE_14A";
import { Form_PREC14A } from "./Form_PREC14A";
import { Form_PREC14C } from "./Form_PREC14C";
import { Form_PREM14A } from "./Form_PREM14A";
import { Form_PREM14C } from "./Form_PREM14C";
import { Form_DEF_14A } from "./Form_DEF_14A";
import { Form_DEFM14A } from "./Form_DEFM14A";
import { Form_DEFM14C } from "./Form_DEFM14C";
import { Form_DEFC14A } from "./Form_DEFC14A";
import { Form_DEFC14C } from "./Form_DEFC14C";
import { Form_DEFN14A } from "./Form_DEFN14A";
import { Form_DEF13E3 } from "./Form_DEF13E3";
import { Form_PRE13E3 } from "./Form_PRE13E3";
import { Form_PX14A6G } from "./Form_PX14A6G";
import { Form_PRE_14C } from "./Form_PRE_14C";
import { Form_PRES14A } from "./Form_PRES14A";
import { Form_PRES14C } from "./Form_PRES14C";
import { Form_DEF_14C } from "./Form_DEF_14C";
import { Form_DEFS14A } from "./Form_DEFS14A";
import { Form_DEFS14C } from "./Form_DEFS14C";
import { Form_DEFA14A } from "./Form_DEFA14A";
import { Form_DEFA14C } from "./Form_DEFA14C";
import { Form_DEFR14A } from "./Form_DEFR14A";
import { Form_DEFR14C } from "./Form_DEFR14C";
import { Form_DFRN14A } from "./Form_DFRN14A";
import { Form_DFAN14A } from "./Form_DFAN14A";
import { Form_DFRN14C } from "./Form_DFRN14C";
import { Form_DFAN14C } from "./Form_DFAN14C";
import { Form_PREA14A } from "./Form_PREA14A";
import { Form_PRER14A } from "./Form_PRER14A";
import { Form_PRER14C } from "./Form_PRER14C";
import { Form_PRR14A } from "./Form_PRR14A";

export const PROXY_FORMS_MAP = [
  ...Form_PRE_14A.forms.map((form) => [form, Form_PRE_14A] as const),
  ...Form_PREC14A.forms.map((form) => [form, Form_PREC14A] as const),
  ...Form_PREC14C.forms.map((form) => [form, Form_PREC14C] as const),
  ...Form_PREM14A.forms.map((form) => [form, Form_PREM14A] as const),
  ...Form_PREM14C.forms.map((form) => [form, Form_PREM14C] as const),
  ...Form_DEF_14A.forms.map((form) => [form, Form_DEF_14A] as const),
  ...Form_DEFM14A.forms.map((form) => [form, Form_DEFM14A] as const),
  ...Form_DEFM14C.forms.map((form) => [form, Form_DEFM14C] as const),
  ...Form_DEFC14A.forms.map((form) => [form, Form_DEFC14A] as const),
  ...Form_DEFC14C.forms.map((form) => [form, Form_DEFC14C] as const),
  ...Form_DEFN14A.forms.map((form) => [form, Form_DEFN14A] as const),
  ...Form_DEF13E3.forms.map((form) => [form, Form_DEF13E3] as const),
  ...Form_PRE13E3.forms.map((form) => [form, Form_PRE13E3] as const),
  ...Form_PX14A6G.forms.map((form) => [form, Form_PX14A6G] as const),
  ...Form_PRE_14C.forms.map((form) => [form, Form_PRE_14C] as const),
  ...Form_PRES14A.forms.map((form) => [form, Form_PRES14A] as const),
  ...Form_PRES14C.forms.map((form) => [form, Form_PRES14C] as const),
  ...Form_DEF_14C.forms.map((form) => [form, Form_DEF_14C] as const),
  ...Form_DEFS14A.forms.map((form) => [form, Form_DEFS14A] as const),
  ...Form_DEFS14C.forms.map((form) => [form, Form_DEFS14C] as const),
  ...Form_DEFA14A.forms.map((form) => [form, Form_DEFA14A] as const),
  ...Form_DEFA14C.forms.map((form) => [form, Form_DEFA14C] as const),
  ...Form_DEFR14A.forms.map((form) => [form, Form_DEFR14A] as const),
  ...Form_DEFR14C.forms.map((form) => [form, Form_DEFR14C] as const),
  ...Form_DFRN14A.forms.map((form) => [form, Form_DFRN14A] as const),
  ...Form_DFAN14A.forms.map((form) => [form, Form_DFAN14A] as const),
  ...Form_DFRN14C.forms.map((form) => [form, Form_DFRN14C] as const),
  ...Form_DFAN14C.forms.map((form) => [form, Form_DFAN14C] as const),
  ...Form_PREA14A.forms.map((form) => [form, Form_PREA14A] as const),
  ...Form_PRER14A.forms.map((form) => [form, Form_PRER14A] as const),
  ...Form_PRER14C.forms.map((form) => [form, Form_PRER14C] as const),
  ...Form_PRR14A.forms.map((form) => [form, Form_PRR14A] as const),
] as const;

export const PROXY_FORMS = PROXY_FORMS_MAP.map(([form, Form]) => form);
export type ProxyForm = (typeof PROXY_FORMS)[number];
