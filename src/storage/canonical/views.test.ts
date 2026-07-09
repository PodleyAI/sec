/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { CURRENT_CANONICAL_VIEW_DDL } from "./views";

describe("current_canonical_* views DDL", () => {
  it("emits eight CREATE VIEW statements", () => {
    expect(CURRENT_CANONICAL_VIEW_DDL).toHaveLength(8);
    for (const ddl of CURRENT_CANONICAL_VIEW_DDL) {
      expect(ddl).toMatch(/^CREATE VIEW IF NOT EXISTS /);
      expect(ddl).toMatch(/JOIN component_versions/);
      expect(ddl).toMatch(/cv\.slot = 'current'/);
    }
  });

  it("each view filters by the appropriate resolver component_id", () => {
    const personDdls = CURRENT_CANONICAL_VIEW_DDL.filter((d) =>
      d.includes("component_id = 'person'")
    );
    const companyDdls = CURRENT_CANONICAL_VIEW_DDL.filter((d) =>
      d.includes("component_id = 'company'")
    );
    expect(personDdls).toHaveLength(4);
    expect(companyDdls).toHaveLength(4);
  });
});
