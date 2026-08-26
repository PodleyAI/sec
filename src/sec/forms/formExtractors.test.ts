/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, expect, test } from "vitest";
import {
  clearFormExtractorsForTesting,
  extractorKey,
  extractorsForForm,
  formNeedsFullSubmission,
  formsForExtractorKeys,
  getFormExtractor,
  listFormExtractorKeys,
  registerFormExtractor,
} from "./formExtractors";

afterEach(() => clearFormExtractorsForTesting());

const noopStore = async (): Promise<void> => {};

test("register + lookup by key; section defaults to empty", () => {
  registerFormExtractor({ id: "D", forms: ["D", "D/A"], store: noopStore });
  expect(extractorKey("D")).toBe("D");
  expect(getFormExtractor("D")?.id).toBe("D");
  expect(listFormExtractorKeys()).toEqual(["D"]);
});

test("a non-empty section makes a distinct key", () => {
  registerFormExtractor({ id: "D", section: "issuer", forms: ["D"], store: noopStore });
  expect(extractorKey("D", "issuer")).toBe("D:issuer");
  expect(getFormExtractor("D:issuer")?.section).toBe("issuer");
  expect(getFormExtractor("D")).toBeUndefined();
});

test("re-registering the same key overwrites rather than duplicating", () => {
  registerFormExtractor({ id: "D", forms: ["D"], store: noopStore });
  registerFormExtractor({ id: "D", forms: ["D", "D/A"], store: noopStore });
  expect(listFormExtractorKeys()).toHaveLength(1);
  expect(extractorsForForm("D/A")).toHaveLength(1);
});

test("one form carries several extractors", () => {
  registerFormExtractor({ id: "8-K", forms: ["8-K"], store: noopStore });
  registerFormExtractor({ id: "spac-milestone", forms: ["8-K"], store: noopStore });
  expect(
    extractorsForForm("8-K")
      .map((e) => e.id)
      .sort()
  ).toEqual(["8-K", "spac-milestone"]);
});

test("an unknown form yields no extractors", () => {
  registerFormExtractor({ id: "D", forms: ["D"], store: noopStore });
  expect(extractorsForForm("NOPE")).toEqual([]);
});

test("`after` orders extractors within a form", () => {
  registerFormExtractor({ id: "second", forms: ["8-K"], after: ["first"], store: noopStore });
  registerFormExtractor({ id: "first", forms: ["8-K"], store: noopStore });
  expect(extractorsForForm("8-K").map((e) => e.id)).toEqual(["first", "second"]);
});

test("an `after` naming nothing registered is ignored, not an error", () => {
  registerFormExtractor({ id: "solo", forms: ["8-K"], after: ["absent"], store: noopStore });
  expect(extractorsForForm("8-K").map((e) => e.id)).toEqual(["solo"]);
});

test("a cycle throws", () => {
  registerFormExtractor({ id: "a", forms: ["X"], after: ["b"], store: noopStore });
  registerFormExtractor({ id: "b", forms: ["X"], after: ["a"], store: noopStore });
  expect(() => extractorsForForm("X")).toThrow(/cycle/i);
});

test("formsForExtractorKeys returns the union, de-duplicated", () => {
  registerFormExtractor({ id: "D", forms: ["D", "D/A"], store: noopStore });
  registerFormExtractor({ id: "C", forms: ["C", "D/A"], store: noopStore });
  expect(formsForExtractorKeys(["D", "C"]).sort()).toEqual(["C", "D", "D/A"]);
});

test("formNeedsFullSubmission is the union across a form's extractors", async () => {
  const probe = { form: "S-1", cik: 1, items: null };
  registerFormExtractor({ id: "plain", forms: ["S-1"], store: noopStore });
  expect(await formNeedsFullSubmission(probe)).toBe(false);
  registerFormExtractor({
    id: "envelope",
    forms: ["S-1"],
    needsFullSubmission: true,
    store: noopStore,
  });
  expect(await formNeedsFullSubmission(probe)).toBe(true);
  expect(await formNeedsFullSubmission({ ...probe, form: "D" })).toBe(false);
});

test("a predicate decides per filing, and short-circuits behind a static true", async () => {
  let asked = 0;
  registerFormExtractor({
    id: "narrative",
    forms: ["8-K"],
    needsFullSubmission: async (probe) => {
      asked++;
      return probe.items?.includes("5.06") === true;
    },
    store: noopStore,
  });
  expect(await formNeedsFullSubmission({ form: "8-K", cik: 1, items: "2.02" })).toBe(false);
  expect(await formNeedsFullSubmission({ form: "8-K", cik: 1, items: "5.06,9.01" })).toBe(true);
  expect(asked).toBe(2);

  registerFormExtractor({
    id: "always",
    forms: ["8-K"],
    needsFullSubmission: true,
    store: noopStore,
  });
  asked = 0;
  expect(await formNeedsFullSubmission({ form: "8-K", cik: 1, items: "2.02" })).toBe(true);
  expect(asked).toBe(0);
});
