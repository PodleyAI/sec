//    *******************************************************************************
//    *   PODLEY.AI: Your Agentic AI library                                        *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { JobQueueTaskConfig } from "@podley/task-graph";
import { FetchJob, FetchTaskInput } from "@podley/tasks";
import { SecUserAgent } from "../config/Constants";

export class SecFetchJob extends FetchJob {
  constructor(config: JobQueueTaskConfig & { input: FetchTaskInput }) {
    // Set SEC-specific headers
    config.input.headers = {
      "User-Agent": SecUserAgent,
      ...config.input.headers,
    };
    super(config);
  }
}
