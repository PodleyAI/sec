/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { JobQueueTaskConfig } from "@workglow/task-graph";
import { FetchUrlJob, FetchUrlTaskInput, FetchUrlTaskOutput } from "@workglow/tasks";
import { SecUserAgent } from "../config/Constants";

export class SecFetchJob<
  Input extends FetchUrlTaskInput = FetchUrlTaskInput,
  Output = FetchUrlTaskOutput
> extends FetchUrlJob<Input, Output> {
  constructor(config: JobQueueTaskConfig & { input: Input }) {
    // Set SEC-specific headers
    config.input.headers = {
      "User-Agent": SecUserAgent,
      ...config.input.headers,
    };
    super(config);
  }
}
