//    *******************************************************************************
//    *   PODLEY.AI: Your Agentic AI library                                        *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { JobQueueTaskConfig, TaskIO } from "@podley/task-graph";
import { FetchTask, FetchTaskInput, FetchTaskOutput } from "@podley/tasks";
import { SecJobQueueName, SecUserAgent } from "../config/Constants";
import { SecFetchJob } from "./SecFetchJob";

/**
 * SEC-specific fetch task
 */
export class SecFetchTask<
  Input extends FetchTaskInput = FetchTaskInput,
  Output extends TaskIO = FetchTaskOutput,
  Config extends JobQueueTaskConfig = JobQueueTaskConfig
> extends FetchTask<Input, Output, Config> {
  constructor(input: FetchTaskInput = {} as FetchTaskInput, config: Config = {} as Config) {
    config.queueName = SecJobQueueName;
    input.queueName = SecJobQueueName;

    if (input.headers) {
      input.headers["User-Agent"] = SecUserAgent;
    } else {
      input.headers = { "User-Agent": SecUserAgent };
    }

    super(input as Input, config);
    this.jobClass = SecFetchJob;
  }
}
