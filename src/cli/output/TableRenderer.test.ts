import { describe, expect, it } from "bun:test";
import { renderTable, __testing } from "./TableRenderer";
import type { ColumnDef, RenderOptions } from "./TableRenderer";

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
    expect(escapeCsvValue("\tcmd")).toBe("'\tcmd");
  });

  it("prefixes a single-quote when value starts with CR", () => {
    // CR alone forces RFC 4180 quoting too because the cell contains a CR.
    expect(escapeCsvValue("\rcmd")).toBe('"\'\rcmd"');
  });

  it("defuses leading ASCII space before '=' (spreadsheets strip leading WS)", () => {
    expect(escapeCsvValue(" =cmd")).toBe("' =cmd");
  });

  it("defuses leading U+00A0 NBSP before '=' (spreadsheets strip NBSP too)", () => {
    expect(escapeCsvValue(" =cmd")).toBe("' =cmd");
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

  it("defuses every dangerous follow-up line, leaving safe interleaved lines alone", () => {
    const input = "safe\n=danger1\nstillsafe\n+danger2\n@danger3";
    const expected =
      '"safe\n\'=danger1\nstillsafe\n\'+danger2\n\'@danger3"';
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
});
