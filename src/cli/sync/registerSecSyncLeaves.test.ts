/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it } from "vitest";
import { registerSecSyncLeaves } from "./registerSecSyncLeaves";
import { SYNC_FORM_DOMAINS } from "./syncFormDomains";
import { clearSyncLeavesForTesting, getSyncLeaf } from "./syncLeaves";

describe("registerSecSyncLeaves form domains", () => {
  afterEach(() => {
    clearSyncLeavesForTesting();
  });

  it("registers an inAll leaf for every form domain so amendments are not left to `sync forms D`", () => {
    registerSecSyncLeaves();
    for (const domain of Object.keys(SYNC_FORM_DOMAINS)) {
      const leaf = getSyncLeaf(domain);
      expect(leaf, `missing sync leaf for domain ${domain}`).toBeDefined();
      expect(leaf!.inAll, `${domain} should run as part of sync all`).toBe(true);
    }
  });
});
