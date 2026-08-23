/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { usableWebsiteUrl } from "./websiteUrl";

describe("usableWebsiteUrl", () => {
  it("keeps a real http(s) site", () => {
    expect(usableWebsiteUrl("https://example-spac.com")).toBe("https://example-spac.com");
    expect(usableWebsiteUrl("http://sponsor.example")).toBe("http://sponsor.example");
    expect(usableWebsiteUrl("www.gigcapitalglobal.com")).toBe("www.gigcapitalglobal.com");
  });

  it("drops a blank or placeholder the model invents when no site was stated", () => {
    for (const v of ["", "  ", "N/A", "none", "-", "TBD", "www. .com", "https://www. .com", "www..com"]) {
      expect(usableWebsiteUrl(v)).toBeNull();
    }
  });

  it("handles null and undefined", () => {
    expect(usableWebsiteUrl(null)).toBeNull();
    expect(usableWebsiteUrl(undefined)).toBeNull();
  });
});
