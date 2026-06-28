/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "bun:test";
import { Form_8_K } from "./miscellaneous-filings/Form_8_K";
import { Form_D } from "./exempt-offerings/Form_D";
import { stripDoctype } from "./Form";

describe("Form XML parser entity expansion hardening", () => {
  /**
   * "Billion laughs" — geometric entity expansion. With expansion enabled the
   * 10-deep nested chain `lol9 -> 10 x lol8 -> ... -> 10^9 x "lol"` produces a
   * ~1 GB string and pegs CPU. With bounded `processEntities` + DOCTYPE strip,
   * the filer-declared entities never reach the parser and `&lolN;` byte
   * sequences remain literal, so the parse is bounded by input size.
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

  it("round-trips a predefined ampersand entity in a Form D entityName", async () => {
    const xml = `<?xml version="1.0"?>
<edgarSubmission>
  <schemaVersion>X0708</schemaVersion>
  <submissionType>D</submissionType>
  <primaryIssuer>
    <cik>0000000001</cik>
    <entityName>Mac Accounting Group &amp;amp; CPAs, LLP</entityName>
    <issuerAddress>
      <street1>1 Main St</street1>
      <city>Anywhere</city>
      <stateOrCountry>CA</stateOrCountry>
      <stateOrCountryDescription>CALIFORNIA</stateOrCountryDescription>
      <zipCode>90001</zipCode>
    </issuerAddress>
    <issuerPhoneNumber>5555555555</issuerPhoneNumber>
  </primaryIssuer>
</edgarSubmission>`;
    const result: any = await Form_D.parse("D", xml);
    // The filer double-encoded an `&` so the body reads `&amp;amp;`. One decode
    // step (the parser's predefined-entity pass) yields `&amp;`, which is the
    // intended literal display form for "Mac Accounting Group & CPAs, LLP".
    expect(result.primaryIssuer.entityName).toBe("Mac Accounting Group &amp; CPAs, LLP");
  });

  it("strips a DOCTYPE-declared custom entity so it parses as literal text", async () => {
    const xml = `<?xml version="1.0"?>
<!DOCTYPE edgarSubmission [
  <!ENTITY xxe "PWNED">
]>
<edgarSubmission>
  <schemaVersion>X0708</schemaVersion>
  <submissionType>D</submissionType>
  <primaryIssuer>
    <cik>0000000001</cik>
    <entityName>&xxe;</entityName>
    <issuerAddress>
      <street1>1 Main St</street1>
      <city>Anywhere</city>
      <stateOrCountry>CA</stateOrCountry>
      <stateOrCountryDescription>CALIFORNIA</stateOrCountryDescription>
      <zipCode>90001</zipCode>
    </issuerAddress>
    <issuerPhoneNumber>5555555555</issuerPhoneNumber>
  </primaryIssuer>
</edgarSubmission>`;
    const result: any = await Form_D.parse("D", xml);
    // With DOCTYPE stripped, the parser has no definition for `xxe` — the byte
    // sequence remains literal rather than expanding to "PWNED".
    expect(result.primaryIssuer.entityName).not.toBe("PWNED");
    expect(result.primaryIssuer.entityName).toBe("&xxe;");
  });

  it("decodes the five predefined XML entities in element text", async () => {
    // `&apos;` is not legal in a Form D entityName regex, so use the
    // schemaVersion text channel for full coverage and entityName for the
    // ampersand/lt/gt subset.
    const xml = `<?xml version="1.0"?>
<edgarSubmission>
  <schemaVersion>A &amp; B &lt; C &gt; D &quot;E&quot; F &apos;G&apos;</schemaVersion>
  <submissionType>D</submissionType>
  <primaryIssuer>
    <cik>0000000001</cik>
    <entityName>A &amp; B</entityName>
    <issuerAddress>
      <street1>1 Main St</street1>
      <city>Anywhere</city>
      <stateOrCountry>CA</stateOrCountry>
      <stateOrCountryDescription>CALIFORNIA</stateOrCountryDescription>
      <zipCode>90001</zipCode>
    </issuerAddress>
    <issuerPhoneNumber>5555555555</issuerPhoneNumber>
  </primaryIssuer>
</edgarSubmission>`;
    const result: any = await Form_D.parse("D", xml);
    expect(result.schemaVersion).toBe(`A & B < C > D "E" F 'G'`);
    expect(result.primaryIssuer.entityName).toBe("A & B");
  });
});

describe("stripDoctype helper", () => {
  it("removes a simple DOCTYPE declaration", () => {
    const out = stripDoctype(`<?xml version="1.0"?>\n<!DOCTYPE foo>\n<foo/>`);
    expect(out).not.toContain("DOCTYPE");
    expect(out).toContain("<foo/>");
  });

  it("removes a DOCTYPE with a bracketed internal subset (including ENTITY decls)", () => {
    const out = stripDoctype(
      `<!DOCTYPE foo [ <!ENTITY xxe "PWNED"> <!ENTITY a "b"> ]>\n<foo>&xxe;</foo>`
    );
    expect(out).not.toContain("DOCTYPE");
    expect(out).not.toContain("ENTITY");
    expect(out).toContain("<foo>&xxe;</foo>");
  });

  it("leaves XML without a DOCTYPE unchanged", () => {
    const xml = `<?xml version="1.0"?><foo>bar</foo>`;
    expect(stripDoctype(xml)).toBe(xml);
  });
});
