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

  it("registers an inAll leaf for every sec form domain it also sweeps", () => {
    // Two domains name forms this package parses for a leaf it does not
    // register: `form-d` belongs to a downstream `adv` leaf, and `spacs` to a
    // downstream lifecycle leaf. Both entries stay because the sweep vocabulary
    // is this package's — a deployment supplying either reading has to be able
    // to name its forms — and a leaf is what a deployment adds on top.
    registerSecSyncLeaves();
    for (const domain of Object.keys(SYNC_FORM_DOMAINS)) {
      if (domain === "form-d" || domain === "spacs") continue;
      const leaf = getSyncLeaf(domain);
      expect(leaf, `missing sync leaf for domain ${domain}`).toBeDefined();
      expect(leaf!.inAll, `${domain} should run as part of sync all`).toBe(true);
    }
  });
});
