/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { buildNameHistoryRows } from "./nameHistoryRows";

describe("buildNameHistoryRows", () => {
  it("maps each former name onto a closed interval and the current name onto the open one", () => {
    const rows = buildNameHistoryRows(1277021, {
      name: "VISANT HOLDING CORP",
      sic: "3911",
      formerNames: [
        {
          name: "JOSTENS HOLDING CORP",
          from: "2004-01-21T00:00:00.000Z",
          to: "2005-02-14T00:00:00.000Z",
        },
      ],
    });

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      cik: 1277021,
      valid_from: "2004-01-21T00:00:00.000Z",
      valid_to: "2005-02-14T00:00:00.000Z",
      name: "JOSTENS HOLDING CORP",
      sic: null,
    });
    expect(rows[1]).toMatchObject({
      cik: 1277021,
      valid_from: "2005-02-14T00:00:00.000Z",
      valid_to: null,
      name: "VISANT HOLDING CORP",
      sic: 3911,
    });
  });

  it("returns nothing for a company that never renamed", () => {
    expect(
      buildNameHistoryRows(320193, { name: "Apple Inc.", sic: "3571", formerNames: [] })
    ).toEqual([]);
    expect(buildNameHistoryRows(320193, { name: "Apple Inc.", sic: "3571" })).toEqual([]);
  });

  it("opens the current interval at the LAST rename, not the first", () => {
    const rows = buildNameHistoryRows(1820372, {
      name: "FAIRWOOD SUSTAINABILITY LLC",
      sic: "",
      formerNames: [
        {
          name: "JW Sustainable Solutions, Inc.",
          from: "2020-08-07T00:00:00.000Z",
          to: "2020-08-10T00:00:00.000Z",
        },
        {
          name: "FAIRWOOD SUSTAINABILITY, INC.",
          from: "2020-08-17T00:00:00.000Z",
          to: "2020-08-20T00:00:00.000Z",
        },
      ],
    });

    const open = rows.find((r) => r.valid_to === null);
    expect(open?.valid_from).toBe("2020-08-20T00:00:00.000Z");
    expect(open?.name).toBe("FAIRWOOD SUSTAINABILITY LLC");
  });

  it("leaves sic null on historical rows — the feed carries no historical SIC", () => {
    const rows = buildNameHistoryRows(1, {
      name: "Now Corp",
      sic: "6770",
      formerNames: [
        { name: "Then Corp", from: "2020-01-01T00:00:00.000Z", to: "2021-01-01T00:00:00.000Z" },
      ],
    });
    expect(rows[0].sic).toBeNull();
    expect(rows[1].sic).toBe(6770);
  });

  it("parses a blank sic to null rather than NaN", () => {
    const rows = buildNameHistoryRows(1, {
      name: "Now Corp",
      sic: "",
      formerNames: [
        { name: "Then Corp", from: "2020-01-01T00:00:00.000Z", to: "2021-01-01T00:00:00.000Z" },
      ],
    });
    expect(rows.find((r) => r.valid_to === null)?.sic).toBeNull();
  });

  it("skips entries with an unusable `from` — valid_from is half the primary key", () => {
    const rows = buildNameHistoryRows(1, {
      name: "Now Corp",
      formerNames: [
        { name: "No From", from: "", to: "2021-01-01T00:00:00.000Z" },
        { name: "Bad From", from: "not-a-date", to: "2021-01-01T00:00:00.000Z" },
        { name: "Good", from: "2020-01-01T00:00:00.000Z", to: "2021-01-01T00:00:00.000Z" },
      ],
    });
    expect(rows.map((r) => r.name)).toEqual(["Good", "Now Corp"]);
  });

  it("promotes the current name over a trailing former name EDGAR left open-ended", () => {
    // EDGAR sometimes leaves the last rename's `to` blank. `submission.name` is
    // the authoritative current name, so it takes the open interval; the former
    // name closes at the same instant it opened, which the duplicate-valid_from
    // collapse then resolves to the single current row.
    const rows = buildNameHistoryRows(1, {
      name: "Now Corp",
      formerNames: [{ name: "Then Corp", from: "2020-01-01T00:00:00.000Z", to: "" }],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      name: "Now Corp",
      valid_from: "2020-01-01T00:00:00.000Z",
      valid_to: null,
    });
  });

  it("leaves a trailing former name open when there is no current name to promote", () => {
    const rows = buildNameHistoryRows(1, {
      formerNames: [{ name: "Then Corp", from: "2020-01-01T00:00:00.000Z", to: "" }],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: "Then Corp", valid_to: null });
  });

  it("emits exactly one open interval", () => {
    const real = buildNameHistoryRows(1820372, {
      name: "FAIRWOOD SUSTAINABILITY LLC",
      sic: "",
      formerNames: [
        {
          name: "JW Sustainable Solutions, Inc.",
          from: "2020-08-07T00:00:00.000Z",
          to: "2020-08-10T00:00:00.000Z",
        },
        {
          name: "FAIRWOOD SUSTAINABILITY, INC.",
          from: "2020-08-17T00:00:00.000Z",
          to: "2020-08-20T00:00:00.000Z",
        },
      ],
    });
    expect(real.filter((r) => r.valid_to === null)).toHaveLength(1);

    // A closed interval followed by a blank-`to` one: the blank former row and
    // the current-name row would both be open.
    const mixed = buildNameHistoryRows(1, {
      name: "Now Corp",
      formerNames: [
        { name: "First", from: "2020-01-01T00:00:00.000Z", to: "2020-06-01T00:00:00.000Z" },
        { name: "Second", from: "2020-07-01T00:00:00.000Z", to: "" },
      ],
    });
    expect(mixed.filter((r) => r.valid_to === null)).toHaveLength(1);
  });

  it("closes a blank-`to` former name at the next rename", () => {
    const rows = buildNameHistoryRows(1, {
      name: "Now Corp",
      formerNames: [
        { name: "First", from: "2020-01-01T00:00:00.000Z", to: "" },
        { name: "Second", from: "2020-06-01T00:00:00.000Z", to: "2020-09-01T00:00:00.000Z" },
      ],
    });
    const first = rows.find((r) => r.name === "First");
    expect(first?.valid_to).toBe("2020-06-01T00:00:00.000Z");
    const open = rows.filter((r) => r.valid_to === null);
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({ name: "Now Corp", valid_from: "2020-09-01T00:00:00.000Z" });
  });

  it("collapses duplicate valid_from values so a bulk write cannot violate the PK", () => {
    const rows = buildNameHistoryRows(1, {
      name: "Now Corp",
      formerNames: [
        { name: "First", from: "2020-01-01T00:00:00.000Z", to: "2020-06-01T00:00:00.000Z" },
        { name: "Second", from: "2020-01-01T00:00:00.000Z", to: "2020-07-01T00:00:00.000Z" },
      ],
    });
    const froms = rows.map((r) => r.valid_from);
    expect(new Set(froms).size).toBe(froms.length);
  });
});
