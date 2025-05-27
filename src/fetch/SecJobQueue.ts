//    *******************************************************************************
//    *   PODLEY.AI: Your Agentic AI library                                        *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import {
  CompositeLimiter,
  EvenlySpacedRateLimiter,
  InMemoryRateLimiter,
  JobQueue,
} from "@podley/job-queue";
import { InMemoryQueueStorage } from "@podley/storage";
import { FetchTaskInput, FetchTaskOutput } from "@podley/tasks";
import { SecJobQueueName } from "../config/Constants";
import { SecFetchJob } from "./SecFetchJob";

export const SecJobQueue = new JobQueue<FetchTaskInput, FetchTaskOutput, SecFetchJob>(
  SecJobQueueName,
  SecFetchJob,
  {
    storage: new InMemoryQueueStorage(SecJobQueueName),
    limiter: new CompositeLimiter([
      new InMemoryRateLimiter({ maxExecutions: 10, windowSizeInSeconds: 1 }),
      new EvenlySpacedRateLimiter({ maxExecutions: 10, windowSizeInSeconds: 1 }),
    ]),
    waitDurationInMilliseconds: 1,
  }
);
