/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Type } from "typebox";
import { Task } from "workglow";
import { compareIssuerDeal, type DealComparison } from "../../commands/issuerDeal";
import type { TaskPorts } from "../taskPorts";

export type IssuerDealTaskInput = {
  readonly cik: number;
};

export type IssuerDealTaskOutput = {
  readonly comparison: TaskPorts<DealComparison> | null;
};

/**
 * Joins the issuer's registered (S-1) offering terms against the final priced
 * (424B1/424B4) terms. Null when the issuer has no extracted terms at all.
 */
export class IssuerDealTask extends Task<IssuerDealTaskInput, IssuerDealTaskOutput> {
  static readonly type = "IssuerDealTask";
  static readonly category = "SEC";
  static readonly title = "Compare issuer deal terms";
  static readonly cacheable = false;

  public static inputSchema() {
    return Type.Object({
      cik: Type.Number(),
    });
  }

  public static outputSchema() {
    return Type.Object({
      comparison: Type.Union([
        Type.Object({
          kind: Type.Union([Type.Literal("spac"), Type.Literal("equity")]),
          cik: Type.Number(),
          registered_accession: Type.Union([Type.String(), Type.Null()]),
          priced_accession: Type.Union([Type.String(), Type.Null()]),
          fields: Type.Array(
            Type.Object({
              field: Type.String(),
              registered: Type.Union([Type.Number(), Type.String(), Type.Null()]),
              priced: Type.Union([Type.Number(), Type.String(), Type.Null()]),
              delta: Type.Union([Type.Number(), Type.Null()]),
            })
          ),
        }),
        Type.Null(),
      ]),
    });
  }

  async execute(input: IssuerDealTaskInput): Promise<IssuerDealTaskOutput> {
    return { comparison: await compareIssuerDeal(input.cik) };
  }
}
