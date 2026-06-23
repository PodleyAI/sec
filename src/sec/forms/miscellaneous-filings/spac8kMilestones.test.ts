/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "bun:test";
import { mapItemCodesToSpacEvents } from "./spac8kMilestones";

describe("mapItemCodesToSpacEvents", () => {
  it("maps the four milestone item codes to lifecycle events", () => {
    expect(mapItemCodesToSpacEvents(["1.01"], "2021-03-01")).toEqual([
      { event_type: "definitive_agreement", event_date: "2021-03-01" },
    ]);
    expect(mapItemCodesToSpacEvents(["1.02"], "2021-03-01")).toEqual([
      { event_type: "terminated", event_date: "2021-03-01" },
    ]);
    expect(mapItemCodesToSpacEvents(["2.01"], "2021-03-01")).toEqual([
      { event_type: "completed", event_date: "2021-03-01" },
    ]);
    expect(mapItemCodesToSpacEvents(["5.07"], "2021-03-01")).toEqual([
      { event_type: "vote", event_date: "2021-03-01" },
    ]);
  });

  it("ignores non-milestone item codes", () => {
    expect(mapItemCodesToSpacEvents(["2.02", "9.01", "7.01"], "2021-03-01")).toEqual([]);
  });

  it("maps only the milestone items from a mixed filing", () => {
    const events = mapItemCodesToSpacEvents(["1.01", "7.01", "8.01", "9.01"], "2021-03-01");
    expect(events).toEqual([
      { event_type: "definitive_agreement", event_date: "2021-03-01" },
    ]);
  });
});
