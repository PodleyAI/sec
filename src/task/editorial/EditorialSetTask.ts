/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Type } from "typebox";
import { Task } from "workglow";
import { SpacRepo } from "../../storage/spac/SpacRepo";
import { SpacReportWriter } from "../../storage/spac/SpacReportWriter";

export type EditorialSetTaskInput = {
  readonly cik: number;
  readonly urlSponsor?: string;
  readonly urlSpac?: string;
  readonly details?: string;
  readonly createMissing?: boolean;
};

export type EditorialSetTaskOutput = {
  readonly updated: boolean;
  readonly created: boolean;
  /**
   * True when the CIK has no spac row and `createMissing` was not set — an
   * expected refusal reported as data (not a throw) so the CLI renders its
   * hint identically on a TTY and when piped.
   */
  readonly missingSpacRow: boolean;
};

/**
 * Writes editorial fields (url_sponsor / url_spac / details) onto a SPAC row
 * via {@link SpacReportWriter.recordEditorial}. A CIK with no spac row is
 * rejected unless `createMissing` — creating a row marks the CIK a known SPAC,
 * which gates 8-K/proxy processing, so minting rows is opt-in.
 */
export class EditorialSetTask extends Task<EditorialSetTaskInput, EditorialSetTaskOutput> {
  static readonly type = "EditorialSetTask";
  static readonly category = "SEC";
  static readonly title = "Set SPAC editorial fields";
  static readonly cacheable = false;

  public static inputSchema() {
    return Type.Object({
      cik: Type.Number(),
      urlSponsor: Type.Optional(Type.String()),
      urlSpac: Type.Optional(Type.String()),
      details: Type.Optional(Type.String()),
      createMissing: Type.Optional(Type.Boolean()),
    });
  }

  public static outputSchema() {
    return Type.Object({
      updated: Type.Boolean(),
      created: Type.Boolean(),
      missingSpacRow: Type.Boolean(),
    });
  }

  async execute(input: EditorialSetTaskInput): Promise<EditorialSetTaskOutput> {
    const exists = (await new SpacRepo().getSpac(input.cik)) !== undefined;
    if (!exists && input.createMissing !== true) {
      return { updated: false, created: false, missingSpacRow: true };
    }
    await new SpacReportWriter().recordEditorial({
      cik: input.cik,
      url_sponsor: input.urlSponsor,
      url_spac: input.urlSpac,
      details: input.details,
    });
    return { updated: true, created: !exists, missingSpacRow: false };
  }
}
