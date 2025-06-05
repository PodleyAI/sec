//    *******************************************************************************
//    *   PODLEY.AI: Your Agentic AI library                                        *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { Form_ARS } from "./Form_ARS";
import { Form_10K } from "./Form_10K";
import { Form_10K405 } from "./Form_10K405";
import { Form_NT_10K } from "./Form_NT_10K";
import { Form_NTN_10K } from "./Form_NTN_10K";
import { Form_10KSB } from "./Form_10KSB";
import { Form_10C } from "./Form_10C";
import { Form_10KT } from "./Form_10KT";
import { Form_10KSB40 } from "./Form_10KSB40";
import { Form_10KT405 } from "./Form_10KT405";
import { Form_11KT } from "./Form_11KT";
import { Form_18K } from "./Form_18K";
import { Form_11K } from "./Form_11K";
import { Form_NT_11K } from "./Form_NT_11K";
import { Form_SBSEA } from "./Form_SBSEA";
import { Form_SBSEC } from "./Form_SBSEC";
import { Form_NSARA } from "./Form_NSARA";
import { Form_NSARAT } from "./Form_NSARAT";
import { Form_NSARB } from "./Form_NSARB";
import { Form_NSARBT } from "./Form_NSARBT";
import { Form_NSARU } from "./Form_NSARU";
import { Form_NT_NSAR } from "./Form_NT_NSAR";
import { Form_N30D } from "./Form_N30D";
import { Form_20F } from "./Form_20F";
import { Form_NT_20F } from "./Form_NT_20F";
import { Form_10_Q } from "./Form_10_Q";
import { Form_NTN_10Q } from "./Form_NTN_10Q";
import { Form_10QSB } from "./Form_10QSB";
import { Form_NT_10_Q } from "./Form_NT_10_Q";
import { Form_10_QT } from "./Form_10_QT";
import { Form_13F_E } from "./Form_13F_E";
import { Form_13F_HR } from "./Form_13F_HR";
import { Form_13F_NT } from "./Form_13F_NT";
import { Form_NTFNSAR } from "./Form_NTFNSAR";

export const ANNUAL_REPORT_FORM_NAMES_MAP = [
  ...Form_ARS.forms.map((form) => [form, Form_ARS] as const),
  ...Form_10K.forms.map((form) => [form, Form_10K] as const),
  ...Form_10K405.forms.map((form) => [form, Form_10K405] as const),
  ...Form_NT_10K.forms.map((form) => [form, Form_NT_10K] as const),
  ...Form_NTN_10K.forms.map((form) => [form, Form_NTN_10K] as const),
  ...Form_10KSB.forms.map((form) => [form, Form_10KSB] as const),
  ...Form_10C.forms.map((form) => [form, Form_10C] as const),
  ...Form_10KT.forms.map((form) => [form, Form_10KT] as const),
  ...Form_10KSB40.forms.map((form) => [form, Form_10KSB40] as const),
  ...Form_10KT405.forms.map((form) => [form, Form_10KT405] as const),
  ...Form_11KT.forms.map((form) => [form, Form_11KT] as const),
  ...Form_18K.forms.map((form) => [form, Form_18K] as const),
  ...Form_11K.forms.map((form) => [form, Form_11K] as const),
  ...Form_NT_11K.forms.map((form) => [form, Form_NT_11K] as const),
  ...Form_SBSEA.forms.map((form) => [form, Form_SBSEA] as const),
  ...Form_SBSEC.forms.map((form) => [form, Form_SBSEC] as const),
  ...Form_NSARA.forms.map((form) => [form, Form_NSARA] as const),
  ...Form_NSARAT.forms.map((form) => [form, Form_NSARAT] as const),
  ...Form_NSARB.forms.map((form) => [form, Form_NSARB] as const),
  ...Form_NSARBT.forms.map((form) => [form, Form_NSARBT] as const),
  ...Form_NSARU.forms.map((form) => [form, Form_NSARU] as const),
  ...Form_NT_NSAR.forms.map((form) => [form, Form_NT_NSAR] as const),
  ...Form_N30D.forms.map((form) => [form, Form_N30D] as const),
  ...Form_20F.forms.map((form) => [form, Form_20F] as const),
  ...Form_NT_20F.forms.map((form) => [form, Form_NT_20F] as const),
  ...Form_NTFNSAR.forms.map((form) => [form, Form_NTFNSAR] as const),
] as const;

export const ANNUAL_REPORT_FORM_NAMES = ANNUAL_REPORT_FORM_NAMES_MAP.map(([form, Form]) => form);
export type AnnualReportForm = (typeof ANNUAL_REPORT_FORM_NAMES)[number];

export const QUARTERLY_REPORT_FORM_NAMES_MAP = [
  ...Form_10_Q.forms.map((form) => [form, Form_10_Q] as const),
  ...Form_NTN_10Q.forms.map((form) => [form, Form_NTN_10Q] as const),
  ...Form_10QSB.forms.map((form) => [form, Form_10QSB] as const),
  ...Form_NT_10_Q.forms.map((form) => [form, Form_NT_10_Q] as const),
  ...Form_10_QT.forms.map((form) => [form, Form_10_QT] as const),
  ...Form_13F_E.forms.map((form) => [form, Form_13F_E] as const),
  ...Form_13F_HR.forms.map((form) => [form, Form_13F_HR] as const),
  ...Form_13F_NT.forms.map((form) => [form, Form_13F_NT] as const),
] as const;

export const QUARTERLY_REPORT_FORM_NAMES = QUARTERLY_REPORT_FORM_NAMES_MAP.map(
  ([form, Form]) => form
);
export type QuarterlyReportForm = (typeof QUARTERLY_REPORT_FORM_NAMES)[number];

export const PERIODIC_REPORT_FORM_NAMES = [
  ...ANNUAL_REPORT_FORM_NAMES,
  ...QUARTERLY_REPORT_FORM_NAMES,
] as const;

export type PeriodicReportForm = (typeof PERIODIC_REPORT_FORM_NAMES)[number];

export const PERIODIC_REPORT_FORM_NAMES_MAP = [
  ...ANNUAL_REPORT_FORM_NAMES_MAP,
  ...QUARTERLY_REPORT_FORM_NAMES_MAP,
] as const;
