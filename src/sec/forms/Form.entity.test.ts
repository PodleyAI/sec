/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "bun:test";
import { Form_8_K } from "./miscellaneous-filings/Form_8_K";

describe("Form XML parser entity expansion hardening", () => {
  /**
   * "Billion laughs" — geometric entity expansion. With expansion enabled the
   * 10-deep nested chain `lol9 -> 10 x lol8 -> ... -> 10^9 x "lol"` produces a
   * ~1 GB string and pegs CPU. With `processEntities: false` the parser leaves
   * the `&lolN;` byte sequences literal, so the parse is bounded by input size.
   */
  const BILLION_LAUGHS = `<?xml version="1.0"?>
<!DOCTYPE edgarSubmission [
  <!ENTITY lol "lol">
  <!ENTITY lol1 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;">
  <!ENTITY lol2 "&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;">
  <!ENTITY lol3 "&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;">
  <!ENTITY lol4 "&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;">
  <!ENTITY lol5 "&lol4;&lol4;&lol4;&lol4;&lol4;&lol4;&lol4;&lol4;&lol4;&lol4;">
  <!ENTITY lol6 "&lol5;&lol5;&lol5;&lol5;&lol5;&lol5;&lol5;&lol5;&lol5;&lol5;">
  <!ENTITY lol7 "&lol6;&lol6;&lol6;&lol6;&lol6;&lol6;&lol6;&lol6;&lol6;&lol6;">
  <!ENTITY lol8 "&lol7;&lol7;&lol7;&lol7;&lol7;&lol7;&lol7;&lol7;&lol7;&lol7;">
  <!ENTITY lol9 "&lol8;&lol8;&lol8;&lol8;&lol8;&lol8;&lol8;&lol8;&lol8;&lol8;">
]>
<edgarSubmission>
  <primaryDocumentDescription>&lol9;</primaryDocumentDescription>
</edgarSubmission>`;

  it("parses a billion-laughs payload quickly without expanding entities", async () => {
    const start = performance.now();
    const result = await Form_8_K.parse("8-K", BILLION_LAUGHS);
    const elapsed = performance.now() - start;

    // The parse stays bounded by input size (well under a second; the assertion
    // is intentionally loose to avoid flakes on slow CI). With expansion enabled
    // the parser would spend minutes building a ~1 GB string before any timer
    // fires.
    expect(elapsed).toBeLessThan(50);
    // The parse succeeded and produced an object — no expansion crash, no OOM.
    expect(result).toBeDefined();
  });
});
