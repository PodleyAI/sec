//    *******************************************************************************
//    *   PODLEY.AI: Your Agentic AI library                                        *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { getTaskQueueRegistry, setTaskQueueRegistry } from "@podley/task-graph";
import { afterAll, beforeAll, describe, expect, it, mock } from "bun:test";
import { FetchDailyIndexTask } from "../task/index/FetchDailyIndexTask";
import { TaskFailedError } from "@podley/ask-graph";
// @ts-expect-error ts(2307)
import master20240101 from "./mock_data/master.20240101.idx" with { type: "text" };
// @ts-expect-error ts(2307)
import master20240102 from "./mock_data/master.20240102.idx" with { type: "text" };
import { FetchTaskOutput } from "@podley/asks";
import { JobQueue } from "@podley/ob-queue";
import { FetchTaskInput } from "@podley/asks";
import { SecFetchJob } from "../fetch/SecFetchJob";
import { SecJobQueueName } from "../config/Constants";
import { InMemoryQueueStorage } from "@podley/torage";
import { InMemoryRateLimiter } from "@podley/ob-queue";
import { EnvToDI } from "../config/EnvToDI";

EnvToDI();
// Create base mock response
const createMockResponse20240102 = (): Response => {
  return new Response(master20240102, {
    status: 200,
    headers: {
      "Content-Type": "application/text",
      "x-content-type-options": "nosniff",
      "x-frame-options": "SAMEORIGIN",
      "x-xss-protection": "1; mode=block",
    },
  });
};

const createMockResponse20240101 = (): Response => {
  return new Response(master20240101, {
    status: 403,
    statusText: "Forbidden",
    headers: {
      "content-type": "application/xml",
      "x-content-type-options": "nosniff",
      "x-frame-options": "SAMEORIGIN",
      "x-xss-protection": "1; mode=block",
    },
  });
};

// Mock fetch for testing
const mockFetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
  const inputString = input.toString();
  if (inputString.includes("20240101")) {
    return createMockResponse20240101();
  } else if (inputString.includes("20240102")) {
    return createMockResponse20240102();
  } else {
    throw new Error("Unknown input: " + inputString);
  }
});

const oldFetch = global.fetch;

describe("SEC FetchDailyIndexTask", () => {
  let db: any;

  beforeAll(() => {
    (global as any).fetch = mockFetch;
    getTaskQueueRegistry().registerQueue(
      new JobQueue<FetchTaskInput, FetchTaskOutput, SecFetchJob>(SecJobQueueName, SecFetchJob, {
        storage: new InMemoryQueueStorage(SecJobQueueName),
        limiter: new InMemoryRateLimiter({ maxExecutions: 10, windowSizeInSeconds: 1 }),
        waitDurationInMilliseconds: 1,
      })
    );
    getTaskQueueRegistry().startQueues();
  });

  afterAll(() => {
    (global as any).fetch = oldFetch;
    getTaskQueueRegistry().stopQueues();
    setTaskQueueRegistry(null);
  });

  it("should get the daily index", async () => {
    const results = await new FetchDailyIndexTask({
      date: "2024-01-02",
    }).run();
    expect(results.updateList.length).toEqual(3036);
  });

  it("should fail to get the daily index", async () => {
    // (global as any).fetch = oldFetch;

    try {
      const task = new FetchDailyIndexTask({
        date: "2024-01-01",
      });
      await task.run();
      console.log("This should NOT be seen");
    } catch (error: any) {
      expect(error).toBeInstanceOf(TaskFailedError);
    }
  });
});
