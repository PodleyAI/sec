/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  FetchUrlTask,
  FetchUrlTaskConfig,
  FetchUrlTaskInput,
  FetchUrlTaskOutput,
  TaskOutput,
} from "workglow";
import { SecJobQueueName, SecUserAgent } from "../config/Constants";

/**
 * SEC-specific fetch task
 */
export class SecFetchTask<
  Input extends FetchUrlTaskInput = FetchUrlTaskInput,
  Output extends TaskOutput = FetchUrlTaskOutput,
  Config extends FetchUrlTaskConfig = FetchUrlTaskConfig,
> extends FetchUrlTask<Input, Output, Config> {
  constructor(input: FetchUrlTaskInput = {} as FetchUrlTaskInput, config: Config = {} as Config) {
    const defaults: FetchUrlTaskInput = { ...input };
    if (defaults.headers) {
      defaults.headers = { ...defaults.headers, "User-Agent": SecUserAgent };
    } else {
      defaults.headers = { "User-Agent": SecUserAgent };
    }

    super({
      ...config,
      queue: SecJobQueueName,
      defaults: defaults as Partial<Input>,
    });
  }
}
