/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import type { SpacHistory } from "../../storage/spac/SpacHistorySchema";
import { diffHistory } from "./spacDetail";

function snapshot(overrides: Partial<SpacHistory>): SpacHistory {
  return {
    cik: 1,
    valid_from: "2025-01-01T00:00:00.000Z",
    valid_to: null,
    status: null,
    change_source: "S-1",
    ...overrides,
  } as SpacHistory;
}

describe("diffHistory", () => {
  it("treats the first snapshot's non-null fields as what it established", () => {
    const [first] = diffHistory([snapshot({ status: "registered", spac_name: "Acme" })]);
    expect(first!.changes.map((c) => c.field).sort()).toEqual(["spac_name", "status"]);
  });

  it("reports only the fields a later snapshot changed", () => {
    const rows = [
      snapshot({ valid_from: "2025-01-01T00:00:00.000Z", status: "registered", spac_name: "Acme" }),
      snapshot({ valid_from: "2025-06-01T00:00:00.000Z", status: "ipo", spac_name: "Acme" }),
    ];
    const [, second] = diffHistory(rows);
    expect(second!.changes).toEqual([{ field: "status", from: "registered", to: "ipo" }]);
  });

  it("orders snapshots by validity even when the rows arrive out of order", () => {
    const rows = [
      snapshot({ valid_from: "2025-06-01T00:00:00.000Z", status: "ipo" }),
      snapshot({ valid_from: "2025-01-01T00:00:00.000Z", status: "registered" }),
    ];
    expect(diffHistory(rows).map((s) => s.row.status)).toEqual(["registered", "ipo"]);
  });

  it("does not report the bookkeeping columns that change on every snapshot", () => {
    const rows = [
      snapshot({ valid_from: "2025-01-01T00:00:00.000Z", valid_to: "2025-06-01T00:00:00.000Z" }),
      snapshot({ valid_from: "2025-06-01T00:00:00.000Z", change_source: "424B4" }),
    ];
    const [, second] = diffHistory(rows);
    // Listing `valid_from` / `valid_to` / `change_source` would bury the one or
    // two fields a snapshot actually records.
    expect(second!.changes).toEqual([]);
  });

  it("treats a value becoming null as a change", () => {
    const rows = [
      snapshot({ valid_from: "2025-01-01T00:00:00.000Z", surviving_name: "Newco" }),
      snapshot({ valid_from: "2025-06-01T00:00:00.000Z", surviving_name: null }),
    ];
    const [, second] = diffHistory(rows);
    expect(second!.changes).toEqual([{ field: "surviving_name", from: "Newco", to: null }]);
  });
});
