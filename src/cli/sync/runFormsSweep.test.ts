/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { runFormsSweep } from "./runFormsSweep";

describe("runFormsSweep — empty resolved form list", () => {
  it("throws rather than falling back to a full-corpus sweep", async () => {
    await expect(runFormsSweep({ formTypes: [] })).rejects.toThrow(/resolved to no forms to sweep/);
  });

  it("names the domain or tokens that resolved to nothing", async () => {
    await expect(
      runFormsSweep({ formTypes: [], requestedFrom: "sync domain 'portals'" })
    ).rejects.toThrow(/sync domain 'portals'/);
  });
});
