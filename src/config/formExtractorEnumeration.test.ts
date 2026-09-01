/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { WebFieldWidget, WebFieldWidgetItem } from "@workglow/cli";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { globalServiceRegistry } from "workglow";
import { clearFormExtractorsForTesting, registerFormExtractor } from "../sec/forms/formExtractors";
import { FILING_REPOSITORY_TOKEN } from "../storage/filing/FilingSchema";
import { formsForExtractor, listBackfillableExtractorIds } from "../task/forms/backfillDescriptors";
import { VersionStartDevTask } from "../task/versioning/VersionStartDevTask";
import { registerSecFormExtractors } from "./registerFormExtractors";
import { setupAllDatabases } from "./setupAllDatabases";
import { resetDependencyInjectionsForTesting } from "./TestingDI";

/**
 * The field-widget registry lives in `@workglow/cli` and offers no read-back,
 * so the picker's own `search` is captured as it registers.
 */
const captured = vi.hoisted(() => ({ widgets: new Map<string, WebFieldWidget>() }));
vi.mock("@workglow/cli", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    registerWebFieldWidget: (widget: WebFieldWidget): void => {
      captured.widgets.set(widget.format, widget);
    },
  };
});

/**
 * What a 1:1 form → extractor map cannot say, asserted against the sites that
 * used to read one.
 *
 * The fixture is two registrations on top of the ones sec ships: a SECOND
 * extractor id over a form that already has one, and a second section under an
 * EXISTING id carrying a form no shipped extractor claims. Every assertion here
 * is a form or an id that a `Record<form, extractorId>` has no slot for — the
 * map answers each of them plausibly and wrongly rather than failing.
 */
const SECOND_ID = "spac-milestone";
/** A real EDGAR form symbol that no extractor sec ships handles. */
const NOVEL_FORM = "8-K12B";

const noopStore = async (): Promise<void> => {};

async function seedFiling(accession_number: string, form: string): Promise<void> {
  const repo = globalServiceRegistry.get(FILING_REPOSITORY_TOKEN);
  await repo.put({
    cik: 7,
    accession_number,
    form,
    primary_doc: "primary.htm",
    file_number: "",
    filing_date: "2026-03-20",
    acceptance_date: "2026-03-20T00:00:00.000Z",
    report_date: "2026-03-20",
    film_number: null,
    primary_doc_description: null,
    size: null,
    is_xbrl: null,
    is_inline_xbrl: null,
    items: null,
    act: null,
  } as never);
}

beforeAll(() => {
  registerSecFormExtractors();
  registerFormExtractor({ id: SECOND_ID, forms: ["8-K", NOVEL_FORM], store: noopStore });
  registerFormExtractor({
    id: "8-K-items",
    section: "listing-transfer",
    forms: [NOVEL_FORM],
    store: noopStore,
  });
});

afterAll(() => {
  // Leave the registry as it was found: clearing re-arms `registerSecFormExtractors`.
  clearFormExtractorsForTesting();
  registerSecFormExtractors();
});

describe("backfillDescriptors enumerates the registry", () => {
  it("formsForExtractor answers for a second extractor the map cannot name", () => {
    expect(formsForExtractor(SECOND_ID).sort()).toEqual(["8-K", NOVEL_FORM].sort());
  });

  it("formsForExtractor widens an existing id by its other section's forms", () => {
    // Two registry keys, one id: `8-K-items` now reaches `8-K12B` through its
    // second section, which a single-valued map has nowhere to record.
    expect(formsForExtractor("8-K-items").sort()).toEqual(["8-K", "8-K/A", NOVEL_FORM].sort());
  });

  it("formsForExtractor still answers nothing for an id with no forms", () => {
    expect(formsForExtractor("loi")).toEqual([]);
  });

  it("listBackfillableExtractorIds includes a second extractor on an existing form", () => {
    expect(listBackfillableExtractorIds()).toContain(SECOND_ID);
  });

  it("listBackfillableExtractorIds lists ids, never sectioned registry keys", () => {
    const ids = listBackfillableExtractorIds();
    expect(ids).toContain("8-K-items");
    expect(ids).not.toContain("8-K-items:listing-transfer");
  });
});

describe("the form picker offers every registered form", () => {
  it("offers a form only a downstream extractor claims", async () => {
    const { registerSecFieldWidgets } = await import("../web/secFieldWidgets");
    registerSecFieldWidgets();
    const widget = captured.widgets.get("sec:form");
    expect(widget).toBeDefined();
    const items: readonly WebFieldWidgetItem[] = await widget!.search("8-K", {
      path: ["fetch", "form"],
      args: [],
      values: {},
    });
    expect(items.map((item) => item.value)).toContain(NOVEL_FORM);
  });
});

describe("VersionStartDevTask counts every form its extractor handles", () => {
  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
  });

  it("snapshots the filings of a form reached through a second section", async () => {
    await seedFiling("acc-8k", "8-K");
    await seedFiling("acc-8ka", "8-K/A");
    await seedFiling("acc-8k12b", NOVEL_FORM);
    await seedFiling("acc-10k", "10-K");

    const out = await new VersionStartDevTask().execute({
      kind: "extractor",
      id: "8-K-items",
      semver: "2.0.0",
      bump: "major",
      notes: null,
      dryRun: true,
    });

    // 3, not 2: the promote gate's denominator has to cover `8-K12B` too, or a
    // cycle passes it having re-extracted none of them.
    expect(out.targetCount).toBe(3);
  });
});
