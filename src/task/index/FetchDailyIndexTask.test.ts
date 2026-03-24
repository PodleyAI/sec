/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { Glob } from "bun";
import { afterAll, beforeAll, describe, expect, it, mock } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import {
  EvenlySpacedRateLimiter,
  FetchUrlTaskInput,
  FetchUrlTaskOutput,
  getTaskQueueRegistry,
  InMemoryQueueStorage,
  JobQueueClient,
  JobQueueServer,
  setTaskQueueRegistry,
  TaskFailedError,
} from "workglow";
import { SecJobQueueName } from "../../config/Constants";
import { EnvToDI } from "../../config/EnvToDI";
import { SecFetchJob } from "../../fetch/SecFetchJob";
import { FetchDailyIndexTask } from "./FetchDailyIndexTask";

// Get all daily index files using glob pattern
const mockDataDir = join(__dirname, "../../sec/indexes/mock_data");
const glob = new Glob("????-??-??.master.idx");
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

  // Extract date from URL - handle both formats:
  // 1. YYYY-MM-DD format (e.g., 2024-01-01)
  // 2. YYYYMMDD format in SEC URLs (e.g., master.20250418.idx)
  let date: string | undefined;

  const dashDateMatch = inputString.match(/(\d{4}-\d{2}-\d{2})/);
  if (dashDateMatch) {
    date = dashDateMatch[1];
  } else {
    const compactDateMatch = inputString.match(/master\.(\d{4})(\d{2})(\d{2})\.idx/);
    if (compactDateMatch) {
      const [, year, month, day] = compactDateMatch;
      date = `${year}-${month}-${day}`;
    }
  }

  if (date && mockData.has(date)) {
    return createMockResponse(date);
  }

  throw new Error("Unknown input: " + inputString);
});

const oldFetch = global.fetch;

EnvToDI();
describe("FetchDailyIndexTask", () => {
  let db: any;
  let server: JobQueueServer<FetchUrlTaskInput, FetchUrlTaskOutput, SecFetchJob>;

  beforeAll(() => {
    (global as any).fetch = mockFetch;

    const storage = new InMemoryQueueStorage<FetchUrlTaskInput, FetchUrlTaskOutput>(
      SecJobQueueName
    );
    server = new JobQueueServer<FetchUrlTaskInput, FetchUrlTaskOutput, SecFetchJob>(SecFetchJob, {
      queueName: SecJobQueueName,
      storage,
      limiter: new EvenlySpacedRateLimiter({ maxExecutions: 10, windowSizeInSeconds: 1 }),
      pollIntervalMs: 1,
    });
    const client = new JobQueueClient<FetchUrlTaskInput, FetchUrlTaskOutput>({
      storage,
      queueName: SecJobQueueName,
    });

    client.attach(server);

    getTaskQueueRegistry().registerQueue({ server, client, storage });
    server.start();
  });

  afterAll(async () => {
    (global as any).fetch = oldFetch;
    await setTaskQueueRegistry(null);
  });

  // Dynamic tests for all available daily index files
  for (const filePath of dailyIndexFiles) {
    const fileName = filePath.split("/").pop()!;
    const date = fileName.replace(".master.idx", "");
    const content = mockData.get(date)!;
    const isErrorFile = content.length < 1000;

    if (isErrorFile) {
      it(`should fail to get the daily index for ${date}`, async () => {
        try {
          const task = new FetchDailyIndexTask({ date });
          await task.run();
          expect.unreachable("This should not be reached");
        } catch (error: any) {
          expect(error).toBeInstanceOf(TaskFailedError);
        }
      });
    } else {
      it(`should get the daily index for ${date}`, async () => {
        const results = await new FetchDailyIndexTask({ date }).run();
        expect(results.updateList.length).toBeGreaterThan(100);
        expect(results.updateList[0][1]).toEqual(date);
      });
    }
  }
});
