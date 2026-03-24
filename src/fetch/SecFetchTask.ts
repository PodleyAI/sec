/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  FetchUrlTask,
  FetchUrlTaskInput,
  FetchUrlTaskOutput,
  Job,
  JobConstructorParam,
  JobQueueTaskConfig,
  TaskOutput,
} from "workglow";
import { SecJobQueueName, SecUserAgent } from "../config/Constants";
import { SecFetchJob } from "./SecFetchJob";

/**
 * SEC-specific fetch task
 */
export class SecFetchTask<
  Input extends FetchUrlTaskInput = FetchUrlTaskInput,
  Output extends TaskOutput = FetchUrlTaskOutput,
  Config extends JobQueueTaskConfig = JobQueueTaskConfig,
> extends FetchUrlTask<Input, Output, Config> {
  constructor(input: FetchUrlTaskInput = {} as FetchUrlTaskInput, config: Config = {} as Config) {
    config.queue = SecJobQueueName;
    input.queue = SecJobQueueName;

    if (input.headers) {
      input.headers["User-Agent"] = SecUserAgent;
    } else {
      input.headers = { "User-Agent": SecUserAgent };
    }

    super(input as Input, config);
    this.jobClass = SecFetchJob as new (
      config: JobConstructorParam<Input, Output>
    ) => Job<Input, Output>;
  }
}
