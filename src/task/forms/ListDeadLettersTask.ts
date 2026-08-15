/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Type } from "typebox";
import { globalServiceRegistry, Task, TaskError } from "workglow";
import {
  ExtractionDeadLetterRepo,
  isEligibleDeadLetter,
} from "../../storage/dead-letter/ExtractionDeadLetterRepo";
import {
  ExtractionDeadLetterSchema,
  type ExtractionDeadLetter,
} from "../../storage/dead-letter/ExtractionDeadLetterSchema";
import { FILING_REPOSITORY_TOKEN } from "../../storage/filing/FilingSchema";
import { COMPONENT_VERSION_REPOSITORY_TOKEN } from "../../storage/versioning/ComponentVersionSchema";
import { getActiveSlot } from "../../storage/versioning/getActiveSlot";
import { VersionRegistry } from "../../storage/versioning/VersionRegistry";

export interface EligibleByExtractor {
  readonly extractor_id: string;
  readonly count: number;
}

/** Number of pending dead-letter entries now eligible under the current version. */
export async function countEligibleDeadLetters(
  extractorId: string,
  cik: number | undefined = undefined
): Promise<number> {
  const byExtractor = await countEligibleByExtractor(extractorId, cik);
  return byExtractor.reduce((n, row) => n + row.count, 0);
}

async function accessionNumbersForCik(cik: number): Promise<ReadonlySet<string>> {
  const filings = (await globalServiceRegistry.get(FILING_REPOSITORY_TOKEN).query({ cik })) ?? [];
  return new Set(filings.map((f) => f.accession_number));
}

export type ListDeadLettersTaskInput = {
  readonly extractorId: string | undefined;
  readonly cik: number | undefined;
  readonly eligible: boolean | undefined;
};

export type ListDeadLettersTaskOutput = {
  /** Pending dead-letter rows; empty when only the eligible count was requested. */
  readonly pending: ExtractionDeadLetter[];
  /** Count eligible for retry under the active version; null unless `eligible` was set. */
  readonly eligibleCount: number | null;
  /** Per-extractor eligible counts; empty unless `eligible` was set. */
  readonly eligibleByExtractor: readonly EligibleByExtractor[];
};

/**
 * Lists pending dead-letter entries for an extractor, optionally scoped to one
 * issuer. `--cik` joins through `filings`: dead letters have no CIK column, and
 * EDGAR accessions are often the filing agent's, not the issuer's.
 */
export class ListDeadLettersTask extends Task<ListDeadLettersTaskInput, ListDeadLettersTaskOutput> {
  static readonly type = "ListDeadLettersTask";
  static readonly category = "SEC";
  static readonly title = "List dead letters";
  static readonly cacheable = false;

  public static inputSchema() {
    return Type.Object({
      extractorId: Type.Optional(Type.String({ title: "Extractor id", description: "e.g. 'S-1'" })),
      cik: Type.Optional(Type.Number({ title: "CIK" })),
      eligible: Type.Optional(Type.Boolean({ default: false })),
    });
  }

  public static outputSchema() {
    return Type.Object({
      pending: Type.Array(ExtractionDeadLetterSchema),
      eligibleCount: Type.Union([Type.Number(), Type.Null()]),
      eligibleByExtractor: Type.Array(
        Type.Object({
          extractor_id: Type.String(),
          count: Type.Number(),
        })
      ),
    });
  }

  async execute(input: ListDeadLettersTaskInput): Promise<ListDeadLettersTaskOutput> {
    const extractorId = emptyToUndefined(input.extractorId);
    const cik = input.cik;
    if (extractorId === undefined && cik === undefined) {
      throw new TaskError("Provide an extractor id or --cik.");
    }
    if (input.eligible === true) {
      const eligibleByExtractor = await countEligibleByExtractor(extractorId, cik);
      return {
        pending: [],
        eligibleCount: eligibleByExtractor.reduce((n, row) => n + row.count, 0),
        eligibleByExtractor,
      };
    }
    return {
      pending: await listPending(extractorId, cik),
      eligibleCount: null,
      eligibleByExtractor: [],
    };
  }
}

function emptyToUndefined(value: string | undefined): string | undefined {
  return value === undefined || value === "" ? undefined : value;
}

async function listPending(
  extractorId: string | undefined,
  cik: number | undefined
): Promise<ExtractionDeadLetter[]> {
  const repo = new ExtractionDeadLetterRepo();
  if (cik === undefined) {
    return repo.listPending(extractorId!);
  }
  const accessions = [...(await accessionNumbersForCik(cik))];
  return repo.listPendingByAccessions(accessions, extractorId);
}

async function countEligibleByExtractor(
  extractorId: string | undefined,
  cik: number | undefined
): Promise<EligibleByExtractor[]> {
  const pending = await listPending(extractorId, cik);
  const ids =
    extractorId !== undefined
      ? [extractorId]
      : [...new Set(pending.map((r) => r.extractor_id))].sort();
  const reg = new VersionRegistry(globalServiceRegistry.get(COMPONENT_VERSION_REPOSITORY_TOKEN));
  const out: EligibleByExtractor[] = [];
  for (const id of ids) {
    const slot = await getActiveSlot(reg, "extractor", id);
    if (!slot) continue;
    const count = pending.filter(
      (r) => r.extractor_id === id && isEligibleDeadLetter(r, slot.semver)
    ).length;
    if (count > 0) out.push({ extractor_id: id, count });
  }
  return out;
}
