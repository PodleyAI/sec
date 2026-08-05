/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
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
  wrapQueueStorage,
} from "workglow";
import { SecJobQueueName } from "../../config/Constants";
import { EnvToDI } from "../../config/EnvToDI";
import { SecFetchJob } from "../fetch/SecFetchJob";
import { FetchDailyIndexTask } from "./FetchDailyIndexTask";

// Get all daily index files by filename pattern
const mockDataDir = join(__dirname, "../../sec/indexes/mock_data");
const dailyIndexFiles = readdirSync(mockDataDir)
  .filter((name) => /^\d{4}-\d{2}-\d{2}\.master\.idx$/.test(name))
  .sort()
  .map((name) => join(mockDataDir, name));

// Read lazily: the `describe` below skips entirely under Node, but module-scope
// reads happen regardless of the skip, so eager loading made every run pay for
// fixtures no test would use.
const mockData = new Map<string, string>();
function fixtureContent(date: string): string {
  const cached = mockData.get(date);
  if (cached !== undefined) return cached;
  const filePath = dailyIndexFiles.find((p) => p.endsWith(`${date}.master.idx`));
  if (!filePath) throw new Error(`No mock data for date: ${date}`);
  const content = readFileSync(filePath, "utf-8");
  mockData.set(date, content);
  return content;
}

// Small fixtures stand in for EDGAR's 403 error body rather than a real index.
const isErrorFixture = (date: string): boolean => fixtureContent(date).length < 1000;

// Create mock response factory
const createMockResponse = (date: string): Response => {
  const content = fixtureContent(date);
  const isError = isErrorFixture(date);

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
const mockFetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
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

  if (date && dailyIndexFiles.some((p) => p.endsWith(`${date}.master.idx`))) {
    return createMockResponse(date);
  }

  throw new Error("Unknown input: " + inputString);
});

const oldFetch = global.fetch;

EnvToDI();
// TODO: JobQueueServer's poll loop times out under Node/vitest (works under
// bun test with `pollIntervalMs: 1`). Migrate this test off the live-server
// pattern to a directly-invoked task runner, then drop the Bun skip.
describe.skipIf(typeof Bun === "undefined")("FetchDailyIndexTask", () => {
  let db: any;
  let server: JobQueueServer<FetchUrlTaskInput, FetchUrlTaskOutput, SecFetchJob>;

  beforeAll(async () => {
    (global as any).fetch = mockFetch;

    // Reset the registry first so we don't conflict with a sibling test file
    // (FetchQuarterlyIndexTask.test.ts) that registers the same
    // SecJobQueueName. Bun shares module state across test files when they
    // run in the same worker, and the workglow registry throws "Queue
    // already exists" on a second registration of the same name.
    await setTaskQueueRegistry(null);

    const storage = new InMemoryQueueStorage<FetchUrlTaskInput, FetchUrlTaskOutput>(
      SecJobQueueName
    );
    const { messageQueue, jobStore } = wrapQueueStorage(storage);
    server = new JobQueueServer<FetchUrlTaskInput, FetchUrlTaskOutput, SecFetchJob>(SecFetchJob, {
      queueName: SecJobQueueName,
      messageQueue,
      jobStore,
      limiter: new EvenlySpacedRateLimiter({ maxExecutions: 10, windowSizeInSeconds: 1 }),
      pollIntervalMs: 1,
    });
    const client = new JobQueueClient<FetchUrlTaskInput, FetchUrlTaskOutput>({
      messageQueue,
      jobStore,
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
    const isErrorFile = isErrorFixture(date);

    if (isErrorFile) {
      it(`should fail to get the daily index for ${date}`, async () => {
        try {
          const task = new FetchDailyIndexTask();
          await task.run({ date });
          expect.unreachable("This should not be reached");
        } catch (error: any) {
          expect(error).toBeInstanceOf(TaskFailedError);
        }
      });
    } else {
      it(`should get the daily index for ${date}`, async () => {
        const results = await new FetchDailyIndexTask().run({ date });
        expect(results.updateList.length).toBeGreaterThan(100);
        expect(results.updateList[0][1]).toEqual(date);
      });
    }
  }
});
