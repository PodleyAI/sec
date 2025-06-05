//    *******************************************************************************
//    *   PODLEY.AI: Your Agentic AI library                                        *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { setTaskQueueRegistry, TaskFailedError } from "@podley/task-graph";
import { Glob } from "bun";
import { afterAll, beforeAll, describe, expect, it, mock } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { EnvToDI } from "../../config/EnvToDI";
import { FetchQuarterlyIndexTask } from "./FetchQuarterlyIndexTask";

// Get all daily index files using glob pattern
const mockDataDir = join(__dirname, "../../sec/indexes/mock_data");
const glob = new Glob("????-QTR?.master.idx");
const dailyIndexFiles = Array.from(glob.scanSync({ cwd: mockDataDir, absolute: true })).sort();

// Load mock data for all daily index files
const mockData = new Map<string, string>();
for (const filePath of dailyIndexFiles) {
  const content = readFileSync(filePath, "utf-8");
  const fileName = filePath.split("/").pop()!;
  const date = fileName.replace(".master.idx", "");
  mockData.set(date, content);
}

// Create mock response factory
const createMockResponse = (date: string): Response => {
  const content = mockData.get(date);
  if (!content) {
    throw new Error(`No mock data for date: ${date}`);
  }

  // Determine status based on content size (simulating different scenarios)
  const isError = content.length < 1000; // Small files are likely error responses

  return new Response(content, {
    status: isError ? 403 : 200,
    statusText: isError ? "Forbidden" : "OK",
    headers: {
      "Content-Type": isError ? "application/xml" : "application/text",
      "x-content-type-options": "nosniff",
      "x-frame-options": "SAMEORIGIN",
      "x-xss-protection": "1; mode=block",
    },
  });
};

// Mock fetch for testing
const mockFetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
  const inputString = input.toString();

  // Extract date from URL - handle quarterly index URLs:
  // Format: https://www.sec.gov/Archives/edgar/full-index/YYYY/QTRN/master.idx
  let date: string | undefined;

  // Match URL format like /2024/QTR1/master.idx
  const urlDateMatch = inputString.match(/\/(\d{4})\/QTR(\d)\//);
  if (urlDateMatch) {
    const year = urlDateMatch[1];
    const quarter = urlDateMatch[2];
    date = `${year}-QTR${quarter}`;
  }

  if (date && mockData.has(date)) {
    return createMockResponse(date);
  }

  throw new Error("Unknown input: " + inputString);
});

const oldFetch = global.fetch;

EnvToDI();
describe("FetchQuarterlyIndexTask", () => {
  let db: any;

  beforeAll(() => {
    (global as any).fetch = mockFetch;
    setTaskQueueRegistry(null);
  });

  afterAll(() => {
    (global as any).fetch = oldFetch;
    setTaskQueueRegistry(null);
  });

  // Dynamic tests for all available daily index files
  for (const filePath of dailyIndexFiles) {
    const fileName = filePath.split("/").pop()!;
    const date = fileName.replace(".master.idx", "");
    const content = mockData.get(date)!;
    const isErrorFile = content.length < 1000;
    const year = parseInt(date.split("-")[0]);
    const quarter = parseInt(date.split("QTR")[1]);
    const month = (quarter - 1) * 3 + 1; // Calculate the first month of the quarter
    const generatedDate = `${year}-${month.toString().padStart(2, "0")}-01`;

    if (isErrorFile) {
      it(`should fail to get the quarterly index for ${date}`, async () => {
        try {
          const task = new FetchQuarterlyIndexTask({ date: generatedDate });
          await task.run();
          expect.unreachable("This should not be reached");
        } catch (error: any) {
          expect(error).toBeInstanceOf(TaskFailedError);
        }
      });
    } else {
      it(`should get the quarterly index for ${date}`, async () => {
        const results = await new FetchQuarterlyIndexTask({ date: generatedDate }).run();
        expect(results.updateList.length).toBeGreaterThan(100);
      });
    }
  }
});
