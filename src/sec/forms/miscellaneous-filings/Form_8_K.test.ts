/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { beforeEach, describe, expect, it } from "vitest";
import { resetDependencyInjectionsForTesting } from "../../../config/TestingDI";
import { Form8KEventRepo } from "../../../storage/form-8k-event/Form8KEventRepo";
import { Form_8_K, Form_8_K_ITEMS } from "./Form_8_K";
import { processForm8K } from "./Form_8_K.storage";

/**
 * Metadata for each downloaded 8-K filing, mapping accession number (no dashes)
 * to the filing index data that would normally come from the SEC submissions API.
 */
const FILING_METADATA: Record<
  string,
  { cik: number; form: "8-K" | "8-K/A"; items: string; filing_date: string; report_date: string }
> = {
  // Apple - Items 2.02,9.01 (Results of Operations)
  "000032019325000007": {
    cik: 320193,
    form: "8-K",
    items: "2.02,9.01",
    filing_date: "2025-01-30",
    report_date: "2025-01-30",
  },
  // Apple - Items 5.07 (Shareholder vote)
  "000114036125005876": {
    cik: 320193,
    form: "8-K",
    items: "5.07",
    filing_date: "2025-02-25",
    report_date: "2025-02-25",
  },
  // Apple - Items 7.01 (Reg FD Disclosure)
  "000114036124040659": {
    cik: 320193,
    form: "8-K",
    items: "7.01",
    filing_date: "2024-09-10",
    report_date: "2024-09-10",
  },
  // Apple - Items 5.03,9.01 (Amendments to articles)
  "000114036124038403": {
    cik: 320193,
    form: "8-K",
    items: "5.03,9.01",
    filing_date: "2024-08-23",
    report_date: "2024-08-23",
  },
  // Apple - Items 8.01,9.01 (Other Events)
  "000114036125018400": {
    cik: 320193,
    form: "8-K",
    items: "8.01,9.01",
    filing_date: "2025-05-12",
    report_date: "2025-05-12",
  },
  // Microsoft - Items 2.02,7.01,9.01 (Results + Reg FD)
  "000119312525256310": {
    cik: 789019,
    form: "8-K",
    items: "2.02,7.01,9.01",
    filing_date: "2025-10-29",
    report_date: "2025-10-28",
  },
  // Microsoft - Items 5.02 (Departure of officers)
  "000119312525225125": {
    cik: 789019,
    form: "8-K",
    items: "5.02",
    filing_date: "2025-09-30",
    report_date: "2025-09-30",
  },
  // Amazon - Items 1.01,7.01,8.01,9.01 (Material Agreement)
  "000110465926021050": {
    cik: 1018724,
    form: "8-K",
    items: "1.01,7.01,8.01,9.01",
    filing_date: "2026-02-27",
    report_date: "2026-02-27",
  },
  // Amazon - Items 2.02,9.01
  "000101872426000002": {
    cik: 1018724,
    form: "8-K",
    items: "2.02,9.01",
    filing_date: "2026-02-05",
    report_date: "2026-02-05",
  },
  // Tesla - Items 5.02,5.07,9.01 (Departure + Shareholder vote)
  "000110465925108507": {
    cik: 1318605,
    form: "8-K",
    items: "5.02,5.07,9.01",
    filing_date: "2025-11-07",
    report_date: "2025-11-07",
  },
  // Tesla - Items 2.02,9.01
  "000162828025045861": {
    cik: 1318605,
    form: "8-K",
    items: "2.02,9.01",
    filing_date: "2025-10-22",
    report_date: "2025-10-22",
  },
  // Meta - Items 5.02
  "000162828026002429": {
    cik: 1326801,
    form: "8-K",
    items: "5.02",
    filing_date: "2026-01-16",
    report_date: "2026-01-12",
  },
  // Meta - Items 8.01,9.01
  "000119312525262593": {
    cik: 1326801,
    form: "8-K",
    items: "8.01,9.01",
    filing_date: "2025-11-03",
    report_date: "2025-11-03",
  },
  // Alphabet - Items 8.01,9.01
  "000119312525269979": {
    cik: 1652044,
    form: "8-K",
    items: "8.01,9.01",
    filing_date: "2025-11-06",
    report_date: "2025-11-06",
  },
  // Alphabet - Items 2.02,9.01
  "000165204425000087": {
    cik: 1652044,
    form: "8-K",
    items: "2.02,9.01",
    filing_date: "2025-10-29",
    report_date: "2025-10-29",
  },
};

describe("Form_8_K", () => {
  let eventRepo: Form8KEventRepo;

  beforeEach(() => {
    resetDependencyInjectionsForTesting();
    eventRepo = new Form8KEventRepo();
  });

  describe("parsing real SEC EDGAR 8-K filings", () => {
    it("should parse all 8-K files from mock_data directory", async () => {
      const mockDataDir = join(__dirname, "mock_data", "form-8k");
      const htmFiles = readdirSync(mockDataDir).filter((file) => file.endsWith(".htm"));
      const xmlFiles = readdirSync(mockDataDir).filter((file) => file.endsWith(".xml"));
      const allFiles = [...htmFiles, ...xmlFiles];

      expect(allFiles.length).toBeGreaterThan(0);

      const results: Array<{
        file: string;
        accessionNumber: string;
        success: boolean;
        error?: string;
      }> = [];

      for (const file of allFiles) {
        const content = readFileSync(join(mockDataDir, file), "utf-8");
        const accessionNumber = file.replace(/-primary_doc\.(htm|xml)$/, "");

        try {
          const form8K = await Form_8_K.parse("8-K", content);

          expect(form8K).toBeDefined();
          expect(typeof form8K).toBe("object");

          results.push({ file, accessionNumber, success: true });
        } catch (error) {
          results.push({
            file,
            accessionNumber,
            error: error instanceof Error ? error.message : String(error),
            success: false,
          });
        }
      }

      const failedFiles = results.filter((r) => !r.success);
      expect(failedFiles.length).toBe(0);
      expect(results.filter((r) => r.success).length).toBe(allFiles.length);
    });

    it("should return empty object for all HTML/XHTML primary documents", async () => {
      const mockDataDir = join(__dirname, "mock_data", "form-8k");
      const htmFiles = readdirSync(mockDataDir).filter((file) => file.endsWith(".htm"));

      for (const file of htmFiles) {
        const content = readFileSync(join(mockDataDir, file), "utf-8");
        const form8K = await Form_8_K.parse("8-K", content);

        expect(form8K).toEqual({});
      }
    });

    it("should parse XML edgarSubmission documents correctly", async () => {
      const mockDataDir = join(__dirname, "mock_data", "form-8k");
      const xmlFiles = readdirSync(mockDataDir).filter((file) => file.endsWith(".xml"));

      for (const file of xmlFiles) {
        const content = readFileSync(join(mockDataDir, file), "utf-8");
        const form8K = await Form_8_K.parse("8-K", content);

        if (content.includes("edgarSubmission")) {
          expect(form8K.formData).toBeDefined();
        }
      }
    });

    it("should reject invalid form types", async () => {
      await expect(Form_8_K.parse("10-K" as any, "<html/>")).rejects.toThrow("Invalid form");
    });

    it("should accept both 8-K and 8-K/A form types", async () => {
      const html = "<html><body>test</body></html>";
      const result8K = await Form_8_K.parse("8-K", html);
      const result8KA = await Form_8_K.parse("8-K/A", html);

      expect(result8K).toEqual({});
      expect(result8KA).toEqual({});
    });
  });

  describe("comprehensive storage with real SEC filings", () => {
    it("should parse and store all 8-K files with their filing metadata", async () => {
      const mockDataDir = join(__dirname, "mock_data", "form-8k");
      const htmFiles = readdirSync(mockDataDir).filter((file) => file.endsWith(".htm"));

      expect(htmFiles.length).toBeGreaterThan(0);

      let totalEventsStored = 0;
      const failedFiles: string[] = [];

      for (const file of htmFiles) {
        const content = readFileSync(join(mockDataDir, file), "utf-8");
        const accessionNumber = file.replace(/-primary_doc\.htm$/, "");
        const metadata = FILING_METADATA[accessionNumber];
        if (!metadata) continue;

        try {
          const form8K = await Form_8_K.parse(metadata.form, content);

          await processForm8K({
            cik: metadata.cik,
            accession_number: accessionNumber,
            filing_date: metadata.filing_date,
            form: metadata.form,
            items: metadata.items,
            report_date: metadata.report_date,
            form8K,
            extractor_id: "8-K",
            extractor_version: "1.0.0",
          });

          const events = await eventRepo.getEventsByAccession(metadata.cik, accessionNumber);
          const expectedItemCount = metadata.items.split(",").length;
          expect(events.length).toBe(expectedItemCount);
          totalEventsStored += events.length;
        } catch (error) {
          failedFiles.push(`${file}: ${error}`);
        }
      }

      expect(failedFiles.length).toBe(0);
      expect(totalEventsStored).toBeGreaterThan(0);
    });

    it("should store correct item descriptions for all event items", async () => {
      const mockDataDir = join(__dirname, "mock_data", "form-8k");

      for (const [accessionNumber, metadata] of Object.entries(FILING_METADATA)) {
        const file = `${accessionNumber}-primary_doc.htm`;
        const filePath = join(mockDataDir, file);
        try {
          const content = readFileSync(filePath, "utf-8");
          const form8K = await Form_8_K.parse(metadata.form, content);

          await processForm8K({
            cik: metadata.cik,
            accession_number: accessionNumber,
            filing_date: metadata.filing_date,
            form: metadata.form,
            items: metadata.items,
            report_date: metadata.report_date,
            form8K,
            extractor_id: "8-K",
            extractor_version: "1.0.0",
          });
        } catch {
          continue;
        }
      }

      for (const [accessionNumber, metadata] of Object.entries(FILING_METADATA)) {
        const events = await eventRepo.getEventsByAccession(metadata.cik, accessionNumber);
        for (const event of events) {
          if (Form_8_K_ITEMS[event.item_code]) {
            expect(event.item_description).toBe(Form_8_K_ITEMS[event.item_code]);
          }
        }
      }
    });
  });

  describe("item type coverage", () => {
    it("should correctly store Item 1.01 (Material Definitive Agreement)", async () => {
      const form8K = await Form_8_K.parse("8-K", "<html/>");

      await processForm8K({
        cik: 1018724,
        accession_number: "000110465926021050",
        filing_date: "2026-02-27",
        form: "8-K",
        items: "1.01,7.01,8.01,9.01",
        report_date: "2026-02-27",
        form8K,
        extractor_id: "8-K",
        extractor_version: "1.0.0",
      });

      const events = await eventRepo.getEventsByAccession(1018724, "000110465926021050");
      expect(events.length).toBe(4);

      const item101 = events.find((e) => e.item_code === "1.01");
      expect(item101).toBeDefined();
      expect(item101?.item_description).toBe("Entry into a Material Definitive Agreement");
    });

    it("should correctly store Item 2.02 (Results of Operations)", async () => {
      const content = readFileSync(
        join(__dirname, "mock_data", "form-8k", "000032019325000007-primary_doc.htm"),
        "utf-8"
      );
      const form8K = await Form_8_K.parse("8-K", content);

      await processForm8K({
        cik: 320193,
        accession_number: "000032019325000007",
        filing_date: "2025-01-30",
        form: "8-K",
        items: "2.02,9.01",
        report_date: "2025-01-30",
        form8K,
        extractor_id: "8-K",
        extractor_version: "1.0.0",
      });

      const events = await eventRepo.getEventsByAccession(320193, "000032019325000007");
      const item202 = events.find((e) => e.item_code === "2.02");
      expect(item202).toBeDefined();
      expect(item202?.item_description).toBe("Results of Operations and Financial Condition");
      expect(item202?.filing_date).toBe("2025-01-30");
      expect(item202?.report_date).toBe("2025-01-30");
      expect(item202?.is_amendment).toBe(false);
    });

    it("should correctly store Item 5.02 (Departure of Officers)", async () => {
      const content = readFileSync(
        join(__dirname, "mock_data", "form-8k", "000119312525225125-primary_doc.htm"),
        "utf-8"
      );
      const form8K = await Form_8_K.parse("8-K", content);

      await processForm8K({
        cik: 789019,
        accession_number: "000119312525225125",
        filing_date: "2025-09-30",
        form: "8-K",
        items: "5.02",
        report_date: "2025-09-30",
        form8K,
        extractor_id: "8-K",
        extractor_version: "1.0.0",
      });

      const events = await eventRepo.getEventsByAccession(789019, "000119312525225125");
      expect(events.length).toBe(1);
      expect(events[0].item_code).toBe("5.02");
      expect(events[0].item_description).toContain("Departure of Directors");
    });

    it("should correctly store Item 5.07 (Shareholder Vote)", async () => {
      const content = readFileSync(
        join(__dirname, "mock_data", "form-8k", "000114036125005876-primary_doc.htm"),
        "utf-8"
      );
      const form8K = await Form_8_K.parse("8-K", content);

      await processForm8K({
        cik: 320193,
        accession_number: "000114036125005876",
        filing_date: "2025-02-25",
        form: "8-K",
        items: "5.07",
        report_date: "2025-02-25",
        form8K,
        extractor_id: "8-K",
        extractor_version: "1.0.0",
      });

      const events = await eventRepo.getEventsByAccession(320193, "000114036125005876");
      expect(events.length).toBe(1);
      expect(events[0].item_code).toBe("5.07");
      expect(events[0].item_description).toBe(
        "Submission of Matters to a Vote of Security Holders"
      );
    });

    it("should correctly store Item 7.01 (Regulation FD Disclosure)", async () => {
      const content = readFileSync(
        join(__dirname, "mock_data", "form-8k", "000114036124040659-primary_doc.htm"),
        "utf-8"
      );
      const form8K = await Form_8_K.parse("8-K", content);

      await processForm8K({
        cik: 320193,
        accession_number: "000114036124040659",
        filing_date: "2024-09-10",
        form: "8-K",
        items: "7.01",
        report_date: "2024-09-10",
        form8K,
        extractor_id: "8-K",
        extractor_version: "1.0.0",
      });

      const events = await eventRepo.getEventsByAccession(320193, "000114036124040659");
      expect(events.length).toBe(1);
      expect(events[0].item_code).toBe("7.01");
      expect(events[0].item_description).toBe("Regulation FD Disclosure");
    });

    it("should correctly store Item 8.01 (Other Events)", async () => {
      const content = readFileSync(
        join(__dirname, "mock_data", "form-8k", "000119312525262593-primary_doc.htm"),
        "utf-8"
      );
      const form8K = await Form_8_K.parse("8-K", content);

      await processForm8K({
        cik: 1326801,
        accession_number: "000119312525262593",
        filing_date: "2025-11-03",
        form: "8-K",
        items: "8.01,9.01",
        report_date: "2025-11-03",
        form8K,
        extractor_id: "8-K",
        extractor_version: "1.0.0",
      });

      const events = await eventRepo.getEventsByAccession(1326801, "000119312525262593");
      expect(events.length).toBe(2);

      const item801 = events.find((e) => e.item_code === "8.01");
      expect(item801).toBeDefined();
      expect(item801?.item_description).toBe("Other Events");
    });

    it("should handle filings with multiple items across categories", async () => {
      const content = readFileSync(
        join(__dirname, "mock_data", "form-8k", "000110465925108507-primary_doc.htm"),
        "utf-8"
      );
      const form8K = await Form_8_K.parse("8-K", content);

      await processForm8K({
        cik: 1318605,
        accession_number: "000110465925108507",
        filing_date: "2025-11-07",
        form: "8-K",
        items: "5.02,5.07,9.01",
        report_date: "2025-11-07",
        form8K,
        extractor_id: "8-K",
        extractor_version: "1.0.0",
      });

      const events = await eventRepo.getEventsByAccession(1318605, "000110465925108507");
      expect(events.length).toBe(3);
      expect(events.map((e) => e.item_code).sort()).toEqual(["5.02", "5.07", "9.01"]);
    });

    it("should handle filings with four items", async () => {
      const content = readFileSync(
        join(__dirname, "mock_data", "form-8k", "000110465926021050-primary_doc.htm"),
        "utf-8"
      );
      const form8K = await Form_8_K.parse("8-K", content);

      await processForm8K({
        cik: 1018724,
        accession_number: "000110465926021050",
        filing_date: "2026-02-27",
        form: "8-K",
        items: "1.01,7.01,8.01,9.01",
        report_date: "2026-02-27",
        form8K,
        extractor_id: "8-K",
        extractor_version: "1.0.0",
      });

      const events = await eventRepo.getEventsByAccession(1018724, "000110465926021050");
      expect(events.length).toBe(4);
      expect(events.map((e) => e.item_code).sort()).toEqual(["1.01", "7.01", "8.01", "9.01"]);
    });
  });

  describe("cross-entity querying", () => {
    it("should retrieve events by CIK across multiple filings", async () => {
      for (const accessionNumber of [
        "000032019325000007",
        "000114036125005876",
        "000114036124040659",
      ]) {
        const metadata = FILING_METADATA[accessionNumber];
        const form8K = await Form_8_K.parse("8-K", "<html/>");

        await processForm8K({
          cik: metadata.cik,
          accession_number: accessionNumber,
          filing_date: metadata.filing_date,
          form: metadata.form,
          items: metadata.items,
          report_date: metadata.report_date,
          form8K,
          extractor_id: "8-K",
          extractor_version: "1.0.0",
        });
      }

      const appleEvents = await eventRepo.getEventsByCik(320193);
      // 2.02+9.01 + 5.07 + 7.01 = 4 events
      expect(appleEvents.length).toBe(4);
    });

    it("should retrieve events by item code across multiple companies", async () => {
      for (const accessionNumber of [
        "000032019325000007", // Apple 2.02,9.01
        "000162828025045861", // Tesla 2.02,9.01
        "000165204425000087", // Alphabet 2.02,9.01
      ]) {
        const metadata = FILING_METADATA[accessionNumber];
        const form8K = await Form_8_K.parse("8-K", "<html/>");

        await processForm8K({
          cik: metadata.cik,
          accession_number: accessionNumber,
          filing_date: metadata.filing_date,
          form: metadata.form,
          items: metadata.items,
          report_date: metadata.report_date,
          form8K,
          extractor_id: "8-K",
          extractor_version: "1.0.0",
        });
      }

      const item202Events = await eventRepo.getEventsByItemCode("2.02");
      expect(item202Events.length).toBe(3);

      const ciks = new Set(item202Events.map((e) => e.cik));
      expect(ciks.size).toBe(3);
      expect(ciks.has(320193)).toBe(true);
      expect(ciks.has(1318605)).toBe(true);
      expect(ciks.has(1652044)).toBe(true);
    });
  });

  describe("amendment handling", () => {
    it("should mark 8-K/A filings as amendments", async () => {
      const form8K = await Form_8_K.parse("8-K/A", "<html/>");

      await processForm8K({
        cik: 320193,
        accession_number: "test-amendment-001",
        filing_date: "2025-01-15",
        form: "8-K/A",
        items: "1.01,9.01",
        report_date: "2025-01-10",
        form8K,
        extractor_id: "8-K",
        extractor_version: "1.0.0",
      });

      const events = await eventRepo.getEventsByAccession(320193, "test-amendment-001");
      expect(events.length).toBe(2);
      expect(events.every((e) => e.is_amendment === true)).toBe(true);
    });

    it("should not mark regular 8-K filings as amendments", async () => {
      const form8K = await Form_8_K.parse("8-K", "<html/>");

      await processForm8K({
        cik: 320193,
        accession_number: "test-regular-001",
        filing_date: "2025-01-15",
        form: "8-K",
        items: "2.02,9.01",
        report_date: "2025-01-15",
        form8K,
        extractor_id: "8-K",
        extractor_version: "1.0.0",
      });

      const events = await eventRepo.getEventsByAccession(320193, "test-regular-001");
      expect(events.every((e) => e.is_amendment === false)).toBe(true);
    });
  });

  describe("edge cases", () => {
    it("should handle null items gracefully", async () => {
      const form8K = await Form_8_K.parse("8-K", "<html/>");

      await processForm8K({
        cik: 320193,
        accession_number: "test-null-items",
        filing_date: "2025-01-15",
        form: "8-K",
        items: null,
        report_date: null,
        form8K,
        extractor_id: "8-K",
        extractor_version: "1.0.0",
      });

      const events = await eventRepo.getEventsByAccession(320193, "test-null-items");
      expect(events.length).toBe(0);
    });

    it("should handle empty items string", async () => {
      const form8K = await Form_8_K.parse("8-K", "<html/>");

      await processForm8K({
        cik: 320193,
        accession_number: "test-empty-items",
        filing_date: "2025-01-15",
        form: "8-K",
        items: "",
        report_date: "2025-01-15",
        form8K,
        extractor_id: "8-K",
        extractor_version: "1.0.0",
      });

      const events = await eventRepo.getEventsByAccession(320193, "test-empty-items");
      expect(events.length).toBe(0);
    });

    it("should handle items with semicolon separators", async () => {
      const form8K = await Form_8_K.parse("8-K", "<html/>");

      await processForm8K({
        cik: 320193,
        accession_number: "test-semicolon-items",
        filing_date: "2025-01-15",
        form: "8-K",
        items: "2.02;9.01",
        report_date: "2025-01-15",
        form8K,
        extractor_id: "8-K",
        extractor_version: "1.0.0",
      });

      const events = await eventRepo.getEventsByAccession(320193, "test-semicolon-items");
      expect(events.length).toBe(2);
    });

    it("should deduplicate items from filing metadata and XML", async () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<edgarSubmission>
  <formData>
    <items>
      <item>2.02</item>
      <item>9.01</item>
    </items>
  </formData>
</edgarSubmission>`;

      const form8K = await Form_8_K.parse("8-K", xml);

      await processForm8K({
        cik: 320193,
        accession_number: "test-dedup-items",
        filing_date: "2025-01-15",
        form: "8-K",
        items: "2.02,9.01",
        report_date: "2025-01-15",
        form8K,
        extractor_id: "8-K",
        extractor_version: "1.0.0",
      });

      const events = await eventRepo.getEventsByAccession(320193, "test-dedup-items");
      expect(events.length).toBe(2);
    });

    it("should merge non-overlapping items from filing metadata and XML", async () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<edgarSubmission>
  <formData>
    <items>
      <item>2.02</item>
    </items>
  </formData>
</edgarSubmission>`;

      const form8K = await Form_8_K.parse("8-K", xml);

      await processForm8K({
        cik: 320193,
        accession_number: "test-merge-items",
        filing_date: "2025-01-15",
        form: "8-K",
        items: "9.01",
        report_date: "2025-01-15",
        form8K,
        extractor_id: "8-K",
        extractor_version: "1.0.0",
      });

      const events = await eventRepo.getEventsByAccession(320193, "test-merge-items");
      expect(events.length).toBe(2);
      expect(events.map((e) => e.item_code).sort()).toEqual(["2.02", "9.01"]);
    });

    it("should use XML period of report over filing metadata when available", async () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<edgarSubmission>
  <formData>
    <items>
      <item>2.02</item>
    </items>
    <periodOfReport>2025-01-10</periodOfReport>
  </formData>
</edgarSubmission>`;

      const form8K = await Form_8_K.parse("8-K", xml);

      await processForm8K({
        cik: 320193,
        accession_number: "test-period-override",
        filing_date: "2025-01-15",
        form: "8-K",
        items: "2.02",
        report_date: "2025-01-15",
        form8K,
        extractor_id: "8-K",
        extractor_version: "1.0.0",
      });

      const events = await eventRepo.getEventsByAccession(320193, "test-period-override");
      expect(events[0].report_date).toBe("2025-01-10");
    });

    it("should handle unknown item codes gracefully", async () => {
      const form8K = await Form_8_K.parse("8-K", "<html/>");

      await processForm8K({
        cik: 320193,
        accession_number: "test-unknown-item",
        filing_date: "2025-01-15",
        form: "8-K",
        items: "99.99",
        report_date: "2025-01-15",
        form8K,
        extractor_id: "8-K",
        extractor_version: "1.0.0",
      });

      const events = await eventRepo.getEventsByAccession(320193, "test-unknown-item");
      expect(events.length).toBe(1);
      expect(events[0].item_code).toBe("99.99");
      expect(events[0].item_description).toBeNull();
    });
  });

  describe("XML edgarSubmission parsing and storage", () => {
    it("should parse and store from XML with form data", async () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<edgarSubmission>
  <schemaVersion>X-01</schemaVersion>
  <submissionType>8-K</submissionType>
  <headerData>
    <filerInfo>
      <filerCik>0000320193</filerCik>
    </filerInfo>
  </headerData>
  <formData>
    <items>
      <item>2.02</item>
      <item>9.01</item>
    </items>
    <periodOfReport>2025-01-30</periodOfReport>
  </formData>
</edgarSubmission>`;

      const form8K = await Form_8_K.parse("8-K", xml);

      expect(form8K.submissionType).toBe("8-K");
      expect(form8K.formData?.periodOfReport).toBe("2025-01-30");
      expect(form8K.formData?.items?.item).toEqual(["2.02", "9.01"]);

      await processForm8K({
        cik: 320193,
        accession_number: "test-xml-form-data",
        filing_date: "2025-01-30",
        form: "8-K",
        items: "2.02,9.01",
        report_date: "2025-01-30",
        form8K,
        extractor_id: "8-K",
        extractor_version: "1.0.0",
      });

      const events = await eventRepo.getEventsByAccession(320193, "test-xml-form-data");
      expect(events.length).toBe(2);
    });
  });

  describe("Form_8_K_ITEMS constant", () => {
    it("should have entries for all major item sections", async () => {
      expect(Form_8_K_ITEMS["1.01"]).toBeDefined();
      expect(Form_8_K_ITEMS["2.01"]).toBeDefined();
      expect(Form_8_K_ITEMS["3.01"]).toBeDefined();
      expect(Form_8_K_ITEMS["4.01"]).toBeDefined();
      expect(Form_8_K_ITEMS["5.01"]).toBeDefined();
      expect(Form_8_K_ITEMS["6.01"]).toBeDefined();
      expect(Form_8_K_ITEMS["7.01"]).toBeDefined();
      expect(Form_8_K_ITEMS["8.01"]).toBeDefined();
      expect(Form_8_K_ITEMS["9.01"]).toBeDefined();
    });

    it("should have non-empty descriptions for all items", async () => {
      for (const [code, description] of Object.entries(Form_8_K_ITEMS)) {
        expect(description).toBeTruthy();
        expect(description.length).toBeGreaterThan(5);
        expect(code).toMatch(/^\d+\.\d+$/);
      }
    });
  });
});
