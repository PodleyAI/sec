/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parsePricedProspectusCover } from "./pricedProspectusCover";

const importMetaDir = fileURLToPath(new URL(".", import.meta.url)).replace(/\/+$/, "");

/**
 * Cover of Cambridge Acquisition Corp. 424B4 0001104659-26-011571, as the
 * public primary document renders (CIK 2100125). The dollar size and unit
 * count are the prospectus headline, not a row in "The Offering".
 */
const CAMBRIDGE_COVER = `<html><body>
<p>PROSPECTUS</p>
<p>Filed Pursuant to Rule 424(b)(4)</p>
<p>Registration No. 333-292147</p>
<p>$200,000,000</p>
<p>Cambridge Acquisition Corp.</p>
<p>20,000,000 Units</p>
<p>Cambridge Acquisition Corp. is a blank check company incorporated as a
Cayman Islands exempted company and formed for the purpose of effecting a
merger.</p>
<p>This is an initial public offering of our securities. Each unit has an
offering price of $10.00. The underwriters have a 45-day option to purchase
up to an additional 3,000,000 units to cover over-allotments, if any. We
will withdraw up to $1,000,000 annually. Each whole warrant entitles the
holder to purchase one share at $11.50 per share.</p>
</body></html>`;

describe("parsePricedProspectusCover", () => {
  it("reads the headline dollar size and unit count from a Cambridge-shaped cover", () => {
    expect(parsePricedProspectusCover(CAMBRIDGE_COVER)).toEqual({
      gross_proceeds: 200_000_000,
      units_offered: 20_000_000,
    });
  });

  it("joins a dollar sign split from the amount across tags", () => {
    // Churchill's cover renders `$` and `360,000,000` in adjacent FONT tags;
    // tag-stripping inserts a space between them.
    const html = `<p>$</p><p>360,000,000</p><p>Churchill Capital Corp XII</p><p>36,000,000 Units</p>`;
    expect(parsePricedProspectusCover(html)).toEqual({
      gross_proceeds: 360_000_000,
      units_offered: 36_000_000,
    });
  });

  it("reads the committed Churchill Capital Corp XII 424B4 cover", () => {
    const html = readFileSync(
      join(importMetaDir, "../../html/mock_data/424/424b4_2114227_000121390026048413.htm"),
      "utf8"
    );
    expect(parsePricedProspectusCover(html)).toEqual({
      gross_proceeds: 360_000_000,
      units_offered: 36_000_000,
    });
  });

  it("does not treat The Offering body copy as a cover", () => {
    expect(
      parsePricedProspectusCover("<h1>THE OFFERING</h1><p>30,000,000 units at $10.00.</p>")
    ).toBeNull();
  });

  it("does not pick warrant strike or overallotment as the offering size", () => {
    const html = `<html><body>
<p>Filed Pursuant to Rule 424(b)(4)</p>
<p>$80,000,000</p>
<p>8,000,000 Units</p>
<p>This is an initial public offering of our securities. Each unit has an
offering price of $10.00. Warrants are exercisable at $11.50. The underwriters
may purchase up to an additional 1,200,000 units.</p>
</body></html>`;
    expect(parsePricedProspectusCover(html)).toEqual({
      gross_proceeds: 80_000_000,
      units_offered: 8_000_000,
    });
  });
});
