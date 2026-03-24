/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  CompositeLimiter,
  EvenlySpacedRateLimiter,
  FetchUrlTaskInput,
  FetchUrlTaskOutput,
  InMemoryQueueStorage,
  InMemoryRateLimiterStorage,
  JobQueueClient,
  JobQueueServer,
  RateLimiter,
} from "workglow";

import { SecJobQueueName } from "../config/Constants";
import { SecFetchJob } from "./SecFetchJob";

// Create storage for the rate limiter
const rateLimiterStorage = new InMemoryRateLimiterStorage();
const limiter = new RateLimiter(rateLimiterStorage, SecJobQueueName, {
  maxExecutions: 10,
  windowSizeInSeconds: 1,
  initialBackoffDelay: 1000,
  backoffMultiplier: 2,
  maxBackoffDelay: 60000,
});

export const SecJobQueueStorage = new InMemoryQueueStorage<FetchUrlTaskInput, FetchUrlTaskOutput>(
  SecJobQueueName
);

export const SecJobQueueServer = new JobQueueServer<
  FetchUrlTaskInput,
  FetchUrlTaskOutput,
  SecFetchJob
>(SecFetchJob, {
  queueName: SecJobQueueName,
  storage: SecJobQueueStorage,
  limiter: new CompositeLimiter([
    limiter,
    new EvenlySpacedRateLimiter({ maxExecutions: 10, windowSizeInSeconds: 1 }),
  ]),
  pollIntervalMs: 1,
});

export const SecJobQueueClient = new JobQueueClient<FetchUrlTaskInput, FetchUrlTaskOutput>({
  storage: SecJobQueueStorage,
  queueName: SecJobQueueName,
});

SecJobQueueClient.attach(SecJobQueueServer);
