/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it } from "bun:test";
import { resetDependencyInjectionsForTesting } from "../../config/TestingDI";
import { setupAllDatabases } from "../../config/setupAllDatabases";
import { SpacRepo } from "./SpacRepo";
import type { SpacEvent } from "./SpacEventSchema";

function event(partial: Partial<SpacEvent> & Pick<SpacEvent, "cik" | "accession_number" | "event_type" | "event_date">): SpacEvent {
  return {
    form: null,
    primary_document: null,
    source_document_url: null,
    deal_index: null,
    amount: null,
    shares: null,
    detail: null,
    confidence: null,
    created_at: new Date().toISOString(),
    ...partial,
  };
}

describe("SpacRepo", () => {
  let repo: SpacRepo;
  beforeEach(async () => {
    resetDependencyInjectionsForTesting();
    await setupAllDatabases();
    repo = new SpacRepo();
  });

  it("returns events ascending by event_date", async () => {
    await repo.saveEvent(event({ cik: 1, accession_number: "b", event_type: "ipo", event_date: "2021-02-01" }));
    await repo.saveEvent(event({ cik: 1, accession_number: "a", event_type: "registration", event_date: "2020-12-01" }));
    const events = await repo.getEvents(1);
    expect(events.map((e) => e.event_type)).toEqual(["registration", "ipo"]);
  });
});
