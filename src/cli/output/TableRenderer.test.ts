import { describe, expect, it } from "vitest";
import type { ColumnDef, RenderOptions } from "./TableRenderer";
import { __testing, renderTable } from "./TableRenderer";

const { escapeCsvValue } = __testing;

const columns: ReadonlyArray<ColumnDef> = [
  { key: "id", header: "ID", width: 6 },
  { key: "name", header: "Name", width: 10 },
  { key: "value", header: "Value", width: 8 },
];

const rows: ReadonlyArray<Record<string, unknown>> = [
  { id: 1, name: "Alice", value: 100 },
  { id: 2, name: "Bob", value: 200 },
];

describe("renderTable", () => {
  describe("json format", () => {
    it("returns valid parseable JSON matching input rows", () => {
      const result = renderTable(rows, columns, { format: "json" });
      const parsed = JSON.parse(result);
      expect(parsed).toEqual(rows);
    });

    it("pretty-prints with 2-space indentation", () => {
      const result = renderTable(rows, columns, { format: "json" });
      expect(result).toBe(JSON.stringify(rows, null, 2));
    });
  });

  describe("csv format", () => {
    it("has correct header row", () => {
      const result = renderTable(rows, columns, { format: "csv" });
      const lines = result.split("\n");
      expect(lines[0]).toBe("ID,Name,Value");
    });

    it("has correct data rows", () => {
      const result = renderTable(rows, columns, { format: "csv" });
      const lines = result.split("\n");
      expect(lines[1]).toBe("1,Alice,100");
      expect(lines[2]).toBe("2,Bob,200");
    });

    it("escapes values containing commas", () => {
      const rowsWithComma = [{ id: 1, name: "Doe, Jane", value: 50 }];
      const result = renderTable(rowsWithComma, columns, { format: "csv" });
      const lines = result.split("\n");
      expect(lines[1]).toBe('1,"Doe, Jane",50');
    });

    it("escapes values containing double quotes", () => {
      const rowsWithQuote = [{ id: 1, name: 'Say "hi"', value: 50 }];
      const result = renderTable(rowsWithQuote, columns, { format: "csv" });
      const lines = result.split("\n");
      expect(lines[1]).toBe('1,"Say ""hi""",50');
    });

    it("handles null and undefined values as empty strings", () => {
      const rowsWithNull = [{ id: 1, name: null, value: undefined }];
      const result = renderTable(rowsWithNull, columns, { format: "csv" });
      const lines = result.split("\n");
      expect(lines[1]).toBe("1,,");
    });

    it("defuses formula-injection prefixes by quoting them", () => {
      // Spreadsheets interpret cells starting with =/+/-/@ as formulas
      // (incl. data exfiltration via WEBSERVICE/HYPERLINK). Prefix with
      // a single quote so a CSV emitted from `sec query --format csv` is
      // safe to open in Excel/Sheets/Numbers.
      const rows = [
        { id: 1, name: "=cmd|' /C calc'!A0", value: 1 },
        { id: 2, name: "+1+1", value: 2 },
        { id: 3, name: "-1+1", value: 3 },
        { id: 4, name: "@SUM(A1:A9)", value: 4 },
        { id: 5, name: "\tleading tab", value: 5 },
      ];
      const result = renderTable(rows, columns, { format: "csv" });
      const lines = result.split("\n");
      expect(lines[1]).toBe(`1,'=cmd|' /C calc'!A0,1`);
      expect(lines[2]).toBe("2,'+1+1,2");
      expect(lines[3]).toBe("3,'-1+1,3");
      expect(lines[4]).toBe("4,'@SUM(A1:A9),4");
      expect(lines[5]).toBe("5,'\tleading tab,5");
    });

    it("does not prefix benign leading characters", () => {
      const rows = [
        { id: 1, name: "Alice", value: 1 },
        { id: 2, name: "1+1", value: 2 },
        { id: 3, name: "", value: 3 },
      ];
      const result = renderTable(rows, columns, { format: "csv" });
      const lines = result.split("\n");
      expect(lines[1]).toBe("1,Alice,1");
      expect(lines[2]).toBe("2,1+1,2");
      expect(lines[3]).toBe("3,,3");
    });
  });

  describe("table format", () => {
    it("contains header and data", () => {
      const result = renderTable(rows, columns, { format: "table" });
      expect(result).toContain("ID");
      expect(result).toContain("Name");
      expect(result).toContain("Alice");
      expect(result).toContain("Bob");
    });

    it("has separator line between header and data", () => {
      const result = renderTable(rows, columns, { format: "table" });
      const lines = result.split("\n");
      expect(lines[1]).toMatch(/^-+\s+-+\s+-+$/);
    });

    it("pads columns to specified width", () => {
      const result = renderTable(rows, columns, { format: "table" });
      const lines = result.split("\n");
      // Header "ID" padded to width 6
      expect(lines[0].startsWith("ID    ")).toBe(true);
    });

    it("truncates long values with ellipsis", () => {
      const longRows = [{ id: 1, name: "VeryLongNameThatExceedsWidth", value: 42 }];
      const result = renderTable(longRows, columns, { format: "table" });
      expect(result).toContain("VeryLon...");
    });

    it("shows pagination footer when total is provided", () => {
      const options: RenderOptions = { format: "table", total: 50, offset: 0, limit: 10 };
      const result = renderTable(rows, columns, options);
      expect(result).toContain("Showing 1-2 of 50 results");
      expect(result).toContain("(use --offset 2 for next page)");
    });

    it("omits next page hint when all results are shown", () => {
      const options: RenderOptions = { format: "table", total: 2, offset: 0, limit: 10 };
      const result = renderTable(rows, columns, options);
      expect(result).toContain("Showing 1-2 of 2 results");
      expect(result).not.toContain("--offset");
    });

    it("calculates correct range with offset", () => {
      const options: RenderOptions = { format: "table", total: 100, offset: 20, limit: 10 };
      const result = renderTable(rows, columns, options);
      expect(result).toContain("Showing 21-22 of 100 results");
      expect(result).toContain("(use --offset 22 for next page)");
    });

    it("shows 0-0 range when rows is empty but total is provided", () => {
      const options: RenderOptions = { format: "table", total: 10, offset: 0, limit: 10 };
      const result = renderTable([], columns, options);
      expect(result).toContain("Showing 0-0 of 10 results");
      expect(result).not.toContain("--offset");
    });
  });
});

describe("escapeCsvValue", () => {
  // Per OWASP CSV Injection (https://owasp.org/www-community/attacks/CSV_Injection),
  // cells beginning with =/+/-/@ (or TAB/CR after whitespace stripping) must be
  // neutralized with a leading single-quote before being handed to a spreadsheet.

  it("prefixes a single-quote when value starts with '='", () => {
    expect(escapeCsvValue("=cmd")).toBe("'=cmd");
  });

  it("prefixes a single-quote when value starts with '+'", () => {
    expect(escapeCsvValue("+cmd")).toBe("'+cmd");
  });

  it("prefixes a single-quote when value starts with '-'", () => {
    expect(escapeCsvValue("-cmd")).toBe("'-cmd");
  });

  it("prefixes a single-quote when value starts with '@'", () => {
    expect(escapeCsvValue("@cmd")).toBe("'@cmd");
  });

  it("prefixes a single-quote when value starts with TAB", () => {
    // \t is a dangerous lead in its own right (some loaders strip it
    // before formula parsing). Cell contains no comma/quote/CR/LF so the
    // result is NOT RFC 4180 quoted.
    expect(escapeCsvValue("\tcmd")).toBe("'\tcmd");
  });

  it("quotes (but does not prefix) a value that begins with bare CR", () => {
    // After splitting on \r\n | \r | \n, "\rcmd" decomposes to
    // ["", "\r", "cmd"]: the empty pre-CR line and the post-CR "cmd"
    // line are both non-dangerous, so no apostrophe is needed; the cell
    // is still RFC 4180 quoted because it contains a CR.
    expect(escapeCsvValue("\rcmd")).toBe('"\rcmd"');
  });

  it("defuses leading ASCII space before '=' (spreadsheets strip leading WS)", () => {
    expect(escapeCsvValue(" =cmd")).toBe("' =cmd");
  });

  it("defuses leading U+00A0 NBSP before '=' (spreadsheets strip NBSP too)", () => {
    // \u00A0 NO-BREAK SPACE — write as escape sequence so the test is
    // legible in diffs and editors cannot silently rewrite it.
    expect(escapeCsvValue("\u00A0=cmd")).toBe("'\u00A0=cmd");
  });

  // The regression tests below pin each codepoint LEADING_WS strips. The
  // string is built with explicit \uXXXX escapes; editors that "helpfully"
  // normalise NBSP / zero-width chars would otherwise silently defang the
  // assertion. Each test feeds a leading invisible char followed by `=`,
  // which is the most common spreadsheet formula bait.
  const invisibleLeads: ReadonlyArray<readonly [string, string]> = [
    ["U+00A0 NO-BREAK SPACE", "\u00A0"],
    ["U+00AD SOFT HYPHEN", "\u00AD"],
    ["U+034F COMBINING GRAPHEME JOINER", "\u034F"],
    ["U+061C ARABIC LETTER MARK", "\u061C"],
    ["U+115F HANGUL CHOSEONG FILLER", "\u115F"],
    ["U+1160 HANGUL JONGSEONG FILLER", "\u1160"],
    ["U+1680 OGHAM SPACE MARK", "\u1680"],
    ["U+180E MONGOLIAN VOWEL SEPARATOR", "\u180E"],
    ["U+2000 EN QUAD", "\u2000"],
    ["U+200B ZERO WIDTH SPACE", "\u200B"],
    ["U+200C ZERO WIDTH NON-JOINER", "\u200C"],
    ["U+200D ZERO WIDTH JOINER", "\u200D"],
    ["U+200E LEFT-TO-RIGHT MARK", "\u200E"],
    ["U+200F RIGHT-TO-LEFT MARK", "\u200F"],
    ["U+202A LEFT-TO-RIGHT EMBEDDING", "\u202A"],
    ["U+202F NARROW NO-BREAK SPACE", "\u202F"],
    ["U+2028 LINE SEPARATOR", "\u2028"],
    ["U+2029 PARAGRAPH SEPARATOR", "\u2029"],
    ["U+205F MEDIUM MATHEMATICAL SPACE", "\u205F"],
    ["U+2060 WORD JOINER", "\u2060"],
    ["U+3000 IDEOGRAPHIC SPACE", "\u3000"],
    ["U+3164 HANGUL FILLER", "\u3164"],
    ["U+FEFF ZERO WIDTH NO-BREAK SPACE / BOM", "\uFEFF"],
    ["U+FFA0 HALFWIDTH HANGUL FILLER", "\uFFA0"],
  ];
  for (const [name, ch] of invisibleLeads) {
    it(`defuses leading ${name} before '='`, () => {
      expect(escapeCsvValue(ch + "=cmd")).toBe("'" + ch + "=cmd");
    });
  }

  // Spot-check a few other dangerous leads behind an invisible char to
  // confirm DANGEROUS_LEAD matches the full set (=, +, -, @, \t, \r) after
  // LEADING_WS strips. \t and \r are dangerous *themselves* so they will
  // trigger the prefix even before any strip — the assertion still holds.
  it("defuses NBSP-prefixed '+'", () => {
    expect(escapeCsvValue("\u00A0+cmd")).toBe("'\u00A0+cmd");
  });
  it("defuses NBSP-prefixed '-'", () => {
    expect(escapeCsvValue("\u00A0-cmd")).toBe("'\u00A0-cmd");
  });
  it("defuses NBSP-prefixed '@'", () => {
    expect(escapeCsvValue("\u00A0@cmd")).toBe("'\u00A0@cmd");
  });
  it("defuses NBSP-prefixed TAB", () => {
    // After LEADING_WS strips the NBSP, the line starts with \t which is
    // itself a DANGEROUS_LEAD. Cell contains no comma/quote/CR/LF.
    expect(escapeCsvValue("\u00A0\tcmd")).toBe("'\u00A0\tcmd");
  });
  it("quotes (but does not prefix) NBSP followed by bare CR", () => {
    // After splitting on \r\n | \r | \n, "\u00A0\rcmd" decomposes to
    // ["\u00A0", "\r", "cmd"]. The first line after LEADING_WS strip
    // becomes "" — not dangerous. The post-CR line "cmd" is not a
    // formula lead either. So NO apostrophe is added; the cell is still
    // RFC 4180 quoted because it contains CR.
    expect(escapeCsvValue("\u00A0\rcmd")).toBe('"\u00A0\rcmd"');
  });

  it("leaves plain alphabetic values unchanged", () => {
    expect(escapeCsvValue("abc")).toBe("abc");
  });

  it("leaves plain numeric values unchanged", () => {
    expect(escapeCsvValue("123")).toBe("123");
  });

  it("defuses a dangerous line after LF inside a multi-line cell", () => {
    // Excel/Sheets re-parse every physical line of a quoted multi-line cell,
    // so the second line must also be defused.
    expect(escapeCsvValue("safe\n=cmd")).toBe('"safe\n\'=cmd"');
  });

  it("defuses a dangerous line after CRLF inside a multi-line cell", () => {
    expect(escapeCsvValue("safe\r\n=cmd")).toBe('"safe\r\n\'=cmd"');
  });

  it("defuses a dangerous line after a bare CR inside a multi-line cell", () => {
    // Splitting on \r\n | \r | \n means the second physical line
    // ("=cmd") is independently defused even when the separator is
    // a lone carriage return.
    expect(escapeCsvValue("safe\r=cmd")).toBe('"safe\r\'=cmd"');
  });

  it("quotes — but does not prefix — bare CR followed by a non-dangerous line", () => {
    // The post-CR line ("cmd") is not a formula lead, so no apostrophe;
    // the cell still needs RFC 4180 quoting because it contains a CR.
    expect(escapeCsvValue("safe\rcmd")).toBe('"safe\rcmd"');
  });

  it("defuses every dangerous follow-up line, leaving safe interleaved lines alone", () => {
    const input = "safe\n=danger1\nstillsafe\n+danger2\n@danger3";
    const expected = "\"safe\n'=danger1\nstillsafe\n'+danger2\n'@danger3\"";
    expect(escapeCsvValue(input)).toBe(expected);
  });

  it("wraps cells that contain a comma in double quotes", () => {
    expect(escapeCsvValue("a,b")).toBe('"a,b"');
  });

  it("doubles embedded double-quotes inside a wrapped cell", () => {
    expect(escapeCsvValue('he said "hi"')).toBe('"he said ""hi"""');
  });

  it("returns an empty string unchanged", () => {
    expect(escapeCsvValue("")).toBe("");
  });

  // Zero-width / format-control characters that spreadsheets silently
  // ignore at the start of a cell — each must be stripped before the
  // formula-lead check so attackers can't sneak a leading "=cmd" past us.

  it("defuses leading U+200B ZWSP before '='", () => {
    expect(escapeCsvValue("\u200B=cmd")).toBe("'\u200B=cmd");
  });

  it("defuses leading U+200C ZWNJ before '='", () => {
    expect(escapeCsvValue("\u200C=cmd")).toBe("'\u200C=cmd");
  });

  it("defuses leading U+200D ZWJ before '='", () => {
    expect(escapeCsvValue("\u200D=cmd")).toBe("'\u200D=cmd");
  });

  it("defuses leading U+200E LRM before '='", () => {
    expect(escapeCsvValue("\u200E=cmd")).toBe("'\u200E=cmd");
  });

  it("defuses leading U+200F RLM before '='", () => {
    expect(escapeCsvValue("\u200F=cmd")).toBe("'\u200F=cmd");
  });

  it("defuses leading U+00AD SHY before '='", () => {
    expect(escapeCsvValue("\u00AD=cmd")).toBe("'\u00AD=cmd");
  });

  it("defuses leading U+FEFF BOM before '='", () => {
    expect(escapeCsvValue("\uFEFF=cmd")).toBe("'\uFEFF=cmd");
  });

  it("defuses ZWSP + ASCII space + '=' (mixed leading-WS bypass)", () => {
    expect(escapeCsvValue("\u200B =cmd")).toBe("'\u200B =cmd");
  });

  it("leaves ZWSP followed by a benign char unchanged", () => {
    // Negative control — stripping leading ZWSP must NOT cause prefixing
    // of cells that aren't actually formulas after the strip.
    expect(escapeCsvValue("\u200Babc")).toBe("\u200Babc");
  });
});
