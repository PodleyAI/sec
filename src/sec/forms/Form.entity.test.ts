/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { Form_D } from "./exempt-offerings/Form_D";
import { decodePredefinedEntities, stripDoctype } from "./Form";
import { Form_8_K } from "./miscellaneous-filings/Form_8_K";

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

describe("Form XML parser entity expansion hardening — stripDoctype bypass closures", () => {
  // The stripDoctype regex anchors at the start of the document and only
  // permits an optional `<?xml ...?>` declaration before the DOCTYPE. A
  // filer who slips a leading XML comment, a leading non-xml processing
  // instruction, or a `]>`/`[` inside a quoted PUBLIC id can defeat that
  // regex. The real seal is `processEntities: { enabled: false }` in the
  // XMLParser config — once expansion is off, no filer-declared entity
  // can fire regardless of whether the DOCTYPE survives the strip.

  it("a DOCTYPE preceded by an XML comment does NOT expand a filer-declared entity", async () => {
    const xml = `<?xml version="1.0"?>
<!-- innocent leading comment -->
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
    expect(result.primaryIssuer.entityName).not.toBe("PWNED");
    expect(result.primaryIssuer.entityName).toBe("&xxe;");
  });

  it("a DOCTYPE preceded by a leading processing instruction does NOT expand a filer-declared entity", async () => {
    const xml = `<?xml version="1.0"?>
<?xml-stylesheet href="x.xsl"?>
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
    expect(result.primaryIssuer.entityName).not.toBe("PWNED");
    expect(result.primaryIssuer.entityName).toBe("&xxe;");
  });

  it("a DOCTYPE with `]>` inside a quoted PUBLIC id does NOT expand a filer-declared entity", async () => {
    // The closing `]>` is inside the quoted PUBLIC literal so a regex on
    // raw text cannot distinguish the literal `]>` from the end of the
    // internal subset; the legacy stripDoctype mis-terminates and would
    // let `<!ENTITY xxe "PWNED">` reach the parser. The post-parse seal
    // (processEntities disabled) is what guarantees PWNED never appears
    // in the output regardless of how badly stripDoctype mangled the
    // prefix — even if the residual debris also crashes the parse, the
    // expanded literal `PWNED` is what we're proving stays absent.
    const xml = `<?xml version="1.0"?>
<!DOCTYPE edgarSubmission PUBLIC "tricky]>" "x.dtd" [
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
    const result = await Form_D.parse("D", xml);
    expect(JSON.stringify(result ?? null)).not.toContain("PWNED");
  });

  it("a DOCTYPE with `[` inside a quoted PUBLIC id does NOT expand a filer-declared entity", async () => {
    const xml = `<?xml version="1.0"?>
<!DOCTYPE edgarSubmission PUBLIC "open[bracket" "x.dtd" [
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
    const result = await Form_D.parse("D", xml);
    expect(JSON.stringify(result ?? null)).not.toContain("PWNED");
  });

  it("all five predefined entities round-trip; `&amp;lt;` decodes one-pass to `&lt;`, not `<`", async () => {
    const xml = `<?xml version="1.0"?>
<edgarSubmission>
  <schemaVersion>A &amp; B &lt; C &gt; D &quot;E&quot; F &apos;G&apos;</schemaVersion>
  <submissionType>D</submissionType>
  <primaryIssuer>
    <cik>0000000001</cik>
    <entityName>round &amp;lt; trip</entityName>
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
    // Single-pass: `&amp;lt;` -> `&lt;` (NOT `<`). The post-walker matches
    // `&amp;` first and consumes it; the literal `lt;` that follows does
    // not start with `&` and so is never re-scanned for a second pass.
    expect(result.primaryIssuer.entityName).toBe("round &lt; trip");
  });
});

describe("decodePredefinedEntities", () => {
  it("decodes all five predefined entities in a flat string", () => {
    expect(decodePredefinedEntities("&amp; &lt; &gt; &quot; &apos;")).toBe(`& < > " '`);
  });

  it("recurses into nested objects and arrays", () => {
    const input = {
      name: "A &amp; B",
      tags: ["x &lt; y", { note: "&gt;ok&gt;" }],
      meta: { display: "&quot;Q&quot;", child: { v: "it&apos;s" } },
    };
    const out = decodePredefinedEntities(input);
    expect(out).toEqual({
      name: "A & B",
      tags: ["x < y", { note: ">ok>" }],
      meta: { display: `"Q"`, child: { v: "it's" } },
    });
    // The walker returns new plain containers — original input is untouched.
    expect(input.name).toBe("A &amp; B");
    expect(input.tags[0]).toBe("x &lt; y");
  });

  it("leaves non-string primitives and Date untouched", () => {
    const d = new Date("2026-01-01T00:00:00Z");
    const input = {
      n: 42,
      b: true,
      nil: null as null,
      und: undefined as undefined,
      d,
      // Untyped arrays of primitives still recurse (each element is checked).
      mixed: [1, false, null, "&amp;"],
    };
    const out: any = decodePredefinedEntities(input);
    expect(out.n).toBe(42);
    expect(out.b).toBe(true);
    expect(out.nil).toBeNull();
    expect(out.und).toBeUndefined();
    // Date is not a plain Object — walker passes it through as-is.
    expect(out.d).toBe(d);
    expect(out.mixed).toEqual([1, false, null, "&"]);
  });

  it("does NOT double-decode: `&amp;lt;` -> `&lt;` (one pass)", () => {
    expect(decodePredefinedEntities("&amp;lt;")).toBe("&lt;");
    expect(decodePredefinedEntities("&amp;amp;")).toBe("&amp;");
  });

  it("leaves typed arrays untouched (not walked as plain arrays)", () => {
    const buf = new Uint8Array([1, 2, 3]);
    const out = decodePredefinedEntities(buf);
    expect(out).toBe(buf);
  });
});
