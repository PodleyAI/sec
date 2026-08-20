/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import type { ExtractionDeadLetterRepo } from "../../../../storage/dead-letter/ExtractionDeadLetterRepo";
import { makeRunSection } from "./sectionRunner";
import type { SectionPersistMeta } from "./sectionRunner";

interface RecordedLetter {
  section_name: string;
  reason_code: string;
}

function stubDeadLetters(): {
  repo: ExtractionDeadLetterRepo;
  letters: RecordedLetter[];
  resolved: string[];
} {
  const letters: RecordedLetter[] = [];
  const resolved: string[] = [];
  const repo = {
    record: async (args: { section_name: string; reason_code: string }) => {
      letters.push({ section_name: args.section_name, reason_code: args.reason_code });
    },
    markResolved: async (_id: string, _acc: string, section: string) => {
      resolved.push(section);
    },
  } as unknown as ExtractionDeadLetterRepo;
  return { repo, letters, resolved };
}

interface Row {
  readonly confidence: number;
  readonly span: string;
}

const TEXT = "alpha bravo charlie";

/** One section, wired so each test only states what it is varying. */
function harness(overrides: {
  readonly clears?: ReadonlySet<string>;
  readonly covers?: ReadonlySet<string>;
  readonly detRows?: readonly Row[];
  readonly complete?: (rows: readonly Row[], text: string) => boolean;
  readonly modelRows?: readonly Row[];
  readonly verify?: boolean;
}): {
  readonly run: () => Promise<void>;
  readonly modelCalls: () => number;
  readonly detCalls: () => number;
  readonly persisted: Array<{ rows: Row[]; meta: SectionPersistMeta }>;
  readonly letters: RecordedLetter[];
} {
  const { repo, letters } = stubDeadLetters();
  const runSection = makeRunSection({
    deadLetters: repo,
    extractor_id: "S-1",
    extractor_version: "1.0.0",
    accession_number: "acc-det",
  });
  let modelCalls = 0;
  let detCalls = 0;
  const persisted: Array<{ rows: Row[]; meta: SectionPersistMeta }> = [];
  const detRows = overrides.detRows ?? [{ confidence: 1, span: "alpha" }];
  const run = () =>
    runSection<Row>({
      sectionName: "management",
      text: TEXT,
      emptyDetail: "empty",
      lowConfidenceDetail: "low",
      ...(overrides.verify === false ? {} : { verifyRow: (text, r) => text.includes(r.span) }),
      clears: overrides.clears,
      deterministic: {
        extract: () => {
          detCalls++;
          return detRows;
        },
        covers: overrides.covers ?? new Set(["person_observation"]),
        ...(overrides.complete === undefined ? {} : { complete: overrides.complete }),
      },
      extract: async () => {
        modelCalls++;
        return [...(overrides.modelRows ?? [{ confidence: 1, span: "bravo" }])];
      },
      persist: async (rows, meta) => {
        persisted.push({ rows, meta });
        return rows.length;
      },
    });
  return { run, modelCalls: () => modelCalls, detCalls: () => detCalls, persisted, letters };
}

describe("makeRunSection deterministic pass", () => {
  it("discards the deterministic result when clears names a destination covers omits", async () => {
    const h = harness({
      clears: new Set(["person_observation", "related_party_transaction"]),
      covers: new Set(["person_observation"]),
    });
    await h.run();

    expect(h.modelCalls()).toBe(1);
    expect(h.persisted).toHaveLength(1);
    expect(h.persisted[0]!.meta.source).toBe("model");
    expect(h.persisted[0]!.rows.map((r) => r.span)).toEqual(["bravo"]);
  });

  it("preempts the model when covers is a superset of clears", async () => {
    const h = harness({
      clears: new Set(["person_observation"]),
      covers: new Set(["person_observation", "observation_provenance"]),
    });
    await h.run();

    expect(h.modelCalls()).toBe(0);
    expect(h.persisted).toHaveLength(1);
    expect(h.persisted[0]!.meta.source).toBe("deterministic");
    expect(h.persisted[0]!.rows.map((r) => r.span)).toEqual(["alpha"]);
  });

  it("falls through to the model on a partial parse, once, with no dead letter", async () => {
    const h = harness({
      clears: new Set(["person_observation"]),
      covers: new Set(["person_observation"]),
      detRows: [
        { confidence: 1, span: "alpha" },
        { confidence: 1, span: "bravo" },
        { confidence: 1, span: "nowhere in the text" },
      ],
    });
    await h.run();

    // Re-asking a pure function cannot change its answer.
    expect(h.detCalls()).toBe(1);
    expect(h.modelCalls()).toBe(1);
    expect(h.letters).toEqual([]);
    expect(h.persisted[0]!.meta.source).toBe("model");
  });

  it("reports an incomplete population when the pass declares no completeness", async () => {
    const h = harness({
      clears: new Set(["person_observation"]),
      covers: new Set(["person_observation"]),
    });
    await h.run();

    expect(h.persisted[0]!.meta.source).toBe("deterministic");
    // Every returned row survived, but the parser filters its own output, so
    // "all of them survived" says nothing about the section's population.
    expect(h.persisted[0]!.meta.complete).toBe(false);
  });

  it("reports a complete population only when the pass says so", async () => {
    const h = harness({
      clears: new Set(["person_observation"]),
      covers: new Set(["person_observation"]),
      complete: () => true,
    });
    await h.run();

    expect(h.modelCalls()).toBe(0);
    expect(h.persisted[0]!.meta.source).toBe("deterministic");
    expect(h.persisted[0]!.meta.complete).toBe(true);
  });
});
