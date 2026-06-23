/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Type } from "typebox";

/**
 * EDGAR accession numbers are exactly 20 characters: a 10-digit filer ID, a
 * 2-digit year, and a 6-digit sequence, joined by hyphens
 * (`NNNNNNNNNN-YY-NNNNNN`). The pattern and length cap are enforced wherever
 * an accession number crosses a trust boundary (task input, persisted
 * schema) so an over-long or malformed value cannot smuggle past the
 * validator and land in the database.
 */
export const ACCESSION_NUMBER_MAX_LENGTH = 20;
export const ACCESSION_NUMBER_PATTERN = "^\\d{10}-\\d{2}-\\d{6}$";

export const TypeAccessionNumber = (annotations: Record<string, unknown> = {}) =>
  Type.String({
    maxLength: ACCESSION_NUMBER_MAX_LENGTH,
    pattern: ACCESSION_NUMBER_PATTERN,
    description: "EDGAR accession number (NNNNNNNNNN-YY-NNNNNN)",
    ...annotations,
  });
