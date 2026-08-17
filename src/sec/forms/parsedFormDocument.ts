/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { FormConstructor } from "./Form";
import { Form_1_A } from "./exempt-offerings/Form_1_A";
import { Form_1_K } from "./exempt-offerings/Form_1_K";
import { Form_1_SA } from "./exempt-offerings/Form_1_SA";
import { Form_1_Z } from "./exempt-offerings/Form_1_Z";
import { Form_QUALIF } from "./exempt-offerings/Form_QUALIF";
import { Form_C } from "./exempt-offerings/Form_C";
import { Form_D } from "./exempt-offerings/Form_D";
import { Form_F_1 } from "./foreign-registration-statements/Form_F_1";
import { Form_F_1MEF } from "./foreign-registration-statements/Form_F_1MEF";
import { Form_144 } from "./insider-trading/Form_144";
import { Form_3 } from "./insider-trading/Form_3";
import { Form_4 } from "./insider-trading/Form_4";
import { Form_5 } from "./insider-trading/Form_5";
import { Form_8_K } from "./miscellaneous-filings/Form_8_K";
import { Form_CFPORTAL } from "./portal/Form_CFPORTAL";
import { Form_DEFM14A } from "./proxies-information-statements/Form_DEFM14A";
import { Form_DEFM14C } from "./proxies-information-statements/Form_DEFM14C";
import { Form_DEFR14A } from "./proxies-information-statements/Form_DEFR14A";
import { Form_PREM14A } from "./proxies-information-statements/Form_PREM14A";
import { Form_PREM14C } from "./proxies-information-statements/Form_PREM14C";
import { Form_DEF_14A } from "./proxies-information-statements/Form_DEF_14A";
import { Form_DEF_14C } from "./proxies-information-statements/Form_DEF_14C";
import { Form_DEFA14A } from "./proxies-information-statements/Form_DEFA14A";
import { Form_PRE_14A } from "./proxies-information-statements/Form_PRE_14A";
import { Form_PRE_14C } from "./proxies-information-statements/Form_PRE_14C";
import { Form_PRER14A } from "./proxies-information-statements/Form_PRER14A";
import { Form_424 } from "./registration-statements/Form_424";
import { Form_DRS } from "./registration-statements/Form_DRS";
import { Form_S_1 } from "./registration-statements/Form_S_1";

/**
 * One arm of {@link ParsedFormDocument}: a form class's declared form names
 * paired with what its `parse` resolves to. Both halves are read off the class,
 * so a new form name or a changed parse result flows through without editing
 * this file.
 */
interface ParsedDocumentOf<C extends FormConstructor> {
  readonly form: C["forms"][number];
  readonly parsed: Awaited<ReturnType<C["parse"]>>;
}

/**
 * Discriminated union of every form the storage dispatch handles, keyed on the
 * form name.
 *
 * `Form.parse` is `static` and so cannot be typed by a class type parameter
 * (TypeScript rejects `abstract class Form<TParsed>` referencing `TParsed` from
 * a static member), which leaves the registry's parse result as `unknown`.
 * Narrowing this union on `form` recovers the concrete parsed type for each
 * storage handler, so a `switch` over form names type-checks its handler
 * arguments instead of passing `any` through.
 *
 * Only forms with a storage handler appear here; the rest never reach the
 * dispatch.
 */
export type ParsedFormDocument =
  | ParsedDocumentOf<typeof Form_D>
  | ParsedDocumentOf<typeof Form_C>
  | ParsedDocumentOf<typeof Form_CFPORTAL>
  | ParsedDocumentOf<typeof Form_1_A>
  | ParsedDocumentOf<typeof Form_1_K>
  | ParsedDocumentOf<typeof Form_1_SA>
  | ParsedDocumentOf<typeof Form_1_Z>
  | ParsedDocumentOf<typeof Form_QUALIF>
  | ParsedDocumentOf<typeof Form_3>
  | ParsedDocumentOf<typeof Form_4>
  | ParsedDocumentOf<typeof Form_5>
  | ParsedDocumentOf<typeof Form_144>
  | ParsedDocumentOf<typeof Form_S_1>
  | ParsedDocumentOf<typeof Form_DRS>
  | ParsedDocumentOf<typeof Form_F_1>
  | ParsedDocumentOf<typeof Form_F_1MEF>
  | ParsedDocumentOf<typeof Form_424>
  | ParsedDocumentOf<typeof Form_8_K>
  | ParsedDocumentOf<typeof Form_DEFM14A>
  | ParsedDocumentOf<typeof Form_PREM14A>
  | ParsedDocumentOf<typeof Form_DEFM14C>
  | ParsedDocumentOf<typeof Form_PREM14C>
  | ParsedDocumentOf<typeof Form_DEFR14A>
  | ParsedDocumentOf<typeof Form_PRER14A>
  // General proxy/information statements. A SPAC business-combination vote is
  // routinely filed on these rather than the "M" merger variants.
  | ParsedDocumentOf<typeof Form_DEF_14A>
  | ParsedDocumentOf<typeof Form_PRE_14A>
  | ParsedDocumentOf<typeof Form_DEFA14A>
  | ParsedDocumentOf<typeof Form_DEF_14C>
  | ParsedDocumentOf<typeof Form_PRE_14C>;
