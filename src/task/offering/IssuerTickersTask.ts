/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Type } from "typebox";
import { Task } from "workglow";
import { IssuerTickerRepo } from "../../storage/offering/IssuerTickerRepo";
import { IssuerTickerSchema, type IssuerTicker } from "../../storage/offering/IssuerTickerSchema";

export type IssuerTickersTaskInput = {
  readonly cik: number;
};

export type IssuerTickersTaskOutput = {
  readonly rows: IssuerTicker[];
};

/** Reads the point-in-time ticker series for an issuer CIK, oldest first. */
export class IssuerTickersTask extends Task<IssuerTickersTaskInput, IssuerTickersTaskOutput> {
  static readonly type = "IssuerTickersTask";
  static readonly category = "SEC";
  static readonly title = "Issuer ticker series";
  static readonly cacheable = false;

  public static inputSchema() {
    return Type.Object({
      cik: Type.Number(),
    });
  }

  public static outputSchema() {
    return Type.Object({
      rows: Type.Array(IssuerTickerSchema),
    });
  }

  async execute(input: IssuerTickersTaskInput): Promise<IssuerTickersTaskOutput> {
    return { rows: await new IssuerTickerRepo().history(input.cik) };
  }
}
