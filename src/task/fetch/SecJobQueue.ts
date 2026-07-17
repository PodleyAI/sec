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
  wrapQueueStorage,
} from "workglow";

import { SecJobQueueName } from "../../config/Constants";
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

const { messageQueue: secJobQueueMessageQueue, jobStore: secJobQueueJobStore } =
  wrapQueueStorage(SecJobQueueStorage);

export const SecJobQueueServer = new JobQueueServer<
  FetchUrlTaskInput,
  FetchUrlTaskOutput,
  SecFetchJob
>(SecFetchJob, {
  queueName: SecJobQueueName,
  messageQueue: secJobQueueMessageQueue,
  jobStore: secJobQueueJobStore,
  limiter: new CompositeLimiter([
    limiter,
    new EvenlySpacedRateLimiter({ maxExecutions: 10, windowSizeInSeconds: 1 }),
  ]),
  pollIntervalMs: 1,
});

export const SecJobQueueClient = new JobQueueClient<FetchUrlTaskInput, FetchUrlTaskOutput>({
  messageQueue: secJobQueueMessageQueue,
  jobStore: secJobQueueJobStore,
  queueName: SecJobQueueName,
});

SecJobQueueClient.attach(SecJobQueueServer);
