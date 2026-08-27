/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import {
  DEAD_LETTER_REASON_CODES,
  EXPECTED_NEGATIVE_REASON_CODES,
  MODEL_ERROR_REASON_CODES,
  NONDETERMINISTIC_REASON_CODES,
} from "../../storage/dead-letter/ExtractionDeadLetterSchema";
import { allRegisteredExtractorIds } from "../../sec/forms/formExtractors";
import {
  EXTRACTOR_IDS,
  PERSON_OBSERVING_EXTRACTOR_IDS,
  REKEY_REEXTRACT_EXTRACTOR_IDS,
  SWEEP_PRIORITY,
} from "../../storage/versioning/extractorIds";
import { SYNC_FORM_DOMAINS } from "./syncFormDomains";

/**
 * Opening `ExtractorId` and `DeadLetterReasonCode` to plain `string` (so a
 * downstream package can name its own) was deliberate, but it also removed
 * the compiler's spell-check over every literal list keyed on one of these
 * vocabularies. A typo in one now compiles clean, and for an extractor id in
 * particular propagates all the way into the SQL a re-key ceremony scopes its
 * deletes to (`truncateIdentityTier.test.ts` checks that SQL against the
 * constant, not against reality) — silently excluding that id's rows from
 * every gate keyed on it. This file is the replacement spell-check: every
 * list below may only draw from the vocabulary sec actually declares.
 *
 * Unlike `syncFormDomains.test.ts`'s `expectPartition` (which walks the
 * registry's routings and `continue`s past any id it doesn't recognize —
 * exactly the shape that lets an unknown id pass silently), this walks each
 * list directly and fails on the first name `known` doesn't contain.
 */
function assertKnownValues(
  label: string,
  values: readonly string[],
  vocabulary: readonly string[]
): void {
  const known = new Set(vocabulary);
  for (const value of values) {
    expect(known.has(value), `${label} names unknown value '${value}'`).toBe(true);
  }
}

describe("extractor id vocabulary — every list draws only from EXTRACTOR_IDS", () => {
  it("the ids sec's own form extractors register under", () => {
    // Importing `./syncFormDomains` registers them at its module scope, and
    // vitest gives this file its own process, so nothing else is in the
    // registry. The registry itself is open by design — a downstream package
    // names ids sec has never heard of — which is exactly why this asks only
    // about the registrations sec ships.
    assertKnownValues("registerSecFormExtractors", allRegisteredExtractorIds(), EXTRACTOR_IDS);
  });

  it("PERSON_OBSERVING_EXTRACTOR_IDS", () => {
    assertKnownValues(
      "PERSON_OBSERVING_EXTRACTOR_IDS",
      PERSON_OBSERVING_EXTRACTOR_IDS,
      EXTRACTOR_IDS
    );
  });

  it("REKEY_REEXTRACT_EXTRACTOR_IDS", () => {
    assertKnownValues(
      "REKEY_REEXTRACT_EXTRACTOR_IDS",
      REKEY_REEXTRACT_EXTRACTOR_IDS,
      EXTRACTOR_IDS
    );
  });

  it("SWEEP_PRIORITY", () => {
    assertKnownValues("SWEEP_PRIORITY", SWEEP_PRIORITY, EXTRACTOR_IDS);
  });

  it("every SYNC_FORM_DOMAINS entry", () => {
    for (const [domain, ids] of Object.entries(SYNC_FORM_DOMAINS)) {
      assertKnownValues(`SYNC_FORM_DOMAINS['${domain}']`, ids as readonly string[], EXTRACTOR_IDS);
    }
  });
});

describe("dead-letter reason code vocabulary — every list draws only from DEAD_LETTER_REASON_CODES", () => {
  it("MODEL_ERROR_REASON_CODES", () => {
    assertKnownValues(
      "MODEL_ERROR_REASON_CODES",
      MODEL_ERROR_REASON_CODES,
      DEAD_LETTER_REASON_CODES
    );
  });

  it("EXPECTED_NEGATIVE_REASON_CODES", () => {
    assertKnownValues(
      "EXPECTED_NEGATIVE_REASON_CODES",
      EXPECTED_NEGATIVE_REASON_CODES,
      DEAD_LETTER_REASON_CODES
    );
  });

  it("NONDETERMINISTIC_REASON_CODES", () => {
    assertKnownValues(
      "NONDETERMINISTIC_REASON_CODES",
      NONDETERMINISTIC_REASON_CODES,
      DEAD_LETTER_REASON_CODES
    );
  });
});
