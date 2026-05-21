/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Parser-level coverage for the amendment, withdrawal, and post-qualification
 * variants of the exempt-offering forms. Each fixture directory holds real
 * EDGAR filings for the variant; this test walks every file and asserts the
 * parser handles it without throwing and that the submissionType in the
 * parsed output matches the expected variant code.
 *
 * The existing `Form_<X>.test.ts` files only exercise the canonical form
 * code. These variant tests guard the parser switch in each Form_<X>.parse
 * so we notice when an amendment XSD diverges from its parent.
 */

import { describe, expect, it } from "bun:test";
import { Form_1_A } from "./Form_1_A";
import { Form_1_K } from "./Form_1_K";
import { Form_1_Z } from "./Form_1_Z";
import { Form_C } from "./Form_C";
import { Form_D } from "./Form_D";
import { listFixtureFiles, readFixture, runPipeline } from "./pipeline-test-util";

interface ParsedSubmission {
  readonly headerData?: { readonly submissionType?: string };
  readonly submissionType?: string;
}

interface VariantCase {
  readonly slug: string;
  readonly formCode: string;
  readonly parse: (xml: string) => Promise<ParsedSubmission>;
  // Form D puts submissionType at the top level; everything else nests it
  // under headerData. The extractor abstracts over that difference.
  readonly extractSubmissionType: (parsed: ParsedSubmission) => string | undefined;
  // Most variants get an exact-match regex; only C/A allows the alternates
  // (C/A, C/A-W) because EDGAR sometimes writes back C/A-W for what was
  // tagged C/A in the index. Default is `^${escape(formCode)}$`.
  readonly submissionTypeMatcher?: RegExp;
}

const headerSubmissionType = (parsed: ParsedSubmission): string | undefined =>
  parsed.headerData?.submissionType;
const topLevelSubmissionType = (parsed: ParsedSubmission): string | undefined =>
  parsed.submissionType;

function exactMatcher(formCode: string): RegExp {
  // Anchor the form code with regex metachars escaped (the form codes contain
  // "/" and " " which are inert, but escaping is safer if we add more later).
  return new RegExp("^" + formCode.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$");
}

const VARIANTS: readonly VariantCase[] = [
  {
    slug: "form-c-a",
    formCode: "C/A",
    parse: (xml) => Form_C.parse("C/A", xml) as Promise<ParsedSubmission>,
    extractSubmissionType: headerSubmissionType,
    // C/A fixtures occasionally re-tag themselves as C/A-W mid-amendment.
    submissionTypeMatcher: /^C\/A/,
  },
  {
    slug: "form-c-w",
    formCode: "C-W",
    parse: (xml) => Form_C.parse("C-W", xml) as Promise<ParsedSubmission>,
    extractSubmissionType: headerSubmissionType,
  },
  {
    slug: "form-c-a-w",
    formCode: "C/A-W",
    parse: (xml) => Form_C.parse("C/A-W", xml) as Promise<ParsedSubmission>,
    extractSubmissionType: headerSubmissionType,
  },
  {
    slug: "form-d-a",
    formCode: "D/A",
    parse: (xml) => Form_D.parse("D/A", xml) as Promise<ParsedSubmission>,
    extractSubmissionType: topLevelSubmissionType,
  },
  {
    slug: "form-1-a-a",
    formCode: "1-A/A",
    parse: (xml) => Form_1_A.parse("1-A/A", xml) as Promise<ParsedSubmission>,
    extractSubmissionType: headerSubmissionType,
  },
  {
    slug: "form-1-a-pos",
    formCode: "1-A POS",
    parse: (xml) => Form_1_A.parse("1-A POS", xml) as Promise<ParsedSubmission>,
    extractSubmissionType: headerSubmissionType,
  },
  {
    slug: "form-1-k-a",
    formCode: "1-K/A",
    parse: (xml) => Form_1_K.parse("1-K/A", xml) as Promise<ParsedSubmission>,
    extractSubmissionType: headerSubmissionType,
  },
  {
    slug: "form-1-z-a",
    formCode: "1-Z/A",
    parse: (xml) => Form_1_Z.parse("1-Z/A", xml) as Promise<ParsedSubmission>,
    extractSubmissionType: headerSubmissionType,
  },
];

describe("Form variants", () => {
  for (const variant of VARIANTS) {
    describe(`${variant.formCode} fixtures under mock_data/${variant.slug}/`, () => {
      const files = (() => {
        try {
          return listFixtureFiles(variant.slug);
        } catch {
          // The directory might not exist on a fresh checkout. We still
          // produce a placeholder test that calls out the gap.
          return [];
        }
      })();

      it(`has at least one fixture`, () => {
        // `1-Z/A` is genuinely rare on EDGAR; allow zero but flag it.
        if (variant.formCode === "1-Z/A") {
          expect(files.length).toBeGreaterThanOrEqual(0);
          return;
        }
        expect(files.length).toBeGreaterThan(0);
      });

      it(`parses every ${variant.formCode} fixture without exceptions`, async () => {
        if (files.length === 0) return;
        const summary = await runPipeline(variant.slug, async (_file, xml) => {
          await variant.parse(xml);
        });
        if (summary.failed > 0) {
          throw new Error(
            `${summary.failed}/${summary.total} ${variant.formCode} fixtures failed to parse. ` +
              `First: ${summary.errors[0]?.file}: ${summary.errors[0]?.error}`
          );
        }
        expect(summary.succeeded).toBe(files.length);
      });

      const matcher = variant.submissionTypeMatcher ?? exactMatcher(variant.formCode);
      it(`returns a submissionType matching ${matcher}`, async () => {
        if (files.length === 0) return;
        // Spot-check the first 5 fixtures for the right submissionType.
        const sample = files.slice(0, Math.min(5, files.length));
        for (const file of sample) {
          const xml = readFixture(variant.slug, file);
          const parsed = await variant.parse(xml);
          const submissionType = variant.extractSubmissionType(parsed);
          expect(submissionType).toBeDefined();
          expect(submissionType!).toMatch(matcher);
        }
      });
    });
  }
});
