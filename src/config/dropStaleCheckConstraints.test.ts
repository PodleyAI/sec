/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The planner half of the stale-CHECK pass.
 *
 * Pure, so it is tested without a database — what matters is WHICH constraints
 * it selects, and every interesting case is a constraint it must decline. This
 * pass issues `DROP CONSTRAINT`; a false positive silently removes a guarantee
 * the database was enforcing, and nothing downstream would report it.
 */
import { describe, expect, it } from "vitest";
import {
  declaredUnsigned,
  isEmittedUnsignedCheck,
  planStaleCheckDrops,
  type LiveCheckConstraint,
} from "./dropStaleCheckConstraints";
import type { RegisteredTable } from "./tableRegistry";

const table = (name: string, properties: Record<string, unknown>): RegisteredTable =>
  ({
    table: name,
    schema: { properties },
    primaryKeyNames: ["id"],
  }) as unknown as RegisteredTable;

const check = (
  tableName: string,
  name: string,
  definition: string,
  columns: string[]
): LiveCheckConstraint => ({ table: tableName, name, definition, columns });

const UNBOUNDED = { type: "number" };
const BOUNDED = { type: "number", minimum: 0 };
const NULLABLE_UNBOUNDED = { anyOf: [{ type: "number" }, { type: "null" }] };
const NULLABLE_BOUNDED = { anyOf: [{ type: "number", minimum: 0 }, { type: "null" }] };

describe("declaredUnsigned", () => {
  it("mirrors the emitter: a numeric type with minimum >= 0", () => {
    expect(declaredUnsigned(BOUNDED)).toBe(true);
    expect(declaredUnsigned({ type: "integer", minimum: 5 })).toBe(true);
    expect(declaredUnsigned(UNBOUNDED)).toBe(false);
    expect(declaredUnsigned({ type: "number", minimum: -1 })).toBe(false);
    // A string with a minimum is not a numeric bound, and never got a CHECK.
    expect(declaredUnsigned({ type: "string", minimum: 0 })).toBe(false);
  });

  it("reads through the nullable union, as the emitter does", () => {
    expect(declaredUnsigned(NULLABLE_BOUNDED)).toBe(true);
    expect(declaredUnsigned(NULLABLE_UNBOUNDED)).toBe(false);
  });
});

describe("isEmittedUnsignedCheck", () => {
  it("matches both shapes Postgres renders for the emitted bound", () => {
    // A bigint column, and a numeric one — the cast is what differs.
    expect(isEmittedUnsignedCheck("CHECK ((cik >= 0))", "cik")).toBe(true);
    expect(
      isEmittedUnsignedCheck("CHECK ((disclosure_value >= (0)::numeric))", "disclosure_value")
    ).toBe(true);
  });

  it("declines anything else", () => {
    // An operator's own bound, sharing a column with the emitted one.
    expect(isEmittedUnsignedCheck("CHECK (((v >= 0) AND (v <= 100)))", "v")).toBe(false);
    // A different bound entirely.
    expect(isEmittedUnsignedCheck("CHECK ((v > 0))", "v")).toBe(false);
    expect(isEmittedUnsignedCheck("CHECK ((v >= 1))", "v")).toBe(false);
    // The right shape, attributed to the wrong column.
    expect(isEmittedUnsignedCheck("CHECK ((other >= 0))", "v")).toBe(false);
  });
});

describe("planStaleCheckDrops", () => {
  const declared = [
    table("crowdfunding_reports", { cik: BOUNDED, disclosure_value: NULLABLE_UNBOUNDED }),
  ];

  it("drops a bound the schema no longer declares", () => {
    const plan = planStaleCheckDrops(
      declared,
      [
        check(
          "crowdfunding_reports",
          "crowdfunding_reports_disclosure_value_check",
          "CHECK ((disclosure_value >= (0)::numeric))",
          ["disclosure_value"]
        ),
      ],
      "public"
    );
    expect(plan).toHaveLength(1);
    expect(plan[0]!.sql).toBe(
      'ALTER TABLE "public"."crowdfunding_reports" DROP CONSTRAINT "crowdfunding_reports_disclosure_value_check"'
    );
  });

  it("keeps a bound the schema still declares", () => {
    // `cik` is still `minimum: 0`, so its CHECK is current, not stale. Dropping
    // it would diverge an upgraded database from a fresh one in the opposite
    // direction to the drift this pass exists to fix.
    const plan = planStaleCheckDrops(
      declared,
      [
        check("crowdfunding_reports", "crowdfunding_reports_cik_check", "CHECK ((cik >= 0))", [
          "cik",
        ]),
      ],
      "public"
    );
    expect(plan).toEqual([]);
  });

  it("keeps a hand-written constraint on a relaxed column", () => {
    // Same column, same table, and the schema no longer bounds it — the ONLY
    // thing standing between this constraint and a DROP is the shape match.
    const plan = planStaleCheckDrops(
      declared,
      [
        check(
          "crowdfunding_reports",
          "sane_disclosure_range",
          "CHECK (((disclosure_value >= ('-1000000'::integer)::numeric) AND (disclosure_value <= (1000000)::numeric)))",
          ["disclosure_value"]
        ),
      ],
      "public"
    );
    expect(plan).toEqual([]);
  });

  it("keeps a multi-column check and one on a column the schema does not declare", () => {
    const plan = planStaleCheckDrops(
      declared,
      [
        check("crowdfunding_reports", "two_col", "CHECK ((disclosure_value >= 0))", [
          "disclosure_value",
          "cik",
        ]),
        // An operator's own column on the same table: not ours to reason about.
        check("crowdfunding_reports", "extra_check", "CHECK ((extra >= 0))", ["extra"]),
      ],
      "public"
    );
    expect(plan).toEqual([]);
  });

  it("is idempotent — a database already matching the schema plans nothing", () => {
    expect(planStaleCheckDrops(declared, [], "public")).toEqual([]);
  });

  it("qualifies the ALTER to the resolved schema", () => {
    // Unqualified it would resolve through `search_path` and could reach a
    // same-named table in another schema — the hazard every statement in this
    // directory is schema-qualified against.
    const plan = planStaleCheckDrops(
      declared,
      [check("crowdfunding_reports", "c", "CHECK ((disclosure_value >= 0))", ["disclosure_value"])],
      "staging"
    );
    expect(plan[0]!.sql).toContain('"staging"."crowdfunding_reports"');
  });
});
